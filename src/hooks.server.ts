import type { Handle, ServerInit } from '@sveltejs/kit/hooks';
import { ORIGIN } from '$app/env/private';
import { getDb } from '#lib/server/db/index.ts';
import { securityHeaders } from '#lib/server/security-headers.ts';

const headers = securityHeaders({ https: ORIGIN?.startsWith('https://') ?? false });

// Open the database and run migrations at startup, so a bad DATA_DIR fails fast.
export const init: ServerInit = () => {
	getDb();
};

// Sessions and rate limiting are added here in Phase 4.
export const handle: Handle = async ({ event, resolve }) => {
	const response = await resolve(event);
	for (const [name, value] of Object.entries(headers)) {
		response.headers.set(name, value);
	}
	return response;
};
