import path from 'node:path';
import type { Handle, ServerInit } from '@sveltejs/kit/hooks';
import { ORIGIN } from '$app/env/private';
import { loadContent } from '#lib/server/content/load.ts';
import { seedBuiltinWords } from '#lib/server/content/seed.ts';
import { getDb } from '#lib/server/db/index.ts';
import { securityHeaders } from '#lib/server/security-headers.ts';
import { colorSchemeFor, parseTheme, THEME_COOKIE } from '#lib/theme.ts';

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
	// parseTheme only ever returns one of three fixed words, so it is safe to write into HTML.
	const theme = parseTheme(event.cookies.get(THEME_COOKIE));
	event.locals.theme = theme;

	const response = await resolve(event, {
		// Fill in the placeholders in src/app.html so the theme is part of the first
		// bytes of the page and there is no flash of the wrong colors.
		transformPageChunk: ({ html }) =>
			html.replace('%vocab.theme%', theme).replace('%vocab.colorScheme%', colorSchemeFor(theme))
	});

	for (const [name, value] of Object.entries(headers)) {
		response.headers.set(name, value);
	}
	return response;
};
