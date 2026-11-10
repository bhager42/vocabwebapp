import { createHash, randomBytes } from 'node:crypto';
import { and, eq, lte, ne } from 'drizzle-orm';
import type { Db } from '../db/client.ts';
import { authSession } from '../db/schema.ts';

export type SessionKind = 'parent' | 'child';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** How long a session lasts in total, and how long it survives without being used. */
export const SESSION_LIMITS: Record<SessionKind, { absoluteMs: number; idleMs: number }> = {
	// A parent is signed out after 12 hours away, and always after 7 days.
	parent: { absoluteMs: 7 * DAY, idleMs: 12 * HOUR },
	// A child stays signed in on their usual device for 30 days.
	child: { absoluteMs: 30 * DAY, idleMs: 30 * DAY }
};

/** "Last seen" is only rewritten this often, to avoid a database write on every request. */
const TOUCH_INTERVAL_MS = MINUTE;

/** The database stores only this hash, so a leaked database cannot be used to sign in. */
export function hashToken(token: string): string {
	return createHash('sha256').update(token).digest('hex');
}

export interface Session {
	tokenHash: string;
	kind: SessionKind;
	subjectId: number;
}

/** Starts a session and returns the secret token to put in the cookie. */
export function createSession(
	db: Db,
	kind: SessionKind,
	subjectId: number,
	now = new Date()
): { token: string; expiresAt: Date } {
	const token = randomBytes(32).toString('base64url');
	const expiresAt = new Date(now.getTime() + SESSION_LIMITS[kind].absoluteMs);

	db.insert(authSession)
		.values({
			tokenHash: hashToken(token),
			kind,
			subjectId,
			createdAt: now,
			expiresAt,
			lastSeenAt: now
		})
		.run();

	return { token, expiresAt };
}

/**
 * Looks up the session for a cookie token. Returns null, and deletes the row, when the
 * session has passed its absolute limit or has been idle for too long.
 */
export function readSession(
	db: Db,
	token: string,
	kind: SessionKind,
	now = new Date()
): Session | null {
	const tokenHash = hashToken(token);
	const row = db
		.select()
		.from(authSession)
		.where(and(eq(authSession.tokenHash, tokenHash), eq(authSession.kind, kind)))
		.get();
	if (!row) return null;

	const idleFor = now.getTime() - row.lastSeenAt.getTime();
	if (now >= row.expiresAt || idleFor >= SESSION_LIMITS[kind].idleMs) {
		db.delete(authSession).where(eq(authSession.tokenHash, tokenHash)).run();
		return null;
	}

	if (idleFor >= TOUCH_INTERVAL_MS) {
		db.update(authSession)
			.set({ lastSeenAt: now })
			.where(eq(authSession.tokenHash, tokenHash))
			.run();
	}

	return { tokenHash, kind: row.kind, subjectId: row.subjectId };
}

export function deleteSession(db: Db, token: string): void {
	db.delete(authSession)
		.where(eq(authSession.tokenHash, hashToken(token)))
		.run();
}

/**
 * Ends every session for one person. Pass `exceptTokenHash` to keep the session that
 * made the request. Returns how many sessions were ended.
 */
export function deleteSessionsFor(
	db: Db,
	kind: SessionKind,
	subjectId: number,
	exceptTokenHash?: string
): number {
	const who = and(eq(authSession.kind, kind), eq(authSession.subjectId, subjectId));
	return db
		.delete(authSession)
		.where(exceptTokenHash ? and(who, ne(authSession.tokenHash, exceptTokenHash)) : who)
		.run().changes;
}

/** Removes sessions past their absolute limit. Called when someone signs in. */
export function deleteExpiredSessions(db: Db, now = new Date()): void {
	db.delete(authSession).where(lte(authSession.expiresAt, now)).run();
}
