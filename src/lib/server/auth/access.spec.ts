import { describe, expect, it } from 'vitest';
import { isPrivatePath, requiresParent, secretsMatch, sessionCookie } from './access.ts';

describe('requiresParent', () => {
	it('protects /parent and everything under it', () => {
		for (const path of [
			'/parent',
			'/parent/',
			'/parent/children/new',
			'/parent/children/1',
			'/parent/settings',
			'/parent/logout',
			'/parent/__data.json',
			'/parent/login/extra'
		]) {
			expect(requiresParent(path), path).toBe(true);
		}
	});

	it('leaves the sign-in page and the public pages open', () => {
		for (const path of ['/parent/login', '/parent/login/', '/', '/setup', '/play', '/parents']) {
			expect(requiresParent(path), path).toBe(false);
		}
	});
});

describe('isPrivatePath', () => {
	it('covers the parent area and setup, but not public pages', () => {
		expect(isPrivatePath('/parent')).toBe(true);
		expect(isPrivatePath('/parent/login')).toBe(true);
		expect(isPrivatePath('/setup')).toBe(true);
		expect(isPrivatePath('/')).toBe(false);
		expect(isPrivatePath('/styleguide')).toBe(false);
	});
});

describe('sessionCookie', () => {
	it('is always HttpOnly and SameSite=Strict', () => {
		for (const origin of ['http://192.168.1.10:30080', 'https://vocab.home.example']) {
			expect(sessionCookie('parent', new URL(origin)).options).toMatchObject({
				httpOnly: true,
				sameSite: 'strict',
				path: '/'
			});
		}
	});

	it('uses the __Host- prefix and Secure over HTTPS', () => {
		const cookie = sessionCookie('parent', new URL('https://vocab.home.example/parent'));
		expect(cookie.name).toBe('__Host-vocab_parent');
		expect(cookie.options.secure).toBe(true);
	});

	it('drops both over plain HTTP, where the browser would refuse them', () => {
		const cookie = sessionCookie('parent', new URL('http://192.168.1.10:30080/parent'));
		expect(cookie.name).toBe('vocab_parent');
		expect(cookie.options.secure).toBe(false);
	});

	it('keeps parent and child cookies apart', () => {
		const url = new URL('https://vocab.home.example');
		expect(sessionCookie('child', url).name).not.toBe(sessionCookie('parent', url).name);
	});
});

describe('secretsMatch', () => {
	it('matches only the exact secret', () => {
		expect(secretsMatch('s3cret-code', 's3cret-code')).toBe(true);
		expect(secretsMatch('s3cret-codf', 's3cret-code')).toBe(false);
		expect(secretsMatch('s3cret', 's3cret-code')).toBe(false);
		expect(secretsMatch('', 's3cret-code')).toBe(false);
	});
});
