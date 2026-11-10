import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Db } from '../db/client.ts';
import { loginAttempt } from '../db/schema.ts';
import { createTestDb } from '../test-db.ts';
import { enterGate, failureDelayMs, markSuccess, minutesLeft } from './rate-limit.ts';

const MINUTE = 60_000;
const start = new Date('2026-11-09T12:00:00Z');
const after = (ms: number) => new Date(start.getTime() + ms);

let db: Db;
let close: () => void;

beforeEach(() => ({ db, close } = createTestDb()));
afterEach(() => close());

/** Makes `count` failed attempts, one second apart, starting at `from`. */
function fail(ip: string, count: number, from = start) {
	for (let index = 0; index < count; index++) {
		const gate = enterGate(db, ip, new Date(from.getTime() + index * 1000));
		expect(gate.allowed).toBe(true);
	}
}

describe('sign-in rate limit', () => {
	it('allows the first five attempts and refuses the sixth', () => {
		fail('10.0.0.1', 5);

		const gate = enterGate(db, '10.0.0.1', after(10_000));
		expect(gate.allowed).toBe(false);
	});

	it('says how long is left, counted from the first of the five failures', () => {
		fail('10.0.0.1', 5);

		const gate = enterGate(db, '10.0.0.1', after(5 * MINUTE));
		expect(gate).toEqual({ allowed: false, retryAfterMs: 10 * MINUTE });
	});

	it('does not record refused attempts, so hammering cannot extend the lock', () => {
		fail('10.0.0.1', 5);
		for (let index = 0; index < 50; index++) enterGate(db, '10.0.0.1', after(MINUTE));

		expect(db.select().from(loginAttempt).all()).toHaveLength(5);
		expect(enterGate(db, '10.0.0.1', after(15 * MINUTE + 5000)).allowed).toBe(true);
	});

	it('lets the address try again once 15 minutes have passed', () => {
		fail('10.0.0.1', 5);

		expect(enterGate(db, '10.0.0.1', after(15 * MINUTE - 1)).allowed).toBe(false);
		expect(enterGate(db, '10.0.0.1', after(15 * MINUTE)).allowed).toBe(true);
	});

	it('keeps each address separate', () => {
		fail('10.0.0.1', 5);

		expect(enterGate(db, '10.0.0.2', after(10_000)).allowed).toBe(true);
	});

	it('starts counting again after a success', () => {
		fail('10.0.0.1', 4);
		const gate = enterGate(db, '10.0.0.1', after(5000));
		if (!gate.allowed) throw new Error('expected to be allowed');
		markSuccess(db, gate.attemptId);

		// Four more failures are fine; the earlier four no longer count.
		fail('10.0.0.1', 4, after(10_000));
		expect(enterGate(db, '10.0.0.1', after(20_000)).allowed).toBe(true);
		expect(enterGate(db, '10.0.0.1', after(21_000)).allowed).toBe(false);
	});

	it('counts an attempt as a failure until it is marked a success', () => {
		// Five simultaneous guesses each enter the gate before any of them finishes.
		fail('10.0.0.1', 5);
		expect(enterGate(db, '10.0.0.1', after(6000)).allowed).toBe(false);
	});

	it('forgets attempts older than a day', () => {
		fail('10.0.0.1', 3);
		enterGate(db, '10.0.0.1', after(25 * 60 * MINUTE));

		expect(db.select().from(loginAttempt).all()).toHaveLength(1);
	});

	it('holds back the response a little longer after each failure', () => {
		const delays: number[] = [];
		for (let index = 0; index < 5; index++) {
			const now = after(index * 1000);
			enterGate(db, '10.0.0.1', now);
			delays.push(failureDelayMs(db, '10.0.0.1', now));
		}

		expect(delays).toEqual([0, 250, 500, 1000, 2000]);
	});
});

describe('minutesLeft', () => {
	it('rounds up to whole minutes and never says zero', () => {
		expect(minutesLeft(15 * MINUTE)).toBe(15);
		expect(minutesLeft(14 * MINUTE + 1)).toBe(15);
		expect(minutesLeft(500)).toBe(1);
	});
});
