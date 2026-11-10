import { error } from '@sveltejs/kit';
import { requireParent } from '#lib/server/auth/guard.ts';
import { listChildren, setArchived } from '#lib/server/children.ts';
import { getDb } from '#lib/server/db/index.ts';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = ({ locals }) => {
	requireParent(locals);
	const children = listChildren(getDb()).map(({ id, name, grade, archivedAt }) => ({
		id,
		name,
		grade,
		archived: archivedAt !== null
	}));
	return {
		children: children.filter((child) => !child.archived),
		archived: children.filter((child) => child.archived)
	};
};

export const actions: Actions = {
	restore: async ({ locals, request }) => {
		requireParent(locals);
		const id = Number((await request.formData()).get('id'));
		if (!Number.isInteger(id) || !setArchived(getDb(), id, false)) error(404, 'Child not found');
		return { restored: true };
	}
};
