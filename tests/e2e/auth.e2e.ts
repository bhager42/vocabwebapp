import { readdirSync } from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import {
	addChild,
	expectAccessible,
	fillSetup,
	fillSignIn,
	PARENT,
	resetAccounts,
	setUpParent,
	signOut,
	withDb
} from './helpers.ts';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

const WRONG = 'That username or password is not right.';
// What a browser sends when a plain HTML form is submitted.
const form = { 'content-type': 'application/x-www-form-urlencoded', accept: 'text/html' };

/** Every URL under /parent that has a page or an endpoint, found from the route files. */
function parentRoutes(): string[] {
	const root = path.resolve('src/routes');
	const found: string[] = [];

	const walk = (dir: string, url: string) => {
		const entries = readdirSync(dir, { withFileTypes: true });
		if (entries.some((entry) => entry.name === '+page.svelte' || entry.name === '+server.ts')) {
			found.push(url || '/');
		}
		for (const entry of entries.filter((entry) => entry.isDirectory())) {
			const segment = entry.name.startsWith('(') // a layout group adds nothing to the URL
				? ''
				: `/${entry.name.replace(/\[.+\]/, '1')}`;
			walk(path.join(dir, entry.name), url + segment);
		}
	};

	walk(path.join(root, 'parent'), '/parent');
	return found.filter((url) => url !== '/parent/login').sort();
}

test.beforeEach(() => resetAccounts());

test.describe('first-run setup', () => {
	test('creates the parent account and signs in', async ({ page, context }) => {
		await page.goto('/parent');
		await expect(page).toHaveURL(/\/parent\/login$/);
		await page.getByRole('link', { name: 'Set up Vocab' }).click();

		await fillSetup(page);

		await expect(page).toHaveURL(/\/parent$/);
		await expect(page.getByRole('heading', { level: 1, name: 'Children' })).toBeVisible();

		const cookie = (await context.cookies()).find((entry) => entry.name === 'vocab_parent');
		expect(cookie).toMatchObject({ httpOnly: true, sameSite: 'Strict', path: '/' });
		expect(cookie!.value).toMatch(/^[A-Za-z0-9_-]{43}$/);
	});

	test('needs the right setup code', async ({ page }) => {
		await fillSetup(page, { token: 'not-the-code' });

		await expect(page.getByText('That setup code is not right.')).toBeVisible();
		await expect(page).toHaveURL(/\/setup$/);
		expect(withDb((db) => db.prepare('select count(*) as n from parent').get())).toEqual({ n: 0 });
	});

	test('rejects a short password, a mismatch, and a password equal to the username', async ({
		page
	}) => {
		// Send the form straight to the server, past the browser's own length check.
		await page.goto('/setup');
		await page.locator('main form').evaluate((element) => element.setAttribute('novalidate', ''));
		await page.getByLabel('Setup code').fill('e2e-setup-token');
		await page.getByLabel('Username').fill('parent');
		await page.getByLabel('Password', { exact: true }).fill('too short');
		await page.getByLabel('Password again').fill('too short');
		await page.getByRole('button', { name: 'Create account' }).click();
		await expect(page.getByText('A password needs at least 12 characters.')).toBeVisible();
		// What was typed for the username is kept; passwords never are.
		await expect(page.getByLabel('Username')).toHaveValue('parent');
		await expect(page.getByLabel('Password', { exact: true })).toHaveValue('');

		await fillSetup(page, { confirm: 'something else entirely' });
		await expect(page.getByText('The two passwords do not match.')).toBeVisible();

		await fillSetup(page, { username: 'parentparent1', password: 'ParentParent1' });
		await expect(
			page.getByText('The password must not be the same as the username.')
		).toBeVisible();

		expect(withDb((db) => db.prepare('select count(*) as n from parent').get())).toEqual({ n: 0 });
	});

	test('closes for good once an account exists', async ({ page, request, baseURL }) => {
		await setUpParent(page);
		await signOut(page);

		// The page is gone...
		await page.goto('/setup');
		await expect(page).toHaveURL(/\/parent\/login$/);
		await expect(page.getByRole('link', { name: 'Set up Vocab' })).toHaveCount(0);

		// ...and so is the form behind it, even with the right code.
		const response = await request.post('/setup', {
			headers: { ...form, origin: baseURL! },
			data: 'token=e2e-setup-token&username=intruder&password=another+long+password&confirm=another+long+password',
			maxRedirects: 0
		});
		expect(response.status()).toBe(303);
		expect(response.headers()['location']).toBe('/parent/login');
		expect(withDb((db) => db.prepare('select username from parent').all())).toEqual([
			{ username: PARENT.username }
		]);
	});

	test('locks out an address that keeps guessing the setup code', async ({ page }) => {
		test.slow();
		for (let attempt = 0; attempt < 5; attempt++) {
			await fillSetup(page, { token: `guess-${attempt}` });
			await expect(page.getByText('That setup code is not right.')).toBeVisible();
		}

		await fillSetup(page);
		await expect(page.getByText(/Too many tries. Please wait 15 minutes/)).toBeVisible();
		expect(withDb((db) => db.prepare('select count(*) as n from parent').get())).toEqual({ n: 0 });
	});
});

