import { error } from '@sveltejs/kit';
import { getChild, type Child } from './children.ts';
import { getDb } from './db/index.ts';

/** A numeric id from the URL. Anything that is not a plain number is "not found". */
export function idParam(value: string): number {
	if (!/^\d{1,9}$/.test(value)) error(404, 'Not found');
	return Number(value);
}

/** The child a `/parent/children/[id]/...` page is about, or a 404. */
export function childFromParam(value: string): Child {
	const child = getChild(getDb(), idParam(value));
	if (!child) error(404, 'Child not found');
	return child;
}
