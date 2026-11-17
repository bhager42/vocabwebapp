import { error } from '@sveltejs/kit';
import { requireParent } from '#lib/server/auth/guard.ts';
import { getDb } from '#lib/server/db/index.ts';
import { idParam } from '#lib/server/params.ts';
import { listStories, setStoryActive } from '#lib/server/reading.ts';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = ({ locals }) => {
	requireParent(locals);
	return { stories: listStories(getDb()) };
};

export const actions: Actions = {
	/** Switches one story on or off. A story that is off is never given to a child. */
	toggle: async ({ locals, request }) => {
		requireParent(locals);
		const form = await request.formData();
		const id = idParam(String(form.get('id') ?? ''));
		if (!setStoryActive(getDb(), id, form.get('active') === 'true')) {
			error(404, 'Story not found');
		}
		return { toggled: id };
	}
};