test.describe('sign in', () => {
	test.beforeEach(async ({ page }) => {
		await setUpParent(page);
		await signOut(page);
	});

	test('works with the right username and password', async ({ page }) => {
		await fillSignIn(page);

		await expect(page).toHaveURL(/\/parent$/);
		await expect(page.getByText(`Signed in as ${PARENT.username}.`)).toBeAttached();
	});

	test('the username is not case sensitive', async ({ page }) => {
		await fillSignIn(page, PARENT.password, '  PARENT ');
		await expect(page).toHaveURL(/\/parent$/);
	});

	test('gives the same answer for a wrong password and an unknown username', async ({ page }) => {
		await fillSignIn(page, 'not the right password');
		await expect(page.getByRole('alert')).toHaveText(WRONG);
		await expect(page).toHaveURL(/\/parent\/login$/);
		await expect(page.getByLabel('Password')).toHaveValue('');

		await fillSignIn(page, PARENT.password, 'somebody-else');
		await expect(page.getByRole('alert')).toHaveText(WRONG);

		await page.goto('/parent');
		await expect(page).toHaveURL(/\/parent\/login$/);
	});

	test('locks out after 5 wrong passwords, even for the right one', async ({ page }) => {
		test.slow();
		for (let attempt = 0; attempt < 5; attempt++) {
			await fillSignIn(page, `wrong password ${attempt}`);
			await expect(page.getByRole('alert')).toHaveText(WRONG);
		}

		await fillSignIn(page);
		await expect(page.getByRole('alert')).toHaveText(
			'Too many tries. Please wait 15 minutes and try again.'
		);
		await page.goto('/parent');
		await expect(page).toHaveURL(/\/parent\/login$/);

		// Refused tries are not counted, so waiting out the 15 minutes is always enough.
		expect(
			withDb((db) => db.prepare('select count(*) as n from login_attempt where success = 0').get())
		).toEqual({ n: 5 });

		// Fifteen minutes later the same address can sign in again.
		withDb((db) => db.prepare('update login_attempt set at = at - ?').run(15 * MINUTE));
		await fillSignIn(page);
		await expect(page).toHaveURL(/\/parent$/);
	});

	test('four wrong passwords and then the right one is fine', async ({ page }) => {
		test.slow();
		for (let attempt = 0; attempt < 4; attempt++) {
			await fillSignIn(page, `wrong password ${attempt}`);
			await expect(page.getByRole('alert')).toHaveText(WRONG);
		}

		await fillSignIn(page);
		await expect(page).toHaveURL(/\/parent$/);
	});

	test('a client cannot dodge the lockout by sending its own X-Forwarded-For', async ({
		request,
		baseURL
	}) => {
		test.slow();
		const attempt = (index: number) =>
			request.post('/parent/login', {
				headers: { ...form, origin: baseURL!, 'x-forwarded-for': `10.9.8.${index}` },
				data: 'username=parent&password=wrong+password+here',
				maxRedirects: 0
			});

		for (let index = 0; index < 5; index++) expect((await attempt(index)).status()).toBe(400);
		expect((await attempt(99)).status()).toBe(429);
	});

	test('signing in replaces the session, and signing out ends it', async ({ page, context }) => {
		await fillSignIn(page);
		await expect(page).toHaveURL(/\/parent$/);
		const first = (await context.cookies()).find((entry) => entry.name === 'vocab_parent')!.value;

		await signOut(page);
		expect(
			(await context.cookies()).find((entry) => entry.name === 'vocab_parent')
		).toBeUndefined();
		expect(withDb((db) => db.prepare('select count(*) as n from auth_session').get())).toEqual({
			n: 0
		});

		// The old token is dead even if someone kept a copy of it.
		await context.addCookies([
			{ name: 'vocab_parent', value: first, url: 'http://localhost:4173' }
		]);
		await page.goto('/parent');
		await expect(page).toHaveURL(/\/parent\/login$/);

		await fillSignIn(page);
		await expect(page).toHaveURL(/\/parent$/);
		const second = (await context.cookies()).find((entry) => entry.name === 'vocab_parent')!.value;
		expect(second).not.toBe(first);
	});

	test('the session token is stored only as a hash', async ({ page, context }) => {
		await fillSignIn(page);
		await expect(page).toHaveURL(/\/parent$/);

		const token = (await context.cookies()).find((entry) => entry.name === 'vocab_parent')!.value;
		const stored = withDb((db) => db.prepare('select * from auth_session').all());
		expect(stored).toHaveLength(1);
		expect(JSON.stringify(stored)).not.toContain(token);
	});

	test('a signed-in parent is sent past the sign-in page', async ({ page }) => {
		await fillSignIn(page);
		await expect(page).toHaveURL(/\/parent$/);

		await page.goto('/parent/login');
		await expect(page).toHaveURL(/\/parent$/);
	});
});

