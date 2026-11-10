import { error, fail, redirect } from '@sveltejs/kit';
import { requireParent } from '#lib/server/auth/guard.ts';
import {
	editChildSchema,
	getChild,
	GRADES,
	setArchived,
	updateChild
} from '#lib/server/children.ts';
import { getDb } from '#lib/server/db/index.ts';
import { parseForm } from '#lib/server/validation.ts';
import type { Actions, PageServerLoad } from './$types';

function childId(param: string): number {
	if (!/^\d{1,9}$/.test(param)) error(404, 'Child not found');
	return Number(param);
}

export const load: PageServerLoad = ({ locals, params }) => {
	requireParent(locals);
	const child = getChild(getDb(), childId(params.id));
	if (!child) error(404, 'Child not found');

	return {
		grades: [...GRADES],
		child: {
			id: child.id,
			name: child.name,
			grade: child.grade,
			archived: child.archivedAt !== null,
			settings: child.settings
		}
	};
};

export const actions: Actions = {
	save: async ({ locals, params, request }) => {
		requireParent(locals);
		const id = childId(params.id);

		const parsed = parseForm(editChildSchema, await request.formData());
		if (!parsed.ok) return fail(400, { errors: parsed.errors });

		const result = updateChild(getDb(), id, parsed.data);
		if (!result) error(404, 'Child not found');
		if (!result.ok) {
			return fail(400, { errors: { name: 'There is already a child with that name.' } });
		}
		return { saved: true };
	},

	archive: ({ locals, params }) => {
		requireParent(locals);
		if (!setArchived(getDb(), childId(params.id), true)) error(404, 'Child not found');
		redirect(303, '/parent');
	},

	restore: ({ locals, params }) => {
		requireParent(locals);
		if (!setArchived(getDb(), childId(params.id), false)) error(404, 'Child not found');
		return { restored: true };
	}
};
