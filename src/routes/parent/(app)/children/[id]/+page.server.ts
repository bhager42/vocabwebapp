import { error, fail, redirect } from '@sveltejs/kit';
import { requireParent } from '#lib/server/auth/guard.ts';
import {
	editChildSchema,
	getChild,
	GRADES,
	setArchived,
	setGrade,
	updateChild
} from '#lib/server/children.ts';
import { getDb } from '#lib/server/db/index.ts';
import { idParam } from '#lib/server/params.ts';
import { cancelQuiz, listQuizzes, startQuiz } from '#lib/server/placement.ts';
import { readingGrades } from '#lib/server/reading.ts';
import { appTimeZone, formatDateTime } from '#lib/server/time.ts';
import { parseForm } from '#lib/server/validation.ts';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = ({ locals, params }) => {
	requireParent(locals);
	const db = getDb();
	const child = getChild(db, idParam(params.id));
	if (!child) error(404, 'Child not found');

	const timeZone = appTimeZone();
	const quizzes = listQuizzes(db, child.id, new Date()).map((quiz) => ({
		id: quiz.id,
		state: quiz.state,
		when: formatDateTime(quiz.endedAt ?? quiz.startedAt, timeZone),
		resultGrade: quiz.resultGrade,
		rounds: quiz.rounds
	}));

	// Reading grades on offer: those with stories, plus wherever the child is now.
	const withStories = new Set([...readingGrades(db), child.readingGrade]);

	return {
		quizzes,
		grades: [...GRADES],
		readingGrades: [...withStories].sort((a, b) => a - b),
		child: {
			id: child.id,
			name: child.name,
			grade: child.grade,
			readingGrade: child.readingGrade,
			archived: child.archivedAt !== null,
			settings: child.settings
		}
	};
};

export const actions: Actions = {
	save: async ({ locals, params, request }) => {
		requireParent(locals);
		const id = idParam(params.id);

		const parsed = parseForm(editChildSchema, await request.formData());
		if (!parsed.ok) return fail(400, { errors: parsed.errors });

		const result = updateChild(getDb(), id, parsed.data);
		if (!result) error(404, 'Child not found');
		if (!result.ok) {
			return fail(400, { errors: { name: 'There is already a child with that name.' } });
		}
		return { saved: true };
	},

	startQuiz: ({ locals, params }) => {
		requireParent(locals);
		const db = getDb();
		const child = getChild(db, idParam(params.id));
		if (!child) error(404, 'Child not found');
		if (child.archivedAt) return fail(400, { quizError: 'Restore this child first.' });
		startQuiz(db, child.id, child.grade, new Date());
		return { quizStarted: true };
	},

	cancelQuiz: ({ locals, params }) => {
		requireParent(locals);
		cancelQuiz(getDb(), idParam(params.id), new Date());
		return { quizCancelled: true };
	},

	/** "Move to grade N" from a finished quiz. Only a grade the quiz suggested is accepted. */
	applyQuiz: async ({ locals, params, request }) => {
		requireParent(locals);
		const db = getDb();
		const id = idParam(params.id);
		const quizId = Number((await request.formData()).get('quiz'));
		const quiz = listQuizzes(db, id, new Date()).find((entry) => entry.id === quizId);
		if (!quiz || quiz.state !== 'finished' || quiz.resultGrade === null) {
			error(400, 'That quiz has no result');
		}
		if (!setGrade(db, id, quiz.resultGrade)) error(404, 'Child not found');
		return { gradeApplied: quiz.resultGrade };
	},

	archive: ({ locals, params }) => {
		requireParent(locals);
		if (!setArchived(getDb(), idParam(params.id), true)) error(404, 'Child not found');
		redirect(303, '/parent');
	},

	restore: ({ locals, params }) => {
		requireParent(locals);
		if (!setArchived(getDb(), idParam(params.id), false)) error(404, 'Child not found');
		return { restored: true };
	}
};
