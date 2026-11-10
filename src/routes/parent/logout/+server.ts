import { redirect } from '@sveltejs/kit';
import { endParentSession } from '#lib/server/auth/start-session.ts';
import { getDb } from '#lib/server/db/index.ts';
import type { RequestHandler } from './$types';

// Signing out is a POST so that a link or image on another page can never trigger it.
export const POST: RequestHandler = ({ cookies, url }) => {
	endParentSession(getDb(), cookies, url);
	redirect(303, '/');
};
