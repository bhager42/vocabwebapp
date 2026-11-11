import type { Cookies } from '@sveltejs/kit';
import { describe, expect, it, vi } from 'vitest';
import { POST } from './+server.ts';

/** Calls the theme endpoint as the JavaScript toggle does, recording what it does to cookies. */
async function post(origin: string, theme: string) {
	const cookies = { set: vi.fn(), delete: vi.fn() };
	const body = new FormData();
	body.set('theme', theme);
	const request = new Request(`${origin}/theme`, {
		method: 'POST',
		body,
		headers: { accept: 'application/json' }
	});
	const event = { request, cookies: cookies as unknown as Cookies, url: new URL(request.url) };
	const response = await POST(event as unknown as Parameters<typeof POST>[0]);
	return { response, cookies };
}

describe('saving the theme', () => {
	// SvelteKit marks a cookie Secure unless told otherwise (except on localhost), and a
	// browser on plain HTTP ignores a Secure cookie, so the old choice would stick.
	it.each(['http://192.168.1.10:30080', 'http://vocab.lan'])(
		'clears the cookie without the Secure flag on plain HTTP (%s)',
		async (origin) => {
			const { response, cookies } = await post(origin, 'system');

			expect(response.status).toBe(204);
			expect(cookies.delete).toHaveBeenCalledWith(
				'theme',
				expect.objectContaining({ path: '/', secure: false })
			);
		}
	);

	it('sets and clears the cookie with the same flags', async () => {
		const origin = 'http://192.168.1.10:30080';
		const { cookies: setter } = await post(origin, 'dark');
		const { cookies: clearer } = await post(origin, 'system');

		const [, value, setOptions] = setter.set.mock.calls[0];
		const [, clearOptions] = clearer.delete.mock.calls[0];
		expect(value).toBe('dark');
		const { maxAge, ...rest } = setOptions;
		expect(maxAge).toBeGreaterThan(0);
		expect(clearOptions).toEqual(rest);
	});

	it('marks the cookie Secure over HTTPS', async () => {
		const { cookies } = await post('https://vocab.home.example', 'light');
		expect(cookies.set).toHaveBeenCalledWith(
			'theme',
			'light',
			expect.objectContaining({ secure: true })
		);
	});
});