test.describe('sign in without JavaScript', () => {
	test.use({ javaScriptEnabled: false });

	test('signing in, adding a child and signing out all work', async ({ page }) => {
		await setUpParent(page);
		await addChild(page, 'Sam');
		await expect(page.getByRole('heading', { name: 'Sam' })).toBeVisible();
		await signOut(page);

		await fillSignIn(page, 'not the right password');
		await expect(page.getByRole('alert')).toHaveText(WRONG);
		await expect(page.getByLabel('Username')).toHaveValue(PARENT.username);

		await fillSignIn(page);
		await expect(page).toHaveURL(/\/parent$/);
	});
});

test.describe('session expiry', () => {
	test.beforeEach(async ({ page }) => {
		await setUpParent(page);
	});

	test('stays signed in just under 12 hours without use', async ({ page }) => {
		withDb((db) =>
			db.prepare('update auth_session set last_seen_at = last_seen_at - ?').run(12 * HOUR - MINUTE)
		);

		await page.goto('/parent');
		await expect(page).toHaveURL(/\/parent$/);
	});

	test('signs out after 12 hours without use', async ({ page }) => {
		withDb((db) =>
			db.prepare('update auth_session set last_seen_at = last_seen_at - ?').run(12 * HOUR)
		);

		await page.goto('/parent');
		await expect(page).toHaveURL(/\/parent\/login$/);
		expect(withDb((db) => db.prepare('select count(*) as n from auth_session').get())).toEqual({
			n: 0
		});
	});

	test('signs out 7 days after signing in, however recently it was used', async ({ page }) => {
		withDb((db) =>
			db
				.prepare('update auth_session set created_at = created_at - ?, expires_at = expires_at - ?')
				.run(7 * DAY, 7 * DAY)
		);

		await page.goto('/parent/settings');
		await expect(page).toHaveURL(/\/parent\/login$/);
	});

	test('a form posted with an expired session changes nothing', async ({ page }) => {
		await page.goto('/parent/children/new');
		await page.getByLabel('First name').fill('Sam');
		withDb((db) =>
			db.prepare('update auth_session set last_seen_at = last_seen_at - ?').run(13 * HOUR)
		);

		await page.getByRole('button', { name: 'Add child' }).click();

		await expect(page).toHaveURL(/\/parent\/login$/);
		expect(withDb((db) => db.prepare('select count(*) as n from child').get())).toEqual({ n: 0 });
	});
});

