import type { Cookies } from '@sveltejs/kit';
import type { Db } from '../db/client.ts';
import { sessionCookie } from './access.ts';
import {
	createSession,
	deleteExpiredSessions,
	deleteSession,
	type SessionKind
} from './session.ts';

/**
 * Signs a parent or a child in on this browser. Any session of the same kind the browser
 * already had is ended first, so a session token never carries over from before sign-in
 * to after it.
 */
export function startSession(
	db: Db,
	cookies: Cookies,
	url: URL,
	kind: SessionKind,
	subjectId: number
): void {
	const cookie = sessionCookie(kind, url);

	const previous = cookies.get(cookie.name);
	if (previous) deleteSession(db, previous);
	deleteExpiredSessions(db);

	const { token, expiresAt } = createSession(db, kind, subjectId);
	cookies.set(cookie.name, token, { ...cookie.options, expires: expiresAt });
}

export function endSession(db: Db, cookies: Cookies, url: URL, kind: SessionKind): void {
	const cookie = sessionCookie(kind, url);
	const token = cookies.get(cookie.name);
	if (token) deleteSession(db, token);
	cookies.delete(cookie.name, cookie.options);
}

export const startParentSession = (db: Db, cookies: Cookies, url: URL, parentId: number) =>
	startSession(db, cookies, url, 'parent', parentId);

export const endParentSession = (db: Db, cookies: Cookies, url: URL) =>
	endSession(db, cookies, url, 'parent');
