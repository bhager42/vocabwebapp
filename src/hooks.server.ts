import type { Handle, ServerInit } from '@sveltejs/kit/hooks';
import { ORIGIN } from '$app/env/private';
import path from 'node:path';
import { loadContent } from '#lib/server/content/load.ts';
import { seedBuiltinWords } from '#lib/server/content/seed.ts';
import { getDb } from '#lib/server/db/index.ts';
import { securityHeaders } from '#lib/server/security-headers.ts';

const headers = securityHeaders({ https: ORIGIN?.startsWith('https://') ?? false });

// Open the database and run migrations at startup, so a bad DATA_DIR fails fast,
// then bring the built-in word lists up to date with the content files shipped in ./content.
export const init: ServerInit = () => {
	const result = seedBuiltinWords(getDb(), loadContent(path.resolve('content')));
	if (result.inserted || result.updated || result.deactivated) {
		console.log(
			`Word lists updated: ${result.inserted} added, ${result.updated} changed, ${result.deactivated} retired.`
		);
	}
};

// Sessions and rate limiting are added here in Phase 4.
export const handle: Handle = async ({ event, resolve }) => {
	const response = await resolve(event);
	for (const [name, value] of Object.entries(headers)) {
		response.headers.set(name, value);
	}
	return response;
};
