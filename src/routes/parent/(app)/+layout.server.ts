import { requireParent } from '#lib/server/auth/guard.ts';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = ({ locals }) => {
	const parent = requireParent(locals);
	return { parent: { username: parent.username } };
};
