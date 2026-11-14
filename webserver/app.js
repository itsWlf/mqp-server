'use strict';
const express = require('express');
const compression = require('compression');
const path = require('path');
const http = require('http');
const https = require('https');
const fs = require('fs');
const nconf = require('nconf');
const ejs = require('ejs');
const helmet = require('helmet');

const app = express();
let server2 = null;
let server = null;
// eslint-disable-next-line
let socketServer = null;

/* SSL */
if (nconf.get('useSSL') && nconf.get('certificate') && nconf.get('certificate:key') && nconf.get('certificate:cert')) {
	const certificate = {
		key: fs.readFileSync(nconf.get('certificate:key')),
		cert: fs.readFileSync(nconf.get('certificate:cert')),
	};

	server = https.createServer(certificate, app);
	if (nconf.get('webServer:redirectHTTP') && nconf.get('webServer:redirectPort') !== '') {
		server2 = http.createServer(app);
	}
} else {
	server = http.createServer(app);
}

if (nconf.get('webServer:redirectHTTP')) {
	app.use((req, res, next) => {
		if (!req.secure) {
			return res.redirect(['https://', req.hostname, ':', nconf.get('webServer:port') || process.env.PORT, req.url].join(''));
		}
		next();
	});
}

app.set('view engine', 'html');
app.set('views', `${__dirname}/public`);
app.engine('html', ejs.renderFile);
app.use(compression());
// Helmet's defaults (CSP, X-Frame-Options: SAMEORIGIN, no X-Powered-By, nosniff, ...)
// adjusted so the bundled front-end keeps working: it pulls scripts from CDNs,
// YouTube, reCAPTCHA, Facebook and the operator's room.scripts URLs (http or https),
// uses inline event handlers in chat HTML, shows images posted by users from any host,
// fetches emote lists from third party APIs, embeds YouTube/lounge iframes and opens a
// websocket to the socket server, which normally runs on a different port.
app.use(helmet({
	contentSecurityPolicy: {
		directives: {
			'script-src': ["'self'", "'unsafe-eval'", 'http:', 'https:'],
			'script-src-attr': ["'unsafe-inline'"],
			'style-src': ["'self'", "'unsafe-inline'", 'http:', 'https:'],
			'font-src': ["'self'", 'data:', 'http:', 'https:'],
			'img-src': ['*', 'data:', 'blob:'],
			'media-src': ['*', 'data:', 'blob:'],
			'connect-src': ['*', 'ws:', 'wss:'],
			'frame-src': ["'self'", 'http:', 'https:'],
			// Would turn the ws:// socket connection of a non-SSL pad into wss://
			'upgrade-insecure-requests': null,
		},
	},
	// Keep window.opener for popups the page opens (Facebook login)
	crossOriginOpenerPolicy: { policy: 'same-origin-allow-popups' },
	// Pad assets are public and were embeddable from other sites before
	crossOriginResourcePolicy: { policy: 'cross-origin' },
	// YouTube's embedded player refuses to play without a Referer header
	referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
	// Not sent before; HSTS would keep browsers on https for a year even if the
	// operator turns useSSL off again
	strictTransportSecurity: false,
}));

app.get(['/', '/index.html'], (req, res) => {
	res.render('index', {
		tags: nconf.get('room:tags'),
		room: nconf.get('room'),
		scripts: nconf.get('room:scripts'),
	});
});

app.use('/pads', express.static(path.resolve(__dirname, 'public')));
app.use(express.static(path.resolve(__dirname, 'public')));

app.get('/config', (req, res) => {
	res.setHeader('Content-Type', 'application/javascript');
	res.send(fs.readFileSync(`${__dirname}/public/lib/js/webconfig.js`));
});

app.get('/api/room', (req, res) => {
	const roomInfo = {
		slug: nconf.get('room:slug'),
		name: nconf.get('room:name'),
		people: null,
		queue: null,
		media: null,
	};
	res.send(roomInfo);
});

server.listen(nconf.get('webServer:port') || process.env.PORT, nconf.get('webServer:address') || process.env.IP, () => {
	const addr = server.address();
	console.log('Webserver listening at', `${addr.address}:${addr.port}`);
});

if (server2 != null) {
	server2.listen(nconf.get('webServer:redirectPort') || 80, nconf.get('webServer:address') || process.env.IP, () => {
		const addr2 = server2.address();
		console.log('HTTP Webserver listening at', `${addr2.address}:${addr2.port}`);
	});
}

const setSocketServer = ss => {
	socketServer = ss;
};

module.exports = {
	app,
	server,
	server2,
	setSocketServer,
};
