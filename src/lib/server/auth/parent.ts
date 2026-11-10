import { eq, sql } from 'drizzle-orm';
import type { Db } from '../db/client.ts';
import { parent } from '../db/schema.ts';
import { decoyHash, hashPassword, verifyPassword } from './password.ts';

export interface ParentAccount {
	id: number;
	username: string;
}

export function parentExists(db: Db): boolean {
	return db.select({ id: parent.id }).from(parent).limit(1).get() !== undefined;
}

export function getParent(db: Db, id: number): ParentAccount | null {
	return (
		db
			.select({ id: parent.id, username: parent.username })
			.from(parent)
			.where(eq(parent.id, id))
			.get() ?? null
	);
}

/**
 * Creates the one parent account. Returns null if an account already exists, checked
 * inside the same transaction as the insert so two setups can never both succeed.
 */
export async function createParent(
	db: Db,
	username: string,
	password: string,
	now = new Date()
): Promise<ParentAccount | null> {
	if (parentExists(db)) return null;
	const passwordHash = await hashPassword(password);

	return db.transaction((tx) => {
		const { count } = tx
			.select({ count: sql<number>`count(*)` })
			.from(parent)
			.get()!;
		if (count > 0) return null;
		return tx
			.insert(parent)
			.values({ username, passwordHash, createdAt: now })
			.returning({ id: parent.id, username: parent.username })
			.get();
	});
}

/**
 * Returns the account if the username and password match, otherwise null.
 * An unknown username costs the same hashing time as a wrong password.
 */
export async function authenticate(
	db: Db,
	username: string,
	password: string
): Promise<ParentAccount | null> {
	const row = db.select().from(parent).where(eq(parent.username, username)).get();
	const ok = await verifyPassword(row?.passwordHash ?? (await decoyHash()), password);
	return row && ok ? { id: row.id, username: row.username } : null;
}

/** Changes the password if `current` is right. Returns whether it was changed. */
export async function changePassword(
	db: Db,
	id: number,
	current: string,
	next: string
): Promise<boolean> {
	const row = db.select().from(parent).where(eq(parent.id, id)).get();
	if (!row || !(await verifyPassword(row.passwordHash, current))) return false;

	db.update(parent)
		.set({ passwordHash: await hashPassword(next) })
		.where(eq(parent.id, id))
		.run();
	return true;
}
