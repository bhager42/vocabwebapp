import { setTimeout as sleep } from 'node:timers/promises';
import { fail, redirect } from '@sveltejs/kit';
import { authenticate, parentExists } from '#lib/server/auth/parent.ts';
import {
	enterGate,
	failureDelayMs,
	markSuccess,
	minutesLeft
} from '#lib/server/auth/rate-limit.ts';
import { loginSchema } from '#lib/server/auth/schemas.ts';
import { startParentSession } from '#lib/server/auth/start-session.ts';
import { getDb } from '#lib/server/db/index.ts';
import { parseForm } from '#lib/server/validation.ts';
import type { Actions, PageServerLoad } from './$types';

// One message for every kind of failure, so the page never confirms that a username exists.
const WRONG = 'That username or password is not right.';

export const load: PageServerLoad = ({ locals }) => {
	if (locals.parent) redirect(303, '/parent');
	return { needsSetup: !parentExists(getDb()) };
};

export const actions: Actions = {
	default: async ({ request, cookies, url, getClientAddress }) => {
		const db = getDb();
		const form = await request.formData();
		const parsed = parseForm(loginSchema, form);
		const username = parsed.ok ? parsed.data.username : '';

		const ip = getClientAddress();
		const gate = enterGate(db, ip);
		if (!gate.allowed) {
			const minutes = minutesLeft(gate.retryAfterMs);
			return fail(429, {
				username,
				message: `Too many tries. Please wait ${minutes} minute${minutes === 1 ? '' : 's'} and try again.`
			});
		}

		const account = parsed.ok
			? await authenticate(db, parsed.data.username, parsed.data.password)
			: null;
		if (!account) {
			await sleep(failureDelayMs(db, ip));
			return fail(400, { username, message: WRONG });
		}

		markSuccess(db, gate.attemptId);
		startParentSession(db, cookies, url, account.id);
		redirect(303, '/parent');
	}
};
