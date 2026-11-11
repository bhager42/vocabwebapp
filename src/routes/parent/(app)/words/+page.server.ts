import { error, fail, redirect } from '@sveltejs/kit';
import { requireParent } from '#lib/server/auth/guard.ts';
import { GRADES } from '#lib/server/children.ts';
import { getDb } from '#lib/server/db/index.ts';
import { idParam } from '#lib/server/params.ts';
import { checkList, createCustomList, listWordLists, setListActive } from '#lib/server/words.ts';
import type { Actions, PageServerLoad } from './$types';

const text = (form: FormData, key: string) => {
	const value = form.get(key);
	return typeof value === 'string' ? value : '';
};

export const load: PageServerLoad = ({ locals }) => {
	requireParent(locals);
	return { grades: [...GRADES], lists: listWordLists(getDb()) };
};

export const actions: Actions = {
	/** Starts a new list of the parent's own and goes to it, ready for words. */
	create: async ({ locals, request }) => {
		requireParent(locals);
		const form = await request.formData();
		const values = { name: text(form, 'name'), grade: text(form, 'grade') };

		const checked = checkList(values);
		if (!checked.ok) return fail(400, { values, errors: checked.errors });
		const result = createCustomList(getDb(), checked.data);
		if (!result.ok) return fail(400, { values, errors: result.errors });
		redirect(303, `/parent/words/${result.id}`);
	},

	/** Switches a whole list on or off. */
	toggle: async ({ locals, request }) => {
		requireParent(locals);
		const form = await request.formData();
		const id = idParam(text(form, 'id'));
		if (!setListActive(getDb(), id, text(form, 'active') === 'true')) {
			error(404, 'List not found');
		}
		return { toggled: id };
	}
};
