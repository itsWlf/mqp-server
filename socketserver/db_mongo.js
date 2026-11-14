'use strict';
// Modules
const MongoClient = require('mongodb').MongoClient;
const log = new(require('basic-logger'))({
	showTimestamp: true,
	prefix: 'MongoDB'
});

// Files
const nconf = require('nconf');
const Mailer = require('./mail/mailer');
const DBUtils = require('./utils').db;
const User = require('./user');

// Variables
const expires = 1000 * 60 * 60 * 24 * nconf.get('loginExpire');
let usernames = [];
let client = null;
let db = null;
let poolqueue = [];
let ready = false;

let playlistscol = null;
let roomcol = null;
let userscol = null;
let chatcol = null;
let pmscol = null;
let ipcol = null;

function dbQueue(callback) {
    if (callback === true) {
        while (poolqueue.length > 0)
            (poolqueue.shift())();

        ready = true;
        return;
    }

    if (!ready) {
        return poolqueue.push(callback);
    }

    callback();
}

// The mongodb driver (>= 5) is promise-only, while the rest of the app talks to
// the database backends with Node-style callbacks. This bridges the two.
// The callback is invoked on a fresh tick, outside of the promise chain, so an
// exception thrown by the callback surfaces as a normal uncaught exception
// instead of being swallowed or causing the callback to be invoked twice.
// Without a callback the outcome is ignored (as the old driver did when no
// callback was given), rather than leaving an unhandled rejection behind.
function nodeify(promise, callback) {
    if (typeof callback !== 'function') {
        promise.catch(noop);
        return;
    }

    promise.then(function (result) {
        process.nextTick(callback, null, result);
    }, function (err) {
        process.nextTick(callback, err);
    });
}

// For writes where the caller does not care about the outcome
function noop() {}

// Throws outside of any promise chain (fatal, like the old callback-style code)
function throwAsync(err) {
    process.nextTick(function () {
        throw err;
    });
}

const collectionNames = ['playlists', 'room', 'users', 'chat', 'pms', 'ip'];
const counters = [
    ['playlists', 'PIDCOUNTER'],
    ['users', 'UIDCOUNTER'],
    ['chat', 'CIDCOUNTER'],
    ['pms', 'PMIDCOUNTER'],
];

async function createCollectionsIfNoExist() {
    const existing = (await db.listCollections({}, {
        nameOnly: true
    }).toArray()).map(col => col.name);

    for (const name of collectionNames) {
        if (existing.indexOf(name) == -1) {
            try {
                await db.createCollection(name);
            } catch (e) {
                // 48 = NamespaceExists, somebody else created it in the meantime
                if (!e || e.code !== 48)
                    throw new Error(`Failed to create the ${name} collection`);
            }
        }
    }

    playlistscol = db.collection('playlists');
    roomcol = db.collection('room');
    userscol = db.collection('users');
    chatcol = db.collection('chat');
    pmscol = db.collection('pms');
    ipcol = db.collection('ip');
}

async function initCollections() {
    for (const counter of counters) {
        const col = db.collection(counter[0]);
        let obj;

        try {
            obj = await col.findOne({
                _id: counter[1]
            });
        } catch (e) {
            throw new Error(`Cannot get ${counter[1]} from ${counter[0]}`);
        }

        if (!obj) {
            try {
                await col.insertOne({
                    _id: counter[1],
                    seq: 1
                });
            } catch (e) {
                throw new Error(`Cannot set ${counter[1]} to ${counter[0]}`);
            }
        }
    }
}

function MongoDB(cb) {
    const user = nconf.get('db:mongoUser');
    const password = nconf.get('db:mongoPassword');
    const database = nconf.get('db:mongoDatabase');
    // Credentials have to be percent-encoded, the driver rejects the URL otherwise
    const auth = user ? `${encodeURIComponent(user)}:${encodeURIComponent(password || '')}@` : '';
    const dburl = `mongodb://${auth}${nconf.get('db:mongoHost')}:27017/${encodeURIComponent(database)}`;

    let mongoclient;
    try {
        mongoclient = new MongoClient(dburl);
    } catch (err) {
        throw new Error(`Could not connect to database: ${err}`);
    }

    mongoclient.connect().then(() => {
        client = mongoclient;
        db = client.db(database);

        return createCollectionsIfNoExist().then(initCollections);
    }, (err) => {
        throw new Error(`Could not connect to database: ${err}`);
    }).then(() => {
        process.nextTick(dbQueue, true);
    }, throwAsync);
}

