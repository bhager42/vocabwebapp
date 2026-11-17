import { error, fail, redirect } from '@sveltejs/kit';
import { requireChild } from '#lib/server/auth/guard.ts';
import { getChild } from '#lib/server/children.ts';
import { getDb } from '#lib/server/db/index.ts';
import {
	advanceReading,
	answerReading,
	readingView,
	startReading,
	type Clock,
	type ReadingChild
} from '#lib/server/reading.ts';
import { appTimeZone } from '#lib/server/time.ts';
import type { Actions, PageServerLoad } from './$types';

// Reading a story. As in /play, every action is a plain form post followed by a redirect
// back here, so it works the same with and without JavaScript, and reloading or pressing
// Back can never re-submit an answer.

const clock = (): Clock => ({ now: new Date(), timeZone: appTimeZone(), rng: Math.random });

/** The signed-in child with their reading grade and settings. Never taken from the request. */
function readingChild(locals: App.Locals): ReadingChild {
	const who = getChild(getDb(), requireChild(locals).id);
	if (!who || who.archivedAt) redirect(303, '/');
	return who;
}

export const load: PageServerLoad = ({ locals }) => {
	const who = requireChild(locals);
	const view = readingView(getDb(), who.id, new Date());
	if (view.kind === 'none') redirect(303, '/');
	return { view };
};

const wholeNumber = (value: FormDataEntryValue | null): number | undefined =>
	typeof value === 'string' && /^\d{1,9}$/.test(value) ? Number(value) : undefined;

export const actions: Actions = {
	start: ({ locals }) => {
		const result = startReading(getDb(), readingChild(locals), clock());
		if (result === 'empty') redirect(303, '/?nostories');
		if (result === 'capped') redirect(303, '/');
		redirect(303, '/play/read');
	},

	answer: async ({ locals, request }) => {
		const who = requireChild(locals);
		const form = await request.formData();
		const questionId = wholeNumber(form.get('questionId'));
		if (questionId === undefined) error(400, 'Missing question');

		const result = answerReading(
			getDb(),
			who.id,
			{
				questionId,
				choice: wholeNumber(form.get('choice')),
				responseMs: wholeNumber(form.get('responseMs'))
			},
			new Date()
		);
		if (result === 'invalid') return fail(400, { message: 'Pick an answer first.' });
		redirect(303, '/play/read');
	},

	next: ({ locals }) => {
		const result = advanceReading(getDb(), readingChild(locals), clock());
		if (result === 'done') redirect(303, '/play/read/done');
		if (result === 'none') redirect(303, '/');
		redirect(303, '/play/read');
	}
};