test.describe('protected routes', () => {
	const routes = parentRoutes();

	test('the list of routes was found', () => {
		expect(routes).toEqual(
			expect.arrayContaining([
				'/parent',
				'/parent/children/1',
				'/parent/children/new',
				'/parent/logout',
				'/parent/settings'
			])
		);
	});

	for (const route of routes) {
		test(`${route} sends a visitor who is not signed in to the sign-in page`, async ({
			request,
			baseURL
		}) => {
			const get = await request.get(route, { maxRedirects: 0 });
			expect(get.status()).toBe(303);
			expect(get.headers()['location']).toBe('/parent/login');

			const post = await request.post(route, {
				headers: { ...form, origin: baseURL! },
				data: 'name=Mallory&grade=3',
				maxRedirects: 0
			});
			expect(post.status()).toBe(303);
			expect(post.headers()['location']).toBe('/parent/login');
		});
	}

	test('the same holds for forms sent by script, which get their answer as JSON', async ({
		request,
		baseURL
	}) => {
		for (const route of routes) {
			const response = await request.post(route, {
				headers: { ...form, accept: 'application/json', origin: baseURL! },
				data: 'name=Mallory&grade=3',
				maxRedirects: 0
			});
			const body = await response.text();
			const target = response.headers()['location'] ?? JSON.parse(body).location;
			expect(target, route).toBe('/parent/login');
		}
		expect(withDb((db) => db.prepare('select count(*) as n from child').get())).toEqual({ n: 0 });
	});

	test('named form actions are protected too', async ({ request, baseURL }) => {
		for (const url of [
			'/parent?/restore',
			'/parent/children/1?/save',
			'/parent/children/1?/archive',
			'/parent/settings?/password',
			'/parent/settings?/signOutEverywhere'
		]) {
			const response = await request.post(url, {
				headers: { ...form, origin: baseURL! },
				data: 'id=1',
				maxRedirects: 0
			});
			expect(response.status(), url).toBe(303);
			expect(response.headers()['location'], url).toBe('/parent/login');
		}
	});

	test('nothing leaks through the data endpoints the app uses for navigation', async ({
		page,
		playwright,
		baseURL
	}) => {
		await setUpParent(page);
		await addChild(page, 'Zebulon');
		await expect(page.getByRole('heading', { name: 'Zebulon' })).toBeVisible();

		// Find the URL the app itself fetches when moving between parent pages.
		const dataUrls: string[] = [];
		page.on('request', (request) => {
			if (request.resourceType() === 'fetch') dataUrls.push(request.url());
		});
		await page.getByRole('link', { name: 'Account' }).click();
		await expect(page.getByRole('heading', { level: 1, name: 'Account' })).toBeVisible();
		await page.getByRole('link', { name: 'Children' }).click();
		await expect(page.getByRole('heading', { name: 'Zebulon' })).toBeVisible();
		// The last one is the fetch for the children list.
		const dataUrl = dataUrls.filter((url) => new URL(url).pathname.startsWith('/parent')).at(-1);
		expect(dataUrl, 'the app fetched data for /parent').toBeDefined();

		// Signed in, that URL carries the child's name...
		const mine = await page.request.get(dataUrl!);
		expect(await mine.text()).toContain('Zebulon');

		// ...and for anyone else it carries nothing.
		const stranger = await playwright.request.newContext({ baseURL });
		const theirs = await stranger.get(dataUrl!, { maxRedirects: 0 });
		const body = await theirs.text();
		expect(body).not.toContain('Zebulon');
		expect(`${theirs.headers()['location'] ?? ''} ${body}`).toContain('/parent/login');
		await stranger.dispose();
	});

	test('parent pages are never cached', async ({ page }) => {
		await setUpParent(page);

		for (const route of ['/parent', '/parent/settings', '/parent/login', '/setup']) {
			const response = await page.request.get(route, { maxRedirects: 0 });
			if (response.status() === 200) {
				expect(response.headers()['cache-control'], route).toBe('no-store');
			}
		}
		expect((await page.request.get('/parent')).headers()['cache-control']).toBe('no-store');
	});
});

