// Production entry point: `node server.js` (after `npm run build`).
//
// Why this exists instead of running `node build` directly:
//
// 1. ORIGIN at runtime. SvelteKit's CSRF protection compares the browser's Origin header
//    with the origin the server believes it has. adapter-node only learns that origin at
//    build time (`paths.origin`) or from request headers, and assumes https when no proxy
//    header is present. One image has to work at http://nas-ip:30080 and behind an HTTPS
//    reverse proxy, so the origin is taken from the ORIGIN environment variable and handed
//    to the adapter through two private headers that are overwritten on every request,
//    so a client can never supply them.
//
// 2. Static files do not pass through SvelteKit hooks, so the security headers that matter
//    for them are set here. Keep in sync with src/lib/server/security-headers.ts.

import http from 'node:http';
import process from 'node:process';

const PROTOCOL_HEADER = 'x-vocab-origin-proto';
const HOST_HEADER = 'x-vocab-origin-host';

function fail(message) {
	console.error(`server.js: ${message}`);
	process.exit(1);
}

if (!process.env.ORIGIN) {
	fail(
		'ORIGIN is not set. Set it to the exact URL origin used to reach the app, e.g. http://192.168.1.10:30080'
	);
}

let origin;
try {
	origin = new URL(process.env.ORIGIN);
} catch {
	fail(`ORIGIN is not a valid URL: ${process.env.ORIGIN}`);
}
if (origin.protocol !== 'http:' && origin.protocol !== 'https:') {
	fail('ORIGIN must start with http:// or https://');
}

const protocol = origin.protocol.slice(0, -1);
const isHttps = protocol === 'https';

// Read by the adapter when build/handler.js is first imported, so set them before importing.
process.env.PROTOCOL_HEADER = PROTOCOL_HEADER;
process.env.HOST_HEADER = HOST_HEADER;
delete process.env.PORT_HEADER;

// Behind a reverse proxy (TRUST_PROXY=true) the visitor's address is the last entry the
// proxy added to X-Forwarded-For. Without one, that header is whatever the client typed,
// so it is ignored and the socket address is used. Sign-in rate limiting depends on this.
if (process.env.TRUST_PROXY === 'true') {
	process.env.ADDRESS_HEADER = 'x-forwarded-for';
	process.env.XFF_DEPTH ??= '1';
} else {
	delete process.env.ADDRESS_HEADER;
}

const { handler } = await import('./build/handler.js');

// SvelteKit refuses a form sent from any address other than ORIGIN, which is right, but
// says only "Cross-site POST form submissions are forbidden". Nearly always the cause is
// that the app was opened at a different address than ORIGIN, so for a form sent without
// JavaScript the same refusal is given here with directions. (With JavaScript, SvelteKit
// answers and src/routes/+error.svelte explains.) This mirrors SvelteKit's own rule, which
// still runs for every request this lets through.
const FORM_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const FORM_TYPES = [
	'application/x-www-form-urlencoded',
	'multipart/form-data',
	'text/plain',
	'application/x-sveltekit-formdata'
];

function isRefusedForm(req) {
	if (!FORM_METHODS.has(req.method ?? '')) return false;
	if (req.headers.accept === 'application/json') return false;
	const type = (req.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase();
	if (type && !FORM_TYPES.includes(type)) return false;
	return req.headers.origin !== origin.origin;
}

// Plain text, never HTML: the address the form came from is not repeated, since a page on
// another site could be the one that sent it.
const WRONG_ADDRESS = [
	'This form was refused because the page was not opened at the address this app is',
	`set up for, which is ${origin.origin}.`,
	'',
	`Open ${origin.origin} in your browser and try again.`,
	'',
	'If that is not the address you use to reach the app, change ORIGIN in the app’s',
	'settings (on TrueNAS: Apps > vocab > Edit) to exactly what your browser shows before the',
	'first single slash, such as http://192.168.1.10:30080, then save and try again. http and',
	'https count as different, and so do a name and a number for the same machine.',
	''
].join('\n');

const server = http.createServer((req, res) => {
	req.headers[PROTOCOL_HEADER] = protocol;
	req.headers[HOST_HEADER] = origin.host;

	res.setHeader('X-Content-Type-Options', 'nosniff');
	res.setHeader('Referrer-Policy', 'same-origin');
	res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
	if (isHttps) {
		res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
	}

	if (isRefusedForm(req)) {
		req.resume();
		res.statusCode = 403;
		res.setHeader('Content-Type', 'text/plain; charset=utf-8');
		res.setHeader('Cache-Control', 'no-store');
		res.end(WRONG_ADDRESS);
		return;
	}

	handler(req, res, () => {
		res.statusCode = 404;
		res.setHeader('Content-Type', 'text/plain; charset=utf-8');
		res.end('Not found');
	});
});

const port = Number(process.env.PORT || 3000);
const host = process.env.HOST || '0.0.0.0';

server.listen(port, host, () => {
	console.log(`Listening on ${host}:${port}, serving ${origin.origin}`);
});

function shutdown() {
	server.close(() => process.exit(0));
	server.closeIdleConnections();
	// Do not hang forever on a stuck connection.
	setTimeout(() => process.exit(0), 10_000).unref();
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
