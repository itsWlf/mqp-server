'use strict';
const nodemailer = require('nodemailer');
const fs = require('fs-extra');
const nconf = require('nconf');
const ejs = require('ejs');

// Builds the nodemailer transport options for the configured transport mode
// from room:mail:options. Works on a copy so nothing is written back into the
// nconf store (and from there into config.hjson on the next nconf.save()).
function transportOptions(transport, configOptions) {
	const options = JSON.parse(JSON.stringify(configOptions || {}));

	// nodemailer 2 defaulted to port 25 for plain SMTP, newer versions use 587
	if (options.port === undefined && !options.service && !options.url && !options.secure) {
		options.port = 25;
	}

	switch (transport) {
		case 'smtp':
			return options;
		case 'xoauth': {
			// The xoauth2 module is gone, nodemailer has OAuth2 built in. Keep accepting
			// the old `auth: { xoauth: { user, clientId, ... } }` layout from the config.
			const auth = options.auth || {};
			if (auth.xoauth) {
				options.auth = Object.assign({ type: 'OAuth2' }, auth.xoauth);
			} else if (!auth.type) {
				options.auth = Object.assign({ type: 'OAuth2' }, auth);
			}
			return options;
		}
		case 'direct': {
			const domain = nconf.get('room:mail:sender').split('@')[1];
			options.name = domain;
			return options;
		}
		default:
			return null;
	}
}

class Mailer {
	constructor() {
		const self = this;

		if (nconf.get('room:allowrecovery') || nconf.get('room:mail:confirmation')) {
			const options = transportOptions(nconf.get('room:mail:transport'), nconf.get('room:mail:options'));
			if (options) {
				self.transporter = nodemailer.createTransport(options);
			}
		}
	}

	sendEmail(type, opts, receiver, callback) {
		const html = ejs.render(fs.readFileSync(`socketserver/mail/templates/${type}.html`, 'utf8'), {
			opts,
			room: nconf.get('room'),
		});

		let subject;
		switch (type) {
			case 'signup':
				subject = 'Welcome to musiqpad!';
				break;
			case 'recovery':
				subject = 'Password recovery';
				break;
			default:
				break;
		}

		const emailObj = {
			from: nconf.get('room:mail:sender'),
			to: receiver,
			subject,
			html,
		};

		this.transporter.sendMail(emailObj, (error, response) => {
			if (error) callback(error);
			else callback(null, response);
		});
	}
}

module.exports = new Mailer();