test.describe('children', () => {
	test.beforeEach(async ({ page }) => {
		await setUpParent(page);
	});

	test('starts empty, then lists a child after adding one', async ({ page }) => {
		await expect(page.getByText('No children yet.')).toBeVisible();

		await page.getByRole('link', { name: 'Add a child' }).click();
		await page.getByLabel('First name').fill('  sam ');
		await page.getByLabel('Grade').selectOption('4');
		await page.getByRole('button', { name: 'Add child' }).click();

		await expect(page).toHaveURL(/\/parent$/);
		await expect(page.getByRole('heading', { name: 'sam' })).toBeVisible();
		await expect(page.getByText('Grade 4')).toBeVisible();
		expect(
			withDb((db) => db.prepare('select name, name_normalized, grade from child').all())
		).toEqual([{ name: 'sam', name_normalized: 'sam', grade: 4 }]);
	});

	test('refuses a duplicate name and an invalid one, keeping what was typed', async ({ page }) => {
		await addChild(page, 'Sam');

		await addChild(page, 'SAM', '5');
		await expect(page.getByText('There is already a child with that name.')).toBeVisible();
		await expect(page.getByLabel('First name')).toHaveValue('SAM');
		await expect(page.getByLabel('Grade')).toHaveValue('5');
		await expect(page.getByLabel('First name')).toHaveAttribute('aria-invalid', 'true');

		await addChild(page, 'R2-D2');
		await expect(page.getByText(/A name can only contain letters/)).toBeVisible();

		expect(withDb((db) => db.prepare('select count(*) as n from child').get())).toEqual({ n: 1 });
	});

	test('a grade without a word list cannot be forced in', async ({ page, baseURL }) => {
		const response = await page.request.post('/parent/children/new', {
			headers: { ...form, origin: baseURL! },
			data: 'name=Sam&grade=9'
		});
		expect(response.status()).toBe(400);
		expect(withDb((db) => db.prepare('select count(*) as n from child').get())).toEqual({ n: 0 });
	});

	test('edits name, grade and practice settings', async ({ page }) => {
		await addChild(page, 'Sam');
		await page.getByRole('link', { name: 'Edit Sam' }).click();

		// Defaults from the plan.
		await expect(page.getByLabel('Questions per session')).toHaveValue('10');
		await expect(page.getByLabel('New words per session')).toHaveValue('4');
		await expect(page.getByLabel('Daily limit in minutes')).toHaveValue('0');
		await expect(page.getByLabel('Spelling questions')).toBeChecked();
		await expect(page.getByLabel('Move up a grade automatically')).not.toBeChecked();

		await page.getByLabel('First name').fill('Samuel');
		await page.getByLabel('Grade', { exact: true }).selectOption('5');
		await page.getByLabel('Questions per session').fill('15');
		await page.getByLabel('New words per session').fill('6');
		await page.getByLabel('Daily limit in minutes').fill('20');
		await page.getByLabel('Spelling questions').uncheck();
		await page.getByLabel('Move up a grade automatically').check();
		await page.getByRole('button', { name: 'Save changes' }).click();
		await expect(page.getByRole('status').filter({ hasText: 'Saved.' })).toBeVisible();

		await page.reload();
		await expect(page.getByRole('heading', { level: 1, name: 'Samuel' })).toBeVisible();
		await expect(page.getByLabel('Grade', { exact: true })).toHaveValue('5');
		await expect(page.getByLabel('Questions per session')).toHaveValue('15');
		await expect(page.getByLabel('New words per session')).toHaveValue('6');
		await expect(page.getByLabel('Daily limit in minutes')).toHaveValue('20');
		await expect(page.getByLabel('Spelling questions')).not.toBeChecked();
		await expect(page.getByLabel('Move up a grade automatically')).toBeChecked();
	});

	test('rejects settings outside their limits and saves nothing', async ({ page }) => {
		await addChild(page, 'Sam');
		await page.getByRole('link', { name: 'Edit Sam' }).click();
		await page.locator('form[action="?/save"]').evaluate((element) => {
			element.setAttribute('novalidate', '');
		});

		await page.getByLabel('Questions per session').fill('50');
		await page.getByRole('button', { name: 'Save changes' }).click();

		await expect(page.getByText('Questions per session must be at most 20.')).toBeVisible();
		await expect(page.getByRole('alert')).toContainText('Nothing was saved.');
		// The mistyped value is still there to correct.
		await expect(page.getByLabel('Questions per session')).toHaveValue('50');

		await page.reload();
		await expect(page.getByLabel('Questions per session')).toHaveValue('10');
	});

	test('archives after confirming, and restores', async ({ page }) => {
		await addChild(page, 'Sam');
		await page.getByRole('link', { name: 'Edit Sam' }).click();
		await page.waitForLoadState('networkidle');

		// Cancelling the confirmation changes nothing.
		await page.getByRole('button', { name: 'Archive Sam' }).click();
		const dialog = page.getByRole('dialog', { name: 'Archive Sam?' });
		await expect(dialog).toBeVisible();
		await dialog.getByRole('button', { name: 'Cancel' }).click();
		await expect(dialog).toBeHidden();
		expect(withDb((db) => db.prepare('select archived_at from child').get())).toEqual({
			archived_at: null
		});

		await page.getByRole('button', { name: 'Archive Sam' }).click();
		await dialog.getByRole('button', { name: 'Yes, archive' }).click();

		await expect(page).toHaveURL(/\/parent$/);
		const archived = page.getByRole('region', { name: 'Archived' });
		await expect(archived.getByRole('heading', { name: 'Sam' })).toBeVisible();
		await expect(page.getByRole('link', { name: 'Edit Sam' })).toHaveCount(0);

		await archived.getByRole('button', { name: 'Restore Sam' }).click();
		await expect(page.getByRole('link', { name: 'Edit Sam' })).toBeVisible();
		await expect(page.getByRole('region', { name: 'Archived' })).toHaveCount(0);
	});

	test('a child that does not exist is a 404, not an error', async ({ page }) => {
		for (const id of ['999', 'abc', '1e3', '-1']) {
			const response = await page.request.get(`/parent/children/${id}`);
			expect(response.status(), id).toBe(404);
		}
	});

	test('a child name is shown as text, never run as markup', async ({ page }) => {
		// The form rejects this, so put it straight in the database, as a worst case.
		withDb((db) =>
			db
				.prepare('insert into child (name, name_normalized, grade, created_at) values (?, ?, 3, ?)')
				.run('<img src=x onerror=alert(1)>', 'xss', Date.now())
		);
		let dialogs = 0;
		page.on('dialog', () => dialogs++);

		await page.goto('/parent');

		await expect(page.getByRole('heading', { name: '<img src=x onerror=alert(1)>' })).toBeVisible();
		expect(dialogs).toBe(0);
	});
});

