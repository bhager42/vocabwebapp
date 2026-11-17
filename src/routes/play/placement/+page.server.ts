import { error, fail, redirect } from '@sveltejs/kit';
import { requireChild } from '#lib/server/auth/guard.ts';
import { getDb } from '#lib/server/db/index.ts';
import { answerQuiz, beginQuiz, finishedRecently, quizView } from '#lib/server/placement.ts';
import type { Actions, PageServerLoad } from './$types';

// The placement quiz. Like /play, every action is a form post followed by a redirect
// back here, so it works the same with and without JavaScript.

export const load: PageServerLoad = ({ locals }) => {
	const who = requireChild(locals);
	const db = getDb();
	const now = new Date();
	const view = quizView(db, who.id, now);
	if (view.kind === 'question') return { view };
	if (view.kind === 'intro') redirect(303, '/');
	if (finishedRecently(db, who.id, now)) return { view: { kind: 'done' as const } };
	redirect(303, '/');
};

const wholeNumber = (value: FormDataEntryValue | null): number | undefined =>
	typeof value === 'string' && /^\d{1,9}$/.test(value) ? Number(value) : undefined;

export const actions: Actions = {
	start: ({ locals }) => {
		const who = requireChild(locals);
		const result = beginQuiz(getDb(), who.id, new Date(), Math.random);
		redirect(303, result === 'none' ? '/' : '/play/placement');
	},

	answer: async ({ locals, request }) => {
		const who = requireChild(locals);
		const form = await request.formData();
		const questionId = wholeNumber(form.get('questionId'));
		if (questionId === undefined) error(400, 'Missing question');

		const result = answerQuiz(
			getDb(),
			who.id,
			{
				questionId,
				choice: wholeNumber(form.get('choice')),
				dontKnow: form.get('dontKnow') === '1'
			},
			new Date(),
			Math.random
		);
		if (result === 'invalid') return fail(400, { message: 'Pick an answer first.' });
		redirect(303, '/play/placement');
	}
};
