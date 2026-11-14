// ava is ESM-only, require() gets the module namespace
const test = require('ava').default;
const crypto = require('crypto');
const Hash = require('./../../../socketserver/utils/index').hash;

// The client sends the SHA-256 hex digest of the password
const clientPw = crypto.createHash('sha256').update('hunter2').digest('hex');

// Hashes created by bcrypt-nodejs (the library used before bcryptjs)
const legacy = {
	[clientPw]: '$2a$04$BFH2IIsa3PHUku3Bmvk6jOz87UcHXp0hBXYkeNIJDh6e/ATkunXw2',
	'pässwörd': '$2a$04$JDEotxAI1NzyhQoh357ApeenjcscdridM.cAXp2rZs1QwNgLdwHeu',
	hunter2: '$2a$12$tV5MyUII4pL1iRqT0ixzievgu7a74IbCDRrHXn7Uh6hdn5jYbDogK',
};

test('bcrypt-nodejs hashes still verify', (t) => {
	for (const [pw, hash] of Object.entries(legacy)) {
		t.true(Hash.compareBcrypt(pw, hash), pw);
		t.false(Hash.compareBcrypt(`${pw}x`, hash), `${pw}x`);
	}
});

test('new hashes round-trip', (t) => {
	const hash = Hash.bcrypt(clientPw);
	t.regex(hash, /^\$2[ab]\$12\$/);
	t.true(Hash.compareBcrypt(clientPw, hash));
	t.false(Hash.compareBcrypt('wrong', hash));
});

test('non-string input is stringified like bcrypt-nodejs did', (t) => {
	t.true(Hash.compareBcrypt(123456, Hash.bcrypt(123456)));
	t.true(Hash.compareBcrypt('123456', Hash.bcrypt(123456)));
});

test('missing password or invalid stored hash fails instead of throwing', (t) => {
	t.false(Hash.compareBcrypt(undefined, legacy.hunter2));
	t.false(Hash.compareBcrypt('hunter2', undefined));
	t.false(Hash.compareBcrypt('hunter2', 'not a hash'));
	t.false(Hash.compareBcrypt('hunter2', Hash.md5('hunter2')));
});

test('md5 helpers', (t) => {
	t.is(Hash.md5('hunter2'), '2ab96390c7dbe3439de74d0c9b0b1767');
	t.true(Hash.isMD5(Hash.md5('x')));
	t.false(Hash.isMD5(legacy.hunter2));
});
