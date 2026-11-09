/**
 * Response headers set on every request by `hooks.server.ts`. See PLAN.md section 4.3.
 *
 * The Content-Security-Policy header is not here: SvelteKit generates it per request
 * (with a fresh nonce) from the `csp` config in `vite.config.ts`.
 *
 * `server.js` repeats the subset that also matters for static files, because those
 * are served without passing through SvelteKit hooks. Keep the two in sync.
 */
export function securityHeaders(options: { https: boolean }): Record<string, string> {
	const headers: Record<string, string> = {
		'X-Content-Type-Options': 'nosniff',
		'Referrer-Policy': 'no-referrer',
		'Cross-Origin-Opener-Policy': 'same-origin',
		'Cross-Origin-Resource-Policy': 'same-origin',
		// Legacy equivalent of the CSP `frame-ancestors 'none'` directive.
		'X-Frame-Options': 'DENY',
		'Permissions-Policy': DISABLED_FEATURES.map((feature) => `${feature}=()`).join(', ')
	};

	// Only promise HTTPS when the app is actually served over HTTPS.
	if (options.https) {
		headers['Strict-Transport-Security'] = 'max-age=31536000; includeSubDomains';
	}

	return headers;
}

const DISABLED_FEATURES = [
	'accelerometer',
	'bluetooth',
	'browsing-topics',
	'camera',
	'display-capture',
	'geolocation',
	'gyroscope',
	'hid',
	'magnetometer',
	'microphone',
	'midi',
	'payment',
	'serial',
	'usb'
];
