const js = require('@eslint/js');
const globals = require('globals');

module.exports = [
	{
		// Vendored and minified browser libraries
		ignores: [
			'node_modules/**',
			'webserver/public/lib/js/*.min.js',
			'webserver/public/lib/js/jquery.*.js',
			'webserver/public/lib/js/angular-minicolors.js',
			'webserver/public/lib/js/minicolors.js',
			'webserver/public/lib/js/sha256.js',
			'webserver/public/lib/js/webconfig.js',
		],
	},
	js.configs.recommended,
	{
		languageOptions: {
			ecmaVersion: 'latest',
			sourceType: 'commonjs',
			globals: {
				...globals.node,
			},
		},
		rules: {
			'no-unused-vars': 'warn',
			'no-empty': 'warn',
			'no-useless-escape': 'warn',
			'no-prototype-builtins': 'warn',
			'guard-for-in': 'warn',
		},
	},
	{
		files: ['webserver/public/**/*.js'],
		languageOptions: {
			sourceType: 'script',
			globals: {
				...globals.browser,
				...globals.jquery,
			},
		},
	},
];
