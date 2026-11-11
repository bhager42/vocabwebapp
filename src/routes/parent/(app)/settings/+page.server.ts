import { fail, redirect } from '@sveltejs/kit';
import { LOGIN_PATH } from '#lib/server/auth/access.ts';
import { requireParent } from '#lib/server/auth/guard.ts';
import { changePassword } from '#lib/server/auth/parent.ts';
import { changePasswordSchema } from '#lib/server/auth/schemas.ts';
import { deleteSessionsFor } from '#lib/server/auth/session.ts';
import { endParentSession } from '#lib/server/auth/start-session.ts';
import { listBackups } from '#lib/server/backup.ts';
import { backupDir, getDb } from '#lib/server/db/index.ts';
import { appTimeZone, formatDateTime } from '#lib/server/time.ts';
import { parseForm } from '#lib/server/validation.ts';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = ({ locals }) => {
	const parent = requireParent(locals);
	const timeZone = appTimeZone();
	return {
		username: parent.username,
		backups: listBackups(backupDir())
			.filter((backup) => backup.kind !== 'download')
			.map((backup) => ({
				name: backup.name,
				kind: backup.kind,
				created: formatDateTime(backup.createdAt, timeZone),
				bytes: backup.bytes
			}))
	};
};

export const actions: Actions = {
	password: async ({ locals, request }) => {
		const parent = requireParent(locals);
		const db = getDb();

		const parsed = parseForm(changePasswordSchema, await request.formData());
		if (!parsed.ok) return fail(400, { errors: parsed.errors });

		if (parsed.data.password.toLowerCase() === parent.username) {
			return fail(400, {
				errors: { password: 'The password must not be the same as the username.' }
			});
		}
		if (!(await changePassword(db, parent.id, parsed.data.current, parsed.data.password))) {
			return fail(400, { errors: { current: 'That is not your current password.' } });
		}

		// Whoever else was signed in with the old password is signed out; this browser stays.
		deleteSessionsFor(db, 'parent', parent.id, locals.parentSession ?? undefined);
		return { passwordChanged: true };
	},

	signOutEverywhere: ({ locals, cookies, url }) => {
		const parent = requireParent(locals);
		const db = getDb();
		deleteSessionsFor(db, 'parent', parent.id);
		endParentSession(db, cookies, url);
		redirect(303, LOGIN_PATH);
	}
};
