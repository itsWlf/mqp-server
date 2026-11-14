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
			// Pre-existing patterns in the legacy code base: reported, not blocking
			'no-redeclare': 'warn',
			'no-fallthrough': 'warn',
			'no-case-declarations': 'warn',
			'no-setter-return': 'warn',
			'no-useless-assignment': 'warn',
			'no-constant-binary-expression': 'warn',
			'valid-typeof': 'warn',
			'preserve-caught-error': 'warn',
		},
	},
	{
		files: ['webserver/public/**/*.js'],
		rules: {
			'no-undef': 'warn',
		},
		languageOptions: {
			sourceType: 'script',
			globals: {
				...globals.browser,
				...globals.jquery,
				// Loaded from third-party script tags
				FB: 'readonly',
			},
		},
	},
];