test.describe('account', () => {
	test.beforeEach(async ({ page }) => {
		await setUpParent(page);
	});

	test('changes the password and signs out other devices', async ({ page, browser }) => {
		// A second device signs in.
		const other = await browser.newContext();
		const otherPage = await other.newPage();
		await fillSignIn(otherPage);
		await expect(otherPage).toHaveURL(/\/parent$/);

		await page.goto('/parent/settings');
		await page.getByLabel('Current password').fill(PARENT.password);
		await page.getByLabel('New password', { exact: true }).fill('a brand new password');
		await page.getByLabel('New password again').fill('a brand new password');
		await page.getByRole('button', { name: 'Change password' }).click();
		await expect(page.getByText('Your password has been changed.')).toBeVisible();

		// This browser stays signed in; the other one does not.
		await page.goto('/parent');
		await expect(page).toHaveURL(/\/parent$/);
		await otherPage.goto('/parent');
		await expect(otherPage).toHaveURL(/\/parent\/login$/);

		// Only the new password works now.
		await fillSignIn(otherPage);
		await expect(otherPage.getByRole('alert')).toHaveText(WRONG);
		await fillSignIn(otherPage, 'a brand new password');
		await expect(otherPage).toHaveURL(/\/parent$/);
		await other.close();
	});

	test('needs the current password to change it', async ({ page }) => {
		await page.goto('/parent/settings');
		await page.getByLabel('Current password').fill('not my password at all');
		await page.getByLabel('New password', { exact: true }).fill('a brand new password');
		await page.getByLabel('New password again').fill('a brand new password');
		await page.getByRole('button', { name: 'Change password' }).click();

		await expect(page.getByText('That is not your current password.')).toBeVisible();

		await signOut(page);
		await fillSignIn(page);
		await expect(page).toHaveURL(/\/parent$/);
	});

	test('"sign out everywhere" ends every session, including this one', async ({
		page,
		browser
	}) => {
		const other = await browser.newContext();
		const otherPage = await other.newPage();
		await fillSignIn(otherPage);
		await expect(otherPage).toHaveURL(/\/parent$/);

		await page.goto('/parent/settings');
		await page.getByRole('button', { name: 'Sign out everywhere' }).click();

		await expect(page).toHaveURL(/\/parent\/login$/);
		await otherPage.goto('/parent');
		await expect(otherPage).toHaveURL(/\/parent\/login$/);
		expect(withDb((db) => db.prepare('select count(*) as n from auth_session').get())).toEqual({
			n: 0
		});
		await other.close();
	});
});

