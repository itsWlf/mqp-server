const jwt = require("jsonwebtoken");

module.exports = {
	createToken(payload, secret, expires) {
		// jsonwebtoken >= 8 throws on `expiresIn: undefined`; leaving the option out
		// keeps the old behaviour (non expiring token) when no expiry is configured
		return jwt.sign(payload, secret, expires === undefined ? {} : {
			expiresIn: expires
		});
	},
	verify: jwt.verify,
	decode: jwt.decode,
}
