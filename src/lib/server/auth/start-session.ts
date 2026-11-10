import type { Cookies } from '@sveltejs/kit';
import type { Db } from '../db/client.ts';
import { sessionCookie } from './access.ts';
import { createSession, deleteExpiredSessions, deleteSession } from './session.ts';

/**
 * Signs a parent in on this browser. Any session the browser already had is ended first,
 * so a session token never carries over from before sign-in to after it.
 */
export function startParentSession(db: Db, cookies: Cookies, url: URL, parentId: number): void {
	const cookie = sessionCookie('parent', url);

	const previous = cookies.get(cookie.name);
	if (previous) deleteSession(db, previous);
	deleteExpiredSessions(db);

	const { token, expiresAt } = createSession(db, 'parent', parentId);
	cookies.set(cookie.name, token, { ...cookie.options, expires: expiresAt });
}

export function endParentSession(db: Db, cookies: Cookies, url: URL): void {
	const cookie = sessionCookie('parent', url);
	const token = cookies.get(cookie.name);
	if (token) deleteSession(db, token);
	cookies.delete(cookie.name, cookie.options);
}
