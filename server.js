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

const { handler } = await import('./build/handler.js');

const server = http.createServer((req, res) => {
	req.headers[PROTOCOL_HEADER] = protocol;
	req.headers[HOST_HEADER] = origin.host;

	res.setHeader('X-Content-Type-Options', 'nosniff');
	res.setHeader('Referrer-Policy', 'no-referrer');
	res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
	if (isHttps) {
		res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
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