test.describe('accessibility of the parent pages', () => {
	test.use({ reducedMotion: 'reduce' });

	for (const theme of ['light', 'dark'] as const) {
		test(`no axe violations in the ${theme} theme`, async ({ page, context, baseURL }) => {
			await context.addCookies([{ name: 'theme', value: theme, url: baseURL! }]);

			await page.goto('/setup');
			await expectAccessible(page);
			await fillSetup(page, { token: 'wrong' });
			await expect(page.getByText('That setup code is not right.')).toBeVisible();
			await expectAccessible(page);

			await setUpParent(page);
			await expectAccessible(page); // empty list

			await addChild(page, 'Sam');
			await addChild(page, 'Mia', '5');
			await page.goto('/parent/children/new');
			await expectAccessible(page);

			await page.goto('/parent');
			await page.getByRole('link', { name: 'Edit Mia' }).click();
			await expect(page.getByRole('heading', { level: 1, name: 'Mia' })).toBeVisible();
			await expectAccessible(page);
			await page.waitForLoadState('networkidle');
			await page.getByRole('button', { name: 'Archive Mia' }).click();
			await expect(page.getByRole('dialog')).toBeVisible();
			await expectAccessible(page);
			await page.getByRole('button', { name: 'Yes, archive' }).click();
			await expect(page).toHaveURL(/\/parent$/);
			await expectAccessible(page); // a child, and an archived child

			await page.goto('/parent/settings');
			await expectAccessible(page);

			await signOut(page);
			await fillSignIn(page, 'not the right password');
			await expect(page.getByRole('alert')).toBeVisible();
			await expectAccessible(page);
		});
	}

	test('the parent pages hold at 360px wide', async ({ page }) => {
		await page.setViewportSize({ width: 360, height: 800 });
		await setUpParent(page);
		await addChild(page, 'Bartholomew-Alexander Maximilian');

		for (const route of ['/parent', '/parent/children/new', '/parent/settings', '/parent/login']) {
			await page.goto(route);
			const overflow = await page.evaluate(
				() => document.documentElement.scrollWidth - document.documentElement.clientWidth
			);
			expect(overflow, route).toBeLessThanOrEqual(0);
		}
	});
});
