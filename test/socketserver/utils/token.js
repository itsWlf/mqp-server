// ava is ESM-only, require() gets the module namespace
const test = require('ava').default;
const Token = require('./../../../socketserver/utils/index').token;

const secret = 'mqp-test-secret';

test('round-trip with the default loginExpire', (t) => {
	const token = Token.createToken({ email: 'user@example.com' }, secret, '5d');
	const decoded = Token.verify(token, secret);
	t.is(decoded.email, 'user@example.com');
	t.is(decoded.exp - decoded.iat, 5 * 24 * 60 * 60);
	t.is(Token.decode(token).email, 'user@example.com');
});

test('callback style verify', (t) => new Promise((resolve) => {
	Token.verify(Token.createToken({ email: 'a@b.c' }, secret, '10h'), secret, (err, decoded) => {
		t.is(err, null);
		t.is(decoded.email, 'a@b.c');
		resolve();
	});
}));

test('no loginExpire configured gives a non-expiring token', (t) => {
	const decoded = Token.verify(Token.createToken({ email: 'a@b.c' }, secret, undefined), secret);
	t.is(decoded.exp, undefined);
});

// jsonwebtoken's errors aren't native Error instances, hence `any: true`
test('wrong secret and expired tokens are rejected', (t) => {
	const token = Token.createToken({ email: 'a@b.c' }, secret, '5d');
	t.throws(() => Token.verify(token, 'other-secret'), { any: true, name: 'JsonWebTokenError' });
	t.throws(() => Token.verify(Token.createToken({ email: 'a@b.c' }, secret, -10), secret), { any: true, name: 'TokenExpiredError' });
});

test('tokens issued by jsonwebtoken 7 still verify', (t) => {
	const v7 = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJlbWFpbCI6InVzZXJAZXhhbXBsZS5jb20iLCJpYXQiOjE3OTQ2ODIyMTEsImV4cCI6NDk1MDQ0MjIxMX0.EIf5gVHbzhtz50ROdCo5be_ZgFHpkBb-9Jt8lJNvXrc';
	t.is(Token.verify(v7, secret).email, 'user@example.com');
});
