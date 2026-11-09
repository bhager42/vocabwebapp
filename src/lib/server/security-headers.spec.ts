import { describe, expect, it } from 'vitest';
import { securityHeaders } from './security-headers.ts';

describe('securityHeaders', () => {
	it('sets the baseline headers over plain HTTP, without HSTS', () => {
		const headers = securityHeaders({ https: false });

		expect(headers['X-Content-Type-Options']).toBe('nosniff');
		expect(headers['Referrer-Policy']).toBe('no-referrer');
		expect(headers['Cross-Origin-Opener-Policy']).toBe('same-origin');
		expect(headers['Cross-Origin-Resource-Policy']).toBe('same-origin');
		expect(headers['X-Frame-Options']).toBe('DENY');
		expect(headers['Strict-Transport-Security']).toBeUndefined();
	});

	it('adds HSTS only when served over HTTPS', () => {
		const headers = securityHeaders({ https: true });

		expect(headers['Strict-Transport-Security']).toMatch(/^max-age=31536000/);
	});

	it('disables sensitive browser features', () => {
		const policy = securityHeaders({ https: false })['Permissions-Policy'];

		for (const feature of ['camera', 'microphone', 'geolocation', 'payment', 'usb']) {
			expect(policy).toContain(`${feature}=()`);
		}
	});
});
