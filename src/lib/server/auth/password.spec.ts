import { describe, expect, it } from 'vitest';
import { hashPassword, verifyPassword } from './password.ts';

describe('password hashing', () => {
	it('stores an Argon2id hash with the recommended parameters', async () => {
		const hash = await hashPassword('correct horse battery');

		expect(hash).toMatch(
			/^\$argon2id\$v=19\$m=19456,t=2,p=1\$[A-Za-z0-9+/]{22}\$[A-Za-z0-9+/]{43}$/
		);
		expect(hash).not.toContain('correct horse');
	});

	it('accepts the right password and rejects a wrong one', async () => {
		const hash = await hashPassword('correct horse battery');

		expect(await verifyPassword(hash, 'correct horse battery')).toBe(true);
		expect(await verifyPassword(hash, 'correct horse batterz')).toBe(false);
		expect(await verifyPassword(hash, '')).toBe(false);
	});

	it('salts every hash, so the same password never hashes the same way twice', async () => {
		const first = await hashPassword('correct horse battery');
		const second = await hashPassword('correct horse battery');

		expect(first).not.toBe(second);
		expect(await verifyPassword(second, 'correct horse battery')).toBe(true);
	});

	it('treats a malformed stored hash as a failed check instead of throwing', async () => {
		for (const stored of ['', 'plaintext', '$argon2id$v=19$m=1,t=1,p=1$AAAA$AAAA', '$2b$10$abc']) {
			expect(await verifyPassword(stored, 'anything')).toBe(false);
		}
	});
});