function getNextSequence(collection, id, callback) {
  dbQueue(() => {
      // Resolves with the document as it was *before* the update
      nodeify(db.collection(collection).findOneAndUpdate({
          _id: id
      }, {
          $inc: {
              seq: 1
          }
      }, {
          returnDocument: 'before'
      }), (err, r) => {
          if (err || !r) throw new Error('Cannot update index counter');
          callback(r.seq);
      });
  });
}

// PlaylistDB
MongoDB.prototype.getPlaylist = function (pid, callback) {
    var Playlist = require('./playlist');

    dbQueue(function () {
        nodeify(playlistscol.findOne({
            _id: pid
        }, {
            projection: {
                _id: 0
            }
        }), function (err, data) {
            if (err || !data) {
                callback('PlaylistNotFound');
                return;
            }

            var pl = new Playlist();
            pl.id = pid;
            Object.assign(pl.data, data);

            callback(err, pl);
        });
    });

    return this;
};

MongoDB.prototype.createPlaylist = function (owner, name, callback) {
    var Playlist = require('./playlist');

    dbQueue(function () {
        getNextSequence('playlists', 'PIDCOUNTER', function (currentPID) {
            var pl = new Playlist();

            pl.id = currentPID;
            pl.data.created = Date.now();
            pl.data.owner = owner;
            pl.data.name = name.substring(0, 100);

            var updatedPlObj = pl.makeDbObj();
            updatedPlObj._id = currentPID;

            nodeify(playlistscol.insertOne(updatedPlObj), function (error, data) {
                callback(error, pl);
            });
        });
    });
};

MongoDB.prototype.deletePlaylist = function (pid, callback) {
    dbQueue(function () {
        nodeify(playlistscol.deleteOne({
            _id: pid
        }), callback || noop);
    });
};


MongoDB.prototype.putPlaylist = function (pid, data, callback) {
    var newData = {};
    Object.assign(newData, data);

    newData._id = pid;

    dbQueue(function () {
        nodeify(playlistscol.replaceOne({
            _id: pid
        }, newData, {
            upsert: true,
            writeConcern: {
                w: 1
            }
        }), function (error, res) {
            if (callback) callback(data);
        });
    });
};

// RoomDB
MongoDB.prototype.getRoom = function (slug, callback) {
    dbQueue(function () {
        nodeify(roomcol.findOne({
            slug
        }, {
            projection: {
                _id: 0
            }
        }), callback);
    });
    return this;
};

MongoDB.prototype.setRoom = function (slug, val, callback) {
    dbQueue(function () {
        var newData = {};
        Object.assign(newData, val);

        newData.slug = slug;
        nodeify(roomcol.replaceOne({
            slug
        }, newData, {
            upsert: true,
            writeConcern: {
                w: 1
            }
        }), function (error, data) {
            if (callback) callback(error, data);
        });
    });
    return this;
};

// UserDB
function addUsername(un) {
    usernames.push(un.toLowerCase());
}

function usernameExists(un) {
    un = un.toLowerCase();

    var ind;
    return ((ind = usernames.indexOf(un)) != -1 ? ind : false);
}

MongoDB.prototype.createUser = function (obj, callback) {
    var that = this;

    var defaultCreateObj = {
        email: null,
        un: null,
        pw: null
    };
    Object.assign(defaultCreateObj, obj);

    var inData = defaultCreateObj;
    inData.email = inData.email.toLowerCase();

    // Validation
    if (!inData.email || !DBUtils.validateEmail(inData.email)) {
        callback('InvalidEmail');
        return;
    }
    if (!inData.un || !DBUtils.validateUsername(inData.un)) {
        callback('InvalidUsername');
        return;
    }
    if (usernameExists(inData.un) !== false) {
        callback('UsernameExists');
        return;
    }

    dbQueue(function () {
        // Check for existing account
        that.userEmailExists(inData.email, function (err, res) {
            if (err) {
                if (callback) callback('AccountExists');
                return;
            }

            getNextSequence('users', 'UIDCOUNTER', function (currentUID) {
                var user = new User();

                user.data.uid = currentUID;
                user.data.un = inData.un;
                user.data.pw = inData.pw;
                user.data.created = Date.now();
								if (nconf.get('room:mail:confirmation')) user.data.confirmation = DBUtils.randomBytes(18, 'base64');

                var updatedUserObj = user.makeDbObj();
                updatedUserObj._id = currentUID;
                updatedUserObj.email = inData.email;

                nodeify(userscol.insertOne(updatedUserObj), function (error, data) {
                    if (error) {
                        callback(error);
                        return;
                    }

                    // Send confirmation email
                    if (nconf.get('room:mail:confirmation')) {
                        Mailer.sendEmail('signup', {
                            code: user.data.confirmation,
                            user: inData.un,
                        }, inData.email, function (data) {
                            console.log(data);
                        });
                    }

                    // Do other ~messy~ stuff
                    addUsername(inData.un);
                    user.login(inData.email);
										callback(null, user, inData.email);
                });
            });
        });
    });
};

