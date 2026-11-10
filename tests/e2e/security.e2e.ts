import { expect, test } from '@playwright/test';

// These run against the production server (`node server.js`) over plain HTTP.

test.describe('security headers on pages', () => {
	test('every baseline header is present', async ({ request }) => {
		const response = await request.get('/');
		expect(response.status()).toBe(200);
		const headers = response.headers();

		expect(headers['x-content-type-options']).toBe('nosniff');
		expect(headers['referrer-policy']).toBe('same-origin');
		expect(headers['cross-origin-opener-policy']).toBe('same-origin');
		expect(headers['cross-origin-resource-policy']).toBe('same-origin');
		expect(headers['x-frame-options']).toBe('DENY');
		expect(headers['permissions-policy']).toContain('camera=()');
		expect(headers['permissions-policy']).toContain('microphone=()');
		expect(headers['permissions-policy']).toContain('geolocation=()');
	});

	test('HSTS is not sent over plain HTTP', async ({ request }) => {
		const response = await request.get('/');
		expect(response.headers()['strict-transport-security']).toBeUndefined();
	});

	test('the Content-Security-Policy is strict and nonce-based', async ({ request }) => {
		const response = await request.get('/');
		const csp = response.headers()['content-security-policy'];
		expect(csp).toBeDefined();

		const directives = new Map(
			csp.split(';').map((part) => {
				const [name, ...values] = part.trim().split(/\s+/);
				return [name, values] as const;
			})
		);

		expect(directives.get('default-src')).toEqual(["'self'"]);
		expect(directives.get('object-src')).toEqual(["'none'"]);
		expect(directives.get('base-uri')).toEqual(["'none'"]);
		expect(directives.get('form-action')).toEqual(["'self'"]);
		expect(directives.get('frame-ancestors')).toEqual(["'none'"]);
		expect(directives.get('style-src')).not.toContain("'unsafe-inline'");

		const scriptSrc = directives.get('script-src') ?? [];
		expect(scriptSrc).toContain("'self'");
		expect(scriptSrc.some((value) => /^'nonce-.+'$/.test(value))).toBe(true);
		expect(scriptSrc).not.toContain("'unsafe-inline'");
		expect(scriptSrc).not.toContain("'unsafe-eval'");
	});

	test('the nonce changes on every request', async ({ request }) => {
		const nonce = async () =>
			/'nonce-([^']+)'/.exec((await request.get('/')).headers()['content-security-policy'])?.[1];

		const first = await nonce();
		expect(first).toBeTruthy();
		expect(await nonce()).not.toBe(first);
	});
});

test('static assets are served with nosniff', async ({ request }) => {
	const response = await request.get('/robots.txt');
	expect(response.status()).toBe(200);
	expect(response.headers()['x-content-type-options']).toBe('nosniff');
	expect(response.headers()['cross-origin-resource-policy']).toBe('same-origin');
});

test('the page loads and hydrates without any CSP violation', async ({ page }) => {
	const problems: string[] = [];
	page.on('console', (message) => {
		if (message.type() === 'error') problems.push(message.text());
	});
	page.on('pageerror', (error) => problems.push(error.message));

	await page.goto('/');
	await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
	await page.waitForLoadState('networkidle');

	expect(problems).toEqual([]);
});

test.describe('CSRF origin check', () => {
	const form = { headers: { 'content-type': 'application/x-www-form-urlencoded' }, data: 'a=1' };

	test('a cross-origin form POST is rejected', async ({ request }) => {
		const response = await request.post('/', {
			...form,
			headers: { ...form.headers, origin: 'http://evil.example' }
		});
		expect(response.status()).toBe(403);
	});

	test('a same-origin form POST passes the origin check', async ({ request, baseURL }) => {
		const response = await request.post('/', {
			...form,
			headers: { ...form.headers, origin: baseURL! }
		});
		// There is no form action on / yet, so anything but 403 means the check passed.
		expect(response.status()).not.toBe(403);
	});

	test('a client cannot override the configured origin with its own headers', async ({
		request
	}) => {
		const response = await request.post('/', {
			...form,
			headers: {
				...form.headers,
				origin: 'http://evil.example',
				host: 'evil.example',
				'x-vocab-origin-host': 'evil.example',
				'x-forwarded-host': 'evil.example'
			}
		});
		expect(response.status()).toBe(403);
	});
});

test('healthz reports ok and is not cacheable', async ({ request }) => {
	const response = await request.get('/healthz');
	expect(response.status()).toBe(200);
	expect(await response.json()).toEqual({ status: 'ok' });
	expect(response.headers()['cache-control']).toBe('no-store');
});
