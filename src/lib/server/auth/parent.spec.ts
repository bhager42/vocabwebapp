import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Db } from '../db/client.ts';
import { parent } from '../db/schema.ts';
import { createTestDb } from '../test-db.ts';
import { authenticate, changePassword, createParent, getParent, parentExists } from './parent.ts';

let db: Db;
let close: () => void;

beforeEach(() => ({ db, close } = createTestDb()));
afterEach(() => close());

describe('the parent account', () => {
	it('can be created exactly once', async () => {
		expect(parentExists(db)).toBe(false);

		const first = await createParent(db, 'mum', 'correct horse battery');
		expect(first).toMatchObject({ username: 'mum' });
		expect(parentExists(db)).toBe(true);

		expect(await createParent(db, 'intruder', 'another long password')).toBeNull();
		expect(db.select().from(parent).all()).toHaveLength(1);
	});

	it('cannot be created twice even by two requests at the same moment', async () => {
		const results = await Promise.all([
			createParent(db, 'first', 'correct horse battery'),
			createParent(db, 'second', 'correct horse battery')
		]);

		expect(results.filter(Boolean)).toHaveLength(1);
		expect(db.select().from(parent).all()).toHaveLength(1);
	});

	it('never stores the password itself', async () => {
		await createParent(db, 'mum', 'correct horse battery');

		const [row] = db.select().from(parent).all();
		expect(row.passwordHash).toMatch(/^\$argon2id\$/);
		expect(JSON.stringify(row)).not.toContain('correct horse');
	});

	it('signs in with the right username and password only', async () => {
		const account = await createParent(db, 'mum', 'correct horse battery');

		expect(await authenticate(db, 'mum', 'correct horse battery')).toEqual(account);
		expect(await authenticate(db, 'mum', 'wrong password here')).toBeNull();
		expect(await authenticate(db, 'dad', 'correct horse battery')).toBeNull();
		expect(await authenticate(db, '', '')).toBeNull();
	});

	it('refuses everyone when no account exists yet', async () => {
		expect(await authenticate(db, 'mum', 'correct horse battery')).toBeNull();
	});

	it('changes the password only when the current one is given', async () => {
		const account = (await createParent(db, 'mum', 'correct horse battery'))!;

		expect(await changePassword(db, account.id, 'not the password', 'brand new password')).toBe(
			false
		);
		expect(await authenticate(db, 'mum', 'correct horse battery')).not.toBeNull();

		expect(
			await changePassword(db, account.id, 'correct horse battery', 'brand new password')
		).toBe(true);
		expect(await authenticate(db, 'mum', 'correct horse battery')).toBeNull();
		expect(await authenticate(db, 'mum', 'brand new password')).not.toBeNull();
	});

	it('looks an account up by id', async () => {
		const account = (await createParent(db, 'mum', 'correct horse battery'))!;

		expect(getParent(db, account.id)).toEqual(account);
		expect(getParent(db, account.id + 1)).toBeNull();
	});
});
