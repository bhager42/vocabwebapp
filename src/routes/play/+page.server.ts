import { error, fail, redirect } from '@sveltejs/kit';
import { requireChild } from '#lib/server/auth/guard.ts';
import { getChild } from '#lib/server/children.ts';
import { getDb } from '#lib/server/db/index.ts';
import {
	advance,
	currentView,
	quit,
	startPractice,
	submitAnswer,
	type Clock,
	type PracticeChild
} from '#lib/server/practice.ts';
import { appTimeZone } from '#lib/server/time.ts';
import type { Actions, PageServerLoad } from './$types';

// Practice. Every action here works as a plain form post followed by a redirect back to
// this page, which then shows whatever the session's next screen is. So the page works
// the same with and without JavaScript, and reloading or pressing Back can never
// re-submit an answer.

const clock = (): Clock => ({ now: new Date(), timeZone: appTimeZone(), rng: Math.random });

/** The signed-in child with their grade and settings. Never taken from the request. */
function practiceChild(locals: App.Locals): PracticeChild {
	const who = getChild(getDb(), requireChild(locals).id);
	if (!who || who.archivedAt) redirect(303, '/');
	return who;
}

export const load: PageServerLoad = ({ locals }) => {
	const who = requireChild(locals);
	const view = currentView(getDb(), who.id, new Date());
	if (view.kind === 'none') redirect(303, '/');
	return { view };
};

const wholeNumber = (value: FormDataEntryValue | null): number | undefined =>
	typeof value === 'string' && /^\d{1,9}$/.test(value) ? Number(value) : undefined;

export const actions: Actions = {
	start: ({ locals }) => {
		const result = startPractice(getDb(), practiceChild(locals), clock());
		if (result === 'empty') redirect(303, '/?nothing');
		if (result === 'capped') redirect(303, '/');
		redirect(303, '/play');
	},

	answer: async ({ locals, request }) => {
		const who = requireChild(locals);
		const form = await request.formData();
		const questionId = wholeNumber(form.get('questionId'));
		if (questionId === undefined) error(400, 'Missing question');

		const text = form.get('text');
		const result = submitAnswer(
			getDb(),
			who.id,
			{
				questionId,
				choice: wholeNumber(form.get('choice')),
				text: typeof text === 'string' ? text : undefined,
				responseMs: wholeNumber(form.get('responseMs'))
			},
			clock()
		);

		if (result === 'invalid') return fail(400, { message: 'Pick or type an answer first.' });
		// "stale" needs no message: the page simply shows where the session really is.
		redirect(303, '/play');
	},

	next: ({ locals }) => {
		const result = advance(getDb(), practiceChild(locals), clock());
		if (result === 'done') redirect(303, '/play/done');
		if (result === 'none') redirect(303, '/');
		redirect(303, '/play');
	},

	quit: ({ locals }) => {
		quit(getDb(), practiceChild(locals), new Date());
		redirect(303, '/');
	}
};