MongoDB.prototype.loginUser = function (email, callback) {
	if (email) {
		email = email.toLowerCase();
		dbQueue(() => {
			nodeify(userscol.findOne({ email }, { projection: { _id: 0 } }), (err, data) => {
				if (err) {
					callback(err);
					return;
				}
				if (!data) {
					callback('UserNotFound');
					return;
				}

				const user = new User();
				user.login(email, data, () => {
					callback(null, user, email);
				});
			});
		});
	}
};

MongoDB.prototype.putUser = function (email, data, callback) {
    var newData = {};
    Object.assign(newData, data);

    newData._id = data.uid;
    newData.email = email;

    dbQueue(function () {
        nodeify(userscol.replaceOne({
            email
        }, newData, {
            upsert: true,
            writeConcern: {
                w: 1
            }
        }), callback || noop);
    });
};

MongoDB.prototype.getUser = function (email, callback) {
    dbQueue(function () {
        nodeify(userscol.findOne({
            email
        }, {
            projection: {
                _id: 0
            }
        }), function (err, data) {
            if (err) {
                callback(err);
                return;
            }

            if (!data) {
                callback('UserNotFound');
                return;
            }

            var user = new User();

            user.login(email, data, function () {
                callback(null, user);
            });
        });
    });
};

MongoDB.prototype.deleteUser = function (email, callback) {
    var that = this;

    dbQueue(function () {
        that.getUser(email, function (err, user) {
            if (err) {
                if (callback) callback(err);
                return;
            }

            nodeify(userscol.deleteOne({
                email
            }), function (error, data) {
                if (callback) callback(error || null, error ? false : true);
            });
        });
    });
};

MongoDB.prototype.getUserByUid = function (uid, opts, callback) {
    if (typeof opts === 'function') {
        callback = opts;
        opts = {};
    }

    if (typeof uid === 'string') {
        uid = parseInt(uid);

        if (isNaN(uid)) {
            callback('UidNotANumber');
            return;
        }
    }

    var isArray = Array.isArray(uid);

    if (!Array.isArray(uid))
        uid = [uid];

    var out = {};
    var len = 0;

    dbQueue(function () {
        nodeify(userscol.find({
            _id: {
                $in: uid
            }
        }, {
            projection: {
                _id: 0
            }
        }).toArray(), function (err, data) {
            if (err || !data || data.length == 0) {
                callback('SomeUsersNotFound', out);
                return;
            }

            data.forEach(function (userobj) {
                var user = new User();

                user.login(userobj.email, userobj, opts, function () {
                    if (isArray)
                        out[userobj.uid] = user;
                    else
                        out = user;

                    console.log('Initialized user ' + user.email);
                    if (++len == data.length) {
                        if (uid.length == data.length) callback(null, out);
                        else callback('SomeUsersNotFound', out);
                    }
                });
            });
        });
    });
};

MongoDB.prototype.getUserByName = function (name, opts, callback) {
    if (typeof opts === 'function') {
        callback = opts;
        opts = {};
    }

    dbQueue(function () {
        nodeify(userscol.findOne({
            un: name
        }, {
            projection: {
                _id: 0
            }
        }), function (err, userobj) {
            if (err || !userobj) {
                if (callback) callback('UserNotFound');
                return;
            }

            var user = new User();

            user.login(userobj.email, userobj, opts, function () {
                if (callback) callback(null, user);
            });
        });
    });
};

