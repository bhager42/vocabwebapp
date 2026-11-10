import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Db } from '../db/client.ts';
import { authSession } from '../db/schema.ts';
import { createTestDb } from '../test-db.ts';
import {
	createSession,
	deleteExpiredSessions,
	deleteSession,
	deleteSessionsFor,
	hashToken,
	readSession
} from './session.ts';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

const start = new Date('2026-11-09T12:00:00Z');
const after = (ms: number) => new Date(start.getTime() + ms);

let db: Db;
let close: () => void;

beforeEach(() => ({ db, close } = createTestDb()));
afterEach(() => close());

const rows = () => db.select().from(authSession).all();

describe('sessions', () => {
	it('stores only a hash of the token', () => {
		const { token } = createSession(db, 'parent', 1, start);

		expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/); // 256 random bits
		expect(rows()).toHaveLength(1);
		expect(rows()[0].tokenHash).toBe(hashToken(token));
		expect(JSON.stringify(rows())).not.toContain(token);
	});

	it('gives every session a different token', () => {
		const tokens = new Set(
			Array.from({ length: 20 }, () => createSession(db, 'parent', 1, start).token)
		);
		expect(tokens.size).toBe(20);
	});

	it('finds a session by its token', () => {
		const { token } = createSession(db, 'parent', 7, start);

		expect(readSession(db, token, 'parent', after(MINUTE))).toMatchObject({
			kind: 'parent',
			subjectId: 7
		});
	});

	it('rejects unknown tokens', () => {
		createSession(db, 'parent', 1, start);
		expect(readSession(db, 'not-a-real-token', 'parent', start)).toBeNull();
	});

	it('never lets a child session act as a parent session, or the reverse', () => {
		const child = createSession(db, 'child', 1, start);
		const parent = createSession(db, 'parent', 1, start);

		expect(readSession(db, child.token, 'parent', start)).toBeNull();
		expect(readSession(db, parent.token, 'child', start)).toBeNull();
		expect(readSession(db, child.token, 'child', start)).not.toBeNull();
	});

	it('ends a parent session after 12 hours without use', () => {
		const { token } = createSession(db, 'parent', 1, start);

		expect(readSession(db, token, 'parent', after(12 * HOUR - MINUTE))).not.toBeNull();
		// That read counted as use, so the 12 hours start again from there.
		expect(readSession(db, token, 'parent', after(24 * HOUR - 2 * MINUTE))).not.toBeNull();
		expect(readSession(db, token, 'parent', after(36 * HOUR))).toBeNull();
		expect(rows()).toHaveLength(0);
	});

	it('ends a parent session after 7 days even if it is used every hour', () => {
		const { token, expiresAt } = createSession(db, 'parent', 1, start);
		expect(expiresAt).toEqual(after(7 * DAY));

		for (let hour = 1; hour < 7 * 24; hour++) {
			expect(readSession(db, token, 'parent', after(hour * HOUR))).not.toBeNull();
		}
		expect(readSession(db, token, 'parent', after(7 * DAY))).toBeNull();
		expect(rows()).toHaveLength(0);
	});

	it('keeps a child session for 30 days', () => {
		const { token } = createSession(db, 'child', 1, start);

		expect(readSession(db, token, 'child', after(29 * DAY))).not.toBeNull();
		expect(readSession(db, token, 'child', after(30 * DAY))).toBeNull();
	});

	it('updates "last seen" at most once a minute', () => {
		const { token } = createSession(db, 'parent', 1, start);

		readSession(db, token, 'parent', after(30_000));
		expect(rows()[0].lastSeenAt).toEqual(start);

		readSession(db, token, 'parent', after(90_000));
		expect(rows()[0].lastSeenAt).toEqual(after(90_000));
	});

	it('deletes one session on sign-out', () => {
		const first = createSession(db, 'parent', 1, start);
		const second = createSession(db, 'parent', 1, start);

		deleteSession(db, first.token);

		expect(readSession(db, first.token, 'parent', start)).toBeNull();
		expect(readSession(db, second.token, 'parent', start)).not.toBeNull();
	});

	it('signs a person out everywhere, optionally keeping the current session', () => {
		const here = createSession(db, 'parent', 1, start);
		createSession(db, 'parent', 1, start);
		createSession(db, 'parent', 1, start);
		const child = createSession(db, 'child', 1, start);

		expect(deleteSessionsFor(db, 'parent', 1, hashToken(here.token))).toBe(2);
		expect(readSession(db, here.token, 'parent', start)).not.toBeNull();

		expect(deleteSessionsFor(db, 'parent', 1)).toBe(1);
		expect(readSession(db, here.token, 'parent', start)).toBeNull();
		// Someone else's sessions are untouched.
		expect(readSession(db, child.token, 'child', start)).not.toBeNull();
	});

	it('clears out sessions past their absolute limit', () => {
		createSession(db, 'parent', 1, start);
		createSession(db, 'parent', 1, after(DAY));

		deleteExpiredSessions(db, after(7 * DAY));

		expect(rows()).toHaveLength(1);
	});
});
