import path from 'node:path';
import { redirect } from '@sveltejs/kit';
import type { Handle, ServerInit } from '@sveltejs/kit/hooks';
import { ORIGIN } from '$app/env/private';
import {
	isPrivatePath,
	LOGIN_PATH,
	requiresParent,
	sessionCookie
} from '#lib/server/auth/access.ts';
import { getParent } from '#lib/server/auth/parent.ts';
import { readSession } from '#lib/server/auth/session.ts';
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

export const handle: Handle = async ({ event, resolve }) => {
	const { cookies, locals, url } = event;

	// parseTheme only ever returns one of three fixed words, so it is safe to write into HTML.
	const theme = parseTheme(cookies.get(THEME_COOKIE));
	locals.theme = theme;

	// ---- Who is this? ----
	locals.parent = null;
	locals.parentSession = null;
	const cookie = sessionCookie('parent', url);
	const token = cookies.get(cookie.name);
	if (token) {
		const db = getDb();
		const session = readSession(db, token, 'parent');
		const account = session && getParent(db, session.subjectId);
		if (session && account) {
			locals.parent = account;
			locals.parentSession = session.tokenHash;
		} else {
			// Expired, signed out elsewhere, or made up: stop sending it.
			cookies.delete(cookie.name, cookie.options);
		}
	}

	// ---- Are they allowed here? ----
	// This is the one place that guards everything under /parent, whatever the method.
	// Each page's load function and actions check again (see auth/guard.ts), so a route
	// is still safe if it is ever moved out from under this prefix.
	if (requiresParent(url.pathname) && !locals.parent) {
		redirect(303, LOGIN_PATH);
	}

	const response = await resolve(event, {
		// Fill in the placeholders in src/app.html so the theme is part of the first
		// bytes of the page and there is no flash of the wrong colors.
		transformPageChunk: ({ html }) =>
			html.replace('%vocab.theme%', theme).replace('%vocab.colorScheme%', colorSchemeFor(theme))
	});

	for (const [name, value] of Object.entries(headers)) {
		response.headers.set(name, value);
	}
	// Pages about the family must not linger in the browser's cache or its back button.
	if (isPrivatePath(url.pathname)) {
		response.headers.set('Cache-Control', 'no-store');
	}
	return response;
};
