import { setTimeout as sleep } from 'node:timers/promises';
import { fail, redirect } from '@sveltejs/kit';
import { SETUP_TOKEN } from '$app/env/private';
import { LOGIN_PATH, secretsMatch } from '#lib/server/auth/access.ts';
import { createParent, parentExists } from '#lib/server/auth/parent.ts';
import {
	enterGate,
	failureDelayMs,
	markSuccess,
	minutesLeft
} from '#lib/server/auth/rate-limit.ts';
import { setupSchema } from '#lib/server/auth/schemas.ts';
import { startParentSession } from '#lib/server/auth/start-session.ts';
import { getDb } from '#lib/server/db/index.ts';
import { parseForm } from '#lib/server/validation.ts';
import type { Actions, PageServerLoad } from './$types';

// First-run setup: creates the one parent account. Once an account exists this page is
// closed for good, with or without the setup code.

export const load: PageServerLoad = () => {
	if (parentExists(getDb())) redirect(303, LOGIN_PATH);
	return { enabled: Boolean(SETUP_TOKEN) };
};

export const actions: Actions = {
	default: async ({ request, cookies, url, getClientAddress }) => {
		const db = getDb();
		if (parentExists(db)) redirect(303, LOGIN_PATH);

		const form = await request.formData();
		const username = String(form.get('username') ?? '').slice(0, 64);

		if (!SETUP_TOKEN) {
			return fail(503, {
				username,
				errors: { form: 'Setup is turned off because SETUP_TOKEN is not set on the server.' }
			});
		}

		const ip = getClientAddress();
		const gate = enterGate(db, ip);
		if (!gate.allowed) {
			const minutes = minutesLeft(gate.retryAfterMs);
			return fail(429, {
				username,
				errors: {
					form: `Too many tries. Please wait ${minutes} minute${minutes === 1 ? '' : 's'} and try again.`
				}
			});
		}

		if (!secretsMatch(String(form.get('token') ?? ''), SETUP_TOKEN)) {
			await sleep(failureDelayMs(db, ip));
			return fail(400, { username, errors: { token: 'That setup code is not right.' } });
		}
		// The code was right, so a typo in the other fields is not held against this address.
		markSuccess(db, gate.attemptId);

		const parsed = parseForm(setupSchema, form);
		if (!parsed.ok) return fail(400, { username, errors: parsed.errors });

		const account = await createParent(db, parsed.data.username, parsed.data.password);
		if (!account) redirect(303, LOGIN_PATH);

		startParentSession(db, cookies, url, account.id);
		redirect(303, '/parent');
	}
};
