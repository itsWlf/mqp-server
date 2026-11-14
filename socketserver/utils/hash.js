const crypto = require('crypto');
const bcrypt = require('bcryptjs');

module.exports = {
	md5(str) {
		const hash = crypto.createHash('md5');
		hash.update(str);
		return hash.digest('hex');
	},
	isMD5(hash) {
		return (/[a-fA-F0-9]{32}/).test(hash);
	},
	bcrypt(str) {
		const salt = bcrypt.genSaltSync(12);
		// bcrypt-nodejs stringified any input, bcryptjs throws on non-strings
		return bcrypt.hashSync(String(str), salt);
	},
	// Also verifies the $2a$ hashes created by bcrypt-nodejs.
	// Returns false (instead of throwing like bcrypt-nodejs did) for a missing
	// password or a stored value that isn't a bcrypt hash.
	compareBcrypt(str, hash) {
		if (str == null || typeof hash !== 'string') return false;
		return bcrypt.compareSync(String(str), hash);
	},
}
