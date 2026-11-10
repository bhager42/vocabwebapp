import { redirect } from '@sveltejs/kit';
import { LOGIN_PATH } from './access.ts';
import type { ParentAccount } from './parent.ts';

/**
 * Returns the signed-in parent or sends the browser to the sign-in page.
 *
 * Call this at the top of every load function and form action under /parent. The hook in
 * hooks.server.ts already blocks those paths; this second check keeps each one safe on
 * its own.
 */
export function requireParent(locals: App.Locals): ParentAccount {
	if (!locals.parent) redirect(303, LOGIN_PATH);
	return locals.parent;
}

export interface ChildIdentity {
	id: number;
	name: string;
}

/**
 * Returns the signed-in child or sends the browser to the name page. Everything a child
 * can do is keyed on this id, taken from their session and never from the request, so one
 * child can never read or change another child's practice.
 */
export function requireChild(locals: App.Locals): ChildIdentity {
	if (!locals.child) redirect(303, '/');
	return locals.child;
}
