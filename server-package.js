var childProcess = require('child_process');
var psTree = require('ps-tree');
var log = new(require('basic-logger'))({
    showTimestamp: true,
    prefix: "ServerContainer"
});
var fs = require('fs');

var extend = require('extend');

var server = function (params) {
	var that = this;
	this.settings = {
		forever: {
			enabled: false,
			options: {
				root: './logs',
				pidPath: './pids',
				sockPath: './sock',
				debug: false,
				stream: false
			}
		}
	}
	extend(true, this.settings, params);

	this.start = function() {
    if(this.settings.config) {
      var config = this.settings.config;
      // fs no longer coerces objects, so serialize a config passed as an object
      if (typeof config !== 'string' && !Buffer.isBuffer(config)) config = JSON.stringify(config, null, 2);
      fs.writeFileSync('./config.hjson', config, 'utf8');
    }
		if (this.settings.forever.enabled) {
			// Built-in replacement for forever: keep start.js alive by
			// respawning it whenever it exits, until stop() is called.
			// (forever.options is still accepted but no longer used.)
			that.stopped = false;
			(function spawn() {
				that.proc = runScript('./start.js', function (err) {
					if (that.stopped) return;
					log.error('start.js ' + (err ? 'failed to start (' + err.message + ')' : 'exited') + ', restarting');
					that.restartTimer = setTimeout(spawn, 1000);
				});
				that.pid = that.proc.pid;
			})();
		}
		else {
			that.proc = runScript('./start.js', function (err) {
				if (err) throw err;
			});
		}
	};

	this.stop = function() {
		stopServer();
	};

	function stopServer() {
		if (that.settings.forever.enabled) {
			that.stopped = true;
			clearTimeout(that.restartTimer);
		}
		that.proc.kill('SIGINT');
		//kill(that.pid);
		log.info('Stopping Server Container');
	}
}

function runScript(scriptPath, callback) {
    var invoked = false;
    var proc = childProcess.fork(scriptPath);

    proc.on('error', function (err) {
        if (invoked) return;
        invoked = true;
        callback(err);
    });

    proc.on('exit', function (code) {
        if (invoked) return;
        invoked = true;
        //var err = code === 0 ? null : new Error('exit code ' + code);
        callback();
    });
	return proc;
}

function kill(pid, signal, callback) {
    signal   = signal || 'SIGKILL';
    callback = callback || function () {};
    var killTree = true;
    if(killTree) {
        psTree(pid, function (err, children) {
            [pid].concat(
                children.map(function (p) {
                    return p.PID;
                })
            ).forEach(function (tpid) {
                try { process.kill(tpid, signal) }
                catch (ex) { }
            });
            callback();
        });
    } else {
        try { process.kill(pid, signal) }
        catch (ex) { }
        callback();
    }
};

module.exports = server;