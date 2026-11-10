import { expect, test, type Page } from '@playwright/test';
import { expectAccessible } from './helpers.ts';

/** Relative luminance of the page background, 0 (black) to 1 (white). */
async function backgroundLuminance(page: Page): Promise<number> {
	return page.evaluate(() => {
		const canvas = document.createElement('canvas');
		canvas.width = canvas.height = 1;
		const context = canvas.getContext('2d')!;
		context.fillStyle = getComputedStyle(document.documentElement).backgroundColor;
		context.fillRect(0, 0, 1, 1);
		const [r, g, b] = context.getImageData(0, 0, 1, 1).data;
		return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
	});
}

const themeButton = (page: Page, name: string) =>
	page.getByRole('group', { name: 'Color theme' }).getByRole('button', { name });

test.describe('accessibility of the styleguide', () => {
	// Check the settled state of each component, not a frame in the middle of an animation.
	test.use({ reducedMotion: 'reduce' });

	for (const theme of ['light', 'dark'] as const) {
		test(`no axe violations in the ${theme} theme`, async ({ page, context, baseURL }) => {
			await context.addCookies([{ name: 'theme', value: theme, url: baseURL! }]);
			await page.goto('/styleguide');
			await expect(page.locator('html')).toHaveAttribute('data-theme', theme);

			const luminance = await backgroundLuminance(page);
			if (theme === 'light') expect(luminance).toBeGreaterThan(0.8);
			else expect(luminance).toBeLessThan(0.2);

			await expectAccessible(page);

			await page.getByRole('button', { name: 'Open dialog' }).click();
			await expect(page.getByRole('dialog', { name: 'Finish for today?' })).toBeVisible();
			await expectAccessible(page);
		});
	}

	test('no axe violations when following a device set to dark', async ({ page }) => {
		await page.emulateMedia({ colorScheme: 'dark' });
		await page.goto('/styleguide');
		await expect(page.locator('html')).toHaveAttribute('data-theme', 'system');

		expect(await backgroundLuminance(page)).toBeLessThan(0.2);
		await expectAccessible(page);
	});

	test('follows a device set to light', async ({ page }) => {
		await page.emulateMedia({ colorScheme: 'light' });
		await page.goto('/styleguide');

		expect(await backgroundLuminance(page)).toBeGreaterThan(0.8);
	});

	test('the home page has no axe violations', async ({ page }) => {
		await page.goto('/');
		await expectAccessible(page);
	});
});

test.describe('theme', () => {
	test('the saved theme is in the HTML the server sends, so there is no flash', async ({
		request
	}) => {
		const dark = await (await request.get('/', { headers: { cookie: 'theme=dark' } })).text();
		expect(dark).toContain('<html lang="en" data-theme="dark">');
		expect(dark).toContain('<meta name="color-scheme" content="dark" />');

		const light = await (await request.get('/', { headers: { cookie: 'theme=light' } })).text();
		expect(light).toContain('<html lang="en" data-theme="light">');
		expect(light).toContain('<meta name="color-scheme" content="light" />');

		const none = await (await request.get('/')).text();
		expect(none).toContain('<html lang="en" data-theme="system">');
		expect(none).toContain('<meta name="color-scheme" content="light dark" />');
	});

	test('a tampered theme cookie cannot inject markup', async ({ request }) => {
		const response = await request.get('/', {
			headers: { cookie: 'theme="><script>alert(1)</script>' }
		});
		const html = await response.text();

		expect(html).toContain('data-theme="system"');
		expect(html).not.toContain('alert(1)');
	});

	test('switching applies at once and survives a reload', async ({ page, context }) => {
		await page.emulateMedia({ colorScheme: 'light' });
		await page.goto('/styleguide');
		await page.waitForLoadState('networkidle');
		await expect(themeButton(page, 'Match this device')).toHaveAttribute('aria-pressed', 'true');

		const saved = page.waitForResponse((response) => response.url().endsWith('/theme'));
		await themeButton(page, 'Dark').click();
		await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
		await expect(themeButton(page, 'Dark')).toHaveAttribute('aria-pressed', 'true');
		await expect(themeButton(page, 'Match this device')).toHaveAttribute('aria-pressed', 'false');
		expect(await backgroundLuminance(page)).toBeLessThan(0.2);
		expect((await saved).status()).toBe(204);

		const cookie = (await context.cookies()).find((entry) => entry.name === 'theme');
		expect(cookie).toMatchObject({ value: 'dark', httpOnly: true, sameSite: 'Lax', path: '/' });

		await page.reload();
		await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
		await expect(themeButton(page, 'Dark')).toHaveAttribute('aria-pressed', 'true');
		expect(await backgroundLuminance(page)).toBeLessThan(0.2);
	});

	test('choosing "match this device" removes the cookie', async ({ page, context, baseURL }) => {
		await context.addCookies([{ name: 'theme', value: 'dark', url: baseURL! }]);
		await page.goto('/styleguide');
		await page.waitForLoadState('networkidle');

		const saved = page.waitForResponse((response) => response.url().endsWith('/theme'));
		await themeButton(page, 'Match this device').click();
		await saved;

		await expect(page.locator('html')).toHaveAttribute('data-theme', 'system');
		expect((await context.cookies()).find((entry) => entry.name === 'theme')).toBeUndefined();
	});

	test('an unknown theme is rejected', async ({ request, baseURL }) => {
		const response = await request.post('/theme', {
			headers: { origin: baseURL! },
			form: { theme: 'neon' }
		});
		expect(response.status()).toBe(400);
	});

	test('the return address cannot point to another website', async ({ request, baseURL }) => {
		const post = (returnTo: string) =>
			request.post('/theme', {
				headers: { origin: baseURL! },
				form: { theme: 'dark', returnTo },
				maxRedirects: 0
			});

		const outside = await post('//evil.example/');
		expect(outside.status()).toBe(303);
		expect(outside.headers()['location']).toBe('/');

		const inside = await post('/styleguide');
		expect(inside.headers()['location']).toBe('/styleguide');
	});
});

test.describe('theme without JavaScript', () => {
	test.use({ javaScriptEnabled: false });

	test('the toggle works as a plain form and returns to the same page', async ({ page }) => {
		await page.goto('/styleguide');

		await themeButton(page, 'Dark').click();

		await expect(page).toHaveURL(/\/styleguide$/);
		await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
		await expect(themeButton(page, 'Dark')).toHaveAttribute('aria-pressed', 'true');
	});
});

test.describe('keyboard', () => {
	test('every control on the styleguide can be reached with Tab', async ({ page }) => {
		await page.goto('/styleguide');
		await page.waitForLoadState('networkidle');

		const expected = await page.evaluate(() => {
			const controls = [
				...document.querySelectorAll<HTMLElement>('a[href], button:not(:disabled), input')
			].filter((element) => element.checkVisibility() && element.getAttribute('type') !== 'hidden');
			controls.forEach((element, index) => (element.dataset.tabIndex = String(index)));
			return controls.length;
		});
		expect(expected).toBeGreaterThan(15);

		const reached = new Set<string>();
		for (let presses = 0; presses < expected + 5; presses++) {
			await page.keyboard.press('Tab');
			const index = await page.evaluate(
				() => (document.activeElement as HTMLElement | null)?.dataset.tabIndex
			);
			if (index !== undefined) reached.add(index);
		}

		expect(reached.size).toBe(expected);
	});

	test('focus is clearly visible', async ({ page }) => {
		await page.goto('/styleguide');
		await page.waitForLoadState('networkidle');

		const button = page.getByRole('button', { name: 'Primary' });
		await button.focus();
		await page.keyboard.press('Shift+Tab');
		await page.keyboard.press('Tab');
		await expect(button).toBeFocused();

		const outline = await button.evaluate((element) => {
			const style = getComputedStyle(element);
			return { style: style.outlineStyle, width: style.outlineWidth };
		});
		expect(outline).toEqual({ style: 'solid', width: '3px' });
	});

	test('the skip link is the first stop and moves focus to the content', async ({ page }) => {
		await page.goto('/styleguide');
		await page.waitForLoadState('networkidle');

		await page.keyboard.press('Tab');
		const skip = page.getByRole('link', { name: 'Skip to content' });
		await expect(skip).toBeFocused();
		await expect(skip).toBeInViewport();

		await page.keyboard.press('Enter');
		await expect(page.locator('main')).toBeFocused();
	});

	test('a choice can be picked with Enter and with Space', async ({ page }) => {
		await page.goto('/styleguide');
		await page.waitForLoadState('networkidle');
		const status = page.getByTestId('picked');

		await page.getByRole('button', { name: 'A very, very big' }).focus();
		await page.keyboard.press('Enter');
		await expect(status).toHaveText('You picked: very, very big');

		await page.keyboard.press('Tab');
		await page.keyboard.press('Space');
		await expect(status).toHaveText('You picked: shy and easily scared');
	});

	test('the dialog opens, holds focus, closes on Escape and returns focus', async ({ page }) => {
		await page.goto('/styleguide');
		await page.waitForLoadState('networkidle');
		const opener = page.getByRole('button', { name: 'Open dialog' });
		const dialog = page.getByRole('dialog', { name: 'Finish for today?' });

		await opener.focus();
		await page.keyboard.press('Enter');
		await expect(dialog).toBeVisible();

		// Focus starts inside the dialog.
		expect(await dialog.evaluate((element) => element.contains(document.activeElement))).toBe(true);

		// Tab never reaches the page behind it. (Focus may pass through the browser's own
		// toolbar on the way round, which shows up here as the body being active.)
		for (let presses = 0; presses < 8; presses++) {
			await page.keyboard.press('Tab');
			const where = await dialog.evaluate((element) =>
				element.contains(document.activeElement)
					? 'dialog'
					: document.activeElement === document.body
						? 'browser'
						: 'page'
			);
			expect(where).not.toBe('page');
		}

		await page.keyboard.press('Escape');
		await expect(dialog).toBeHidden();
		await expect(opener).toBeFocused();

		// It can be opened again, and its own buttons close it too.
		await page.keyboard.press('Enter');
		await expect(dialog).toBeVisible();
		await dialog.getByRole('button', { name: 'Keep going' }).press('Enter');
		await expect(dialog).toBeHidden();
		await expect(opener).toBeFocused();

		// And the close button works, again straight after reopening.
		await page.keyboard.press('Enter');
		await expect(dialog).toBeVisible();
		await dialog.getByRole('button', { name: 'Close' }).press('Enter');
		await expect(dialog).toBeHidden();
		await expect(opener).toBeFocused();
	});

	test('the theme can be changed from the keyboard', async ({ page }) => {
		await page.goto('/styleguide');
		await page.waitForLoadState('networkidle');

		await themeButton(page, 'Dark').focus();
		await page.keyboard.press('Enter');

		await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
	});
});

test.describe('layout', () => {
	for (const width of [360, 768, 1280, 1920]) {
		test(`holds at ${width}px wide`, async ({ page }) => {
			await page.setViewportSize({ width, height: 800 });

			for (const path of ['/', '/styleguide']) {
				await page.goto(path);
				await page.waitForLoadState('networkidle');

				// Nothing sticks out sideways.
				const overflow = await page.evaluate(
					() => document.documentElement.scrollWidth - document.documentElement.clientWidth
				);
				expect(overflow, `${path} scrolls sideways`).toBeLessThanOrEqual(0);

				const outside = await page.evaluate(() =>
					[...document.querySelectorAll<HTMLElement>('main *')]
						.filter((element) => element.checkVisibility())
						.filter((element) => {
							const box = element.getBoundingClientRect();
							return box.left < -0.5 || box.right > window.innerWidth + 0.5;
						})
						.map((element) => element.outerHTML.slice(0, 80))
				);
				expect(outside, `${path} has elements outside the viewport`).toEqual([]);
			}
		});
	}

	test('choices sit in one column on a phone and two on a wide screen', async ({ page }) => {
		const columns = () =>
			page
				.locator('.choice-list .grid')
				.first()
				.evaluate((grid) => getComputedStyle(grid).gridTemplateColumns.split(' ').length);

		await page.setViewportSize({ width: 360, height: 800 });
		await page.goto('/styleguide');
		expect(await columns()).toBe(1);

		await page.setViewportSize({ width: 1280, height: 800 });
		expect(await columns()).toBe(2);
	});

	test('every button is at least 44px in both directions', async ({ page }) => {
		await page.setViewportSize({ width: 360, height: 800 });
		await page.goto('/styleguide');
		await page.waitForLoadState('networkidle');

		const tooSmall = await page.evaluate(() =>
			[...document.querySelectorAll<HTMLElement>('button, a.button, input:not([type=hidden])')]
				.filter((element) => element.checkVisibility())
				// A checkbox is pressed through the label wrapped around it.
				.map((element) => element.closest<HTMLElement>('label.check') ?? element)
				.map((element) => ({ element, box: element.getBoundingClientRect() }))
				.filter(({ box }) => box.width < 44 || box.height < 44)
				.map(({ element, box }) => `${element.outerHTML.slice(0, 60)} ${box.width}x${box.height}`)
		);
		expect(tooSmall).toEqual([]);
	});
});
