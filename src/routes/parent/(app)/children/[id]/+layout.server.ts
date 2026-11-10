import { requireParent } from '#lib/server/auth/guard.ts';
import { childFromParam } from '#lib/server/params.ts';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = ({ locals, params }) => {
	requireParent(locals);
	const child = childFromParam(params.id);
	return {
		child: {
			id: child.id,
			name: child.name,
			grade: child.grade,
			archived: child.archivedAt !== null
		}
	};
};
