import { fail, redirect } from '@sveltejs/kit';
import { requireParent } from '#lib/server/auth/guard.ts';
import { createChild, GRADES, newChildSchema } from '#lib/server/children.ts';
import { getDb } from '#lib/server/db/index.ts';
import { parseForm } from '#lib/server/validation.ts';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = ({ locals }) => {
	requireParent(locals);
	return { grades: [...GRADES] };
};

export const actions: Actions = {
	default: async ({ locals, request }) => {
		requireParent(locals);
		const form = await request.formData();
		const values = {
			name: String(form.get('name') ?? '').slice(0, 100),
			grade: String(form.get('grade') ?? '')
		};

		const parsed = parseForm(newChildSchema, form);
		if (!parsed.ok) return fail(400, { values, errors: parsed.errors });

		const result = createChild(getDb(), parsed.data);
		if (!result.ok) {
			return fail(400, { values, errors: { name: 'There is already a child with that name.' } });
		}
		redirect(303, '/parent');
	}
};