MongoDB.prototype.userEmailExists = function (key, callback) {
    dbQueue(function () {
        nodeify(userscol.findOne({
            email: key
        }, {
            projection: {
                _id: 0
            }
        }), function (err, data) {
            if (callback) callback(err, data ? true : false);
        });
    });
};

// ChatDB
MongoDB.prototype.logChat = function (uid, msg, special, callback) {
    dbQueue(function () {
        getNextSequence('chat', 'CIDCOUNTER', function (currentCID) {
            nodeify(chatcol.insertOne({
                _id: currentCID,
                uid,
                msg,
                special
            }), function (error, data) {
                if (callback) callback(error, currentCID);
            });
        });
    });
};

// PmDB
MongoDB.prototype.logPM = function (from, to, msg, callback) {
    dbQueue(function () {
        getNextSequence('pms', 'PMIDCOUNTER', function (currentCID) {
            nodeify(pmscol.insertOne({
                _id: currentCID,
                msg,
                from,
                to,
                time: new Date(),
                unread: true
            }), function (error, data) {
                if (error) log.error('Error logging chat message');
                if (callback) callback(error, currentCID);
            });
        });
    });
};

MongoDB.prototype.getConversation = function (from, to, callback) {
    dbQueue(function () {
        nodeify(pmscol.find({
            $or: [{
                from,
                to
            }, {
                from: to,
                to: from
            }]
        }, {
            projection: {
                _id: 0
            }
        }).toArray(), function (err, data) {
            if (err) {
                callback(err);
            } else {
                var out = [];
                for (var key in data) {
                    out.push({
                        message: data[key].msg,
                        time: data[key].time,
                        from: data[key].from
                    });
                }
                callback(null, out);
            }
        });
    });
};

MongoDB.prototype.getConversations = function (uid, callback) {
    var that = this;

    dbQueue(function () {
        nodeify(pmscol.find({
            $or: [{
                from: uid
            }, {
                to: uid
            }]
        }, {
            projection: {
                _id: 0
            }
        }).toArray(), function (err, data) {
            if (err) {
                callback(err);
            } else {
                var out = {};
                var uids = [];
                for (var key in data) {
                    var otherUid = data[key].to == uid ? data[key].from : data[key].to;

                    if (out[otherUid] === undefined) {
                        uids.push(otherUid);
                        out[otherUid] = {
                            user: null,
                            messages: [],
                            unread: 0
                        };
                    }
                    out[otherUid].messages.push({
                        message: data[key].msg,
                        time: data[key].time,
                        from: data[key].from
                    });

                    if (data[key].unread && data[key].from != uid)
                        out[otherUid].unread++;
                }

                if (uids.length > 0) {
                    that.getUserByUid(uids, function (err, result) {
                        if (err) {
                            callback(err);
                        } else {
                            for (var id in result) {
                                if (out[id]) {
                                    out[id].user = result[id].getClientObj();
                                }
                            }
                            callback(null, out);
                        }
                    });
                } else {
                    callback(null, out);
                }
            }
        });
    });
};

MongoDB.prototype.markConversationRead = function (uid, uid2, time) {
    dbQueue(function () {
        nodeify(pmscol.updateMany({
            to: uid,
            from: uid2,
            time: {
                $lt: new Date(time)
            }
        }, {
            $set: {
                unread: false
            }
        }), noop);
    });
};

// IpDB
MongoDB.prototype.logIp = function (address, uid) {
    dbQueue(function () {
        nodeify(ipcol.insertOne({
            uid,
            address,
            time: new Date()
        }), noop);
    });
};

MongoDB.prototype.getIpHistory = function (uid, callback) {
    dbQueue(function () {
        nodeify(ipcol.find({
            uid
        }, {
            projection: {
                _id: 0,
                uid: 0
            }
        }).toArray(), function (err, data) {
            if (err) {
                callback(err);
                return;
            }

            // One entry per address (the most recent one), newest first.
            // (The comparators used to return booleans, which no longer sorts
            // anything on current V8.)
            var seen = new Set();

            callback(null, data.sort(function (a, b) {
                return b.time - a.time;
            }).filter(function (e) {
                if (seen.has(e.address)) return false;
                seen.add(e.address);
                return true;
            }));
        });
    });
};

module.exports = MongoDB;