import { fail, redirect } from '@sveltejs/kit';
import { parentExists } from '#lib/server/auth/parent.ts';
import { enterGate, markSuccess, minutesLeft, NAME_LIMIT } from '#lib/server/auth/rate-limit.ts';
import { endSession, startSession } from '#lib/server/auth/start-session.ts';
import { findChildByName, getChild, NAME_MAX_LENGTH } from '#lib/server/children.ts';
import { getDb } from '#lib/server/db/index.ts';
import { practiceStatus, streak } from '#lib/server/practice.ts';
import { appTimeZone } from '#lib/server/time.ts';
import type { Actions, PageServerLoad } from './$types';

// The front door. A child types their first name here; a child who is already known on
// this device is greeted and offered practice.

export const load: PageServerLoad = ({ locals, url }) => {
	const db = getDb();
	const who = locals.child && getChild(db, locals.child.id);
	if (!who) return { child: null, needsSetup: !parentExists(db) };

	const now = new Date();
	const timeZone = appTimeZone();
	return {
		child: {
			name: who.name,
			status: practiceStatus(db, who, now, timeZone),
			streak: streak(db, who.id, now, timeZone),
			// Set by /play when there was nothing at all to ask.
			nothingToPractice: url.searchParams.has('nothing')
		},
		needsSetup: false
	};
};

export const actions: Actions = {
	/** A child types their name. */
	enter: async ({ request, cookies, url, getClientAddress }) => {
		const db = getDb();
		const form = await request.formData();
		const name = String(form.get('name') ?? '').slice(0, NAME_MAX_LENGTH);
		if (!name.trim()) return fail(400, { name, message: 'Type your first name to start.' });

		const gate = enterGate(db, getClientAddress(), new Date(), NAME_LIMIT);
		if (!gate.allowed) {
			const minutes = minutesLeft(gate.retryAfterMs);
			return fail(429, {
				name,
				message: `That is a lot of tries! Wait ${minutes} minute${minutes === 1 ? '' : 's'} and try again.`
			});
		}

		// One answer for "no such name" and "archived", and never a list of the names that exist.
		const who = findChildByName(db, name);
		if (!who) {
			return fail(400, {
				name,
				message: "Hmm, I don't know that name yet. Ask a grown-up to add you."
			});
		}

		markSuccess(db, gate.attemptId);
		startSession(db, cookies, url, 'child', who.id);
		redirect(303, '/');
	},

	/** "Not you?" */
	switch: ({ cookies, url }) => {
		endSession(getDb(), cookies, url, 'child');
		redirect(303, '/');
	}
};
