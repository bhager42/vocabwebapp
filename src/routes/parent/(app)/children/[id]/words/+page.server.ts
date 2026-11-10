import { requireParent } from '#lib/server/auth/guard.ts';
import { getDb } from '#lib/server/db/index.ts';
import { wordTable } from '#lib/server/history.ts';
import { childFromParam } from '#lib/server/params.ts';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = ({ locals, params }) => {
	requireParent(locals);
	const child = childFromParam(params.id);
	return {
		words: wordTable(getDb(), child.id).map((entry) => ({ ...entry, dueAt: undefined }))
	};
};
