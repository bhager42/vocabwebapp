import { error, redirect } from '@sveltejs/kit';
import { requireParent } from '#lib/server/auth/guard.ts';
import { getDb } from '#lib/server/db/index.ts';
import { deleteSession, sessionDetail } from '#lib/server/history.ts';
import { childFromParam, idParam } from '#lib/server/params.ts';
import { appTimeZone, formatDateTime } from '#lib/server/time.ts';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = ({ locals, params }) => {
	requireParent(locals);
	const child = childFromParam(params.id);
	const session = sessionDetail(getDb(), child.id, idParam(params.session), new Date());
	if (!session) error(404, 'Session not found');

	const { startedAt, questions, ...rest } = session;
	return {
		session: {
			...rest,
			started: formatDateTime(startedAt, appTimeZone()),
			// The time of each question is not shown, so it is not sent.
			questions: questions.map((question) => ({ ...question, at: undefined }))
		}
	};
};

export const actions: Actions = {
	delete: ({ locals, params }) => {
		requireParent(locals);
		const child = childFromParam(params.id);
		if (!deleteSession(getDb(), child.id, idParam(params.session))) {
			error(404, 'Session not found');
		}
		redirect(303, `/parent/children/${child.id}/sessions`);
	}
};
