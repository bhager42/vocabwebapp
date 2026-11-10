import { and, desc, eq, gt, lt } from 'drizzle-orm';
import type { Db } from '../db/client.ts';
import { loginAttempt } from '../db/schema.ts';

export interface Limit {
	/** Attempts of different kinds are counted separately. */
	scope: 'parent' | 'name';
	/** After this many failures from one address... */
	maxFailures: number;
	/** ...within this long, that address has to wait. */
	windowMs: number;
}

/** Parent sign-in and first-run setup: strict, because a password is being guessed at. */
export const PARENT_LIMIT: Limit = { scope: 'parent', maxFailures: 5, windowMs: 15 * 60_000 };

/**
 * A child typing a name: generous, because children mistype, but still bounded so the
 * page cannot be used to discover which names exist by trying thousands of them.
 */
export const NAME_LIMIT: Limit = { scope: 'name', maxFailures: 20, windowMs: 15 * 60_000 };

const KEEP_ATTEMPTS_MS = 24 * 60 * 60_000;

/** Failures from this address inside the window, counted since its last success. */
function recentFailures(db: Db, ip: string, now: Date, limit: Limit): Date[] {
	const windowStart = new Date(now.getTime() - limit.windowMs);
	const rows = db
		.select({ at: loginAttempt.at, success: loginAttempt.success })
		.from(loginAttempt)
		.where(
			and(
				eq(loginAttempt.scope, limit.scope),
				eq(loginAttempt.ip, ip),
				gt(loginAttempt.at, windowStart)
			)
		)
		.orderBy(desc(loginAttempt.at), desc(loginAttempt.id))
		.all();

	const failures: Date[] = [];
	for (const row of rows) {
		if (row.success) break;
		failures.push(row.at);
	}
	return failures;
}

export type Gate = { allowed: true; attemptId: number } | { allowed: false; retryAfterMs: number };

/**
 * Call before checking a password or setup token.
 *
 * If the address is locked out, says how long is left. Otherwise it records the attempt
 * as a failure straight away and returns its id; call `markSuccess` if the check passes.
 * Recording first means a burst of simultaneous guesses cannot all slip past the limit.
 * This function is synchronous, so two requests can never interleave inside it.
 */
export function enterGate(db: Db, ip: string, now = new Date(), limit = PARENT_LIMIT): Gate {
	const failures = recentFailures(db, ip, now, limit);
	if (failures.length >= limit.maxFailures) {
		// The lock lifts when the oldest of the counted failures leaves the window.
		const oldest = failures[limit.maxFailures - 1];
		return { allowed: false, retryAfterMs: oldest.getTime() + limit.windowMs - now.getTime() };
	}

	db.delete(loginAttempt)
		.where(lt(loginAttempt.at, new Date(now.getTime() - KEEP_ATTEMPTS_MS)))
		.run();

	const { id } = db
		.insert(loginAttempt)
		.values({ scope: limit.scope, ip, at: now, success: false })
		.returning({ id: loginAttempt.id })
		.get();
	return { allowed: true, attemptId: id };
}

export function markSuccess(db: Db, attemptId: number): void {
	db.update(loginAttempt).set({ success: true }).where(eq(loginAttempt.id, attemptId)).run();
}

/**
 * How long to hold the response to a failed attempt: nothing for the first, then
 * 0.25s, 0.5s, 1s and 2s. Slows down guessing without bothering someone who mistyped once.
 */
export function failureDelayMs(db: Db, ip: string, now = new Date(), limit = PARENT_LIMIT): number {
	const failures = recentFailures(db, ip, now, limit).length;
	return failures <= 1 ? 0 : Math.min(2000, 250 * 2 ** (failures - 2));
}

/** Rounds a wait up to whole minutes for a message like "try again in 12 minutes". */
export function minutesLeft(retryAfterMs: number): number {
	return Math.max(1, Math.ceil(retryAfterMs / 60_000));
}
