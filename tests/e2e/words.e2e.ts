import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { expect, test, type Page } from '@playwright/test';
import {
	createChild,
	enterAs,
	expectAccessible,
	fillSignIn,
	resetAccounts,
	setUpParent,
	withDb
} from './helpers.ts';

const form = { 'content-type': 'application/x-www-form-urlencoded', accept: 'text/html' };
const BACKUPS = '.tmp/e2e-data/backups';

const one = <T>(sql: string, ...args: unknown[]) =>
	withDb((db) => db.prepare(sql).get(...args) as T);
const listId = (name: string) =>
	one<{ id: number }>('select id from word_list where name = ?', name).id;

test.beforeEach(async ({ page }) => {
	resetAccounts();
	await setUpParent(page);
});

/** Makes a list of the parent's own through the page, ending on that list's page. */
async function makeList(page: Page, name: string, grade = '3') {
	await page.goto('/parent/words');
	await page.getByLabel('Name of the list').fill(name);
	await page.getByLabel('Grade').selectOption(grade);
	await page.getByRole('button', { name: 'Create list' }).click();
	await expect(page.getByRole('heading', { level: 1, name })).toBeVisible();
}

/** The box holding the fields for one pasted word. */
const draft = (page: Page, word: string) => page.getByRole('group', { name: word, exact: true });

async function fillDraft(
	page: Page,
	word: string,
	values: { kind: string; meaning: string; sentence: string }
) {
	const box = draft(page, word);
	await box.getByLabel('Kind of word').selectOption(values.kind);
	await box.getByLabel('Meaning').fill(values.meaning);
	await box.getByLabel('Sentence').fill(values.sentence);
}

const quokka = {
	kind: 'noun',
	meaning: 'a small smiling animal',
	sentence: 'The quokka hopped away.'
};
const zesty = {
	kind: 'adjective',
	meaning: 'full of sharp flavor',
	sentence: 'The zesty soup was hot.'
};

test.describe('built-in lists', () => {
	test('are listed with their word counts and reached from the menu', async ({ page }) => {
		await page.getByRole('link', { name: 'Word lists' }).click();
		await expect(page.getByRole('heading', { level: 1, name: 'Word lists' })).toBeVisible();

		const rows = page.getByRole('group', { name: 'Word lists' }).getByRole('row');
		await expect(rows).toHaveCount(6);
		for (const [index, grade] of [3, 4, 5, 6, 7].entries()) {
			await expect(rows.nth(index + 1)).toContainText(`Grade ${grade}`);
			await expect(rows.nth(index + 1)).toContainText('(built in)');
			await expect(rows.nth(index + 1)).toContainText('120 of 120');
			await expect(rows.nth(index + 1)).toContainText('On');
		}
	});

	test('a whole list can be switched off and on again', async ({ page }) => {
		await page.goto('/parent/words');
		const row = page.getByRole('row', { name: /Grade 5/ });

		await row.getByRole('button', { name: 'Switch off Grade 5' }).click();
		await expect(row.getByRole('button', { name: 'Switch on Grade 5' })).toBeVisible();
		await expect(row).toContainText('Off');
		expect(one('select active from word_list where name = ?', 'Grade 5')).toEqual({ active: 0 });
		// The other lists are untouched.
		expect(one('select count(*) as n from word_list where active = 0')).toEqual({ n: 1 });

		await row.getByRole('button', { name: 'Switch on Grade 5' }).click();
		await expect(row).toContainText('On');
		expect(one('select active from word_list where name = ?', 'Grade 5')).toEqual({ active: 1 });
	});

	test('a single word can be switched off, and is then never asked', async ({ page, browser }) => {
		// Leave grade 3 with one word only, then switch that one off too.
		withDb((db) =>
			db.exec(
				`update word set active = 0 where list_id = (select id from word_list where name = 'Grade 3')
				   and word != 'enormous'`
			)
		);
		await page.goto(`/parent/words/${listId('Grade 3')}`);
		await expect(page.getByText('1 of 120 words in use')).toBeVisible();
		// A built-in list offers nothing but the switches.
		await expect(page.getByRole('heading', { name: 'Add words' })).toHaveCount(0);
		await expect(page.getByRole('button', { name: 'Delete list' })).toHaveCount(0);

		const row = page.getByRole('row', { name: /^enormous/ });
		await row.getByRole('button', { name: 'Switch off enormous' }).click();
		await expect(row.getByRole('button', { name: 'Switch on enormous' })).toBeVisible();
		await expect(page.getByText('0 of 120 words in use')).toBeVisible();

		createChild('Sam');
		const child = await (await browser.newContext()).newPage();
		await enterAs(child, 'Sam');
		await child.getByRole('button', { name: 'Start practicing' }).click();
		await expect(child.getByText('There are no words to practice yet.')).toBeVisible();
		expect(one('select count(*) as n from question')).toEqual({ n: 0 });
		await child.context().close();
	});

	test('cannot be changed by a forged request', async ({ page, baseURL }) => {
		const grade3 = listId('Grade 3');
		const wordId = one<{ id: number }>('select id from word where list_id = ? limit 1', grade3).id;
		const post = (url: string, data: string) =>
			page.request.post(url, { headers: { ...form, origin: baseURL! }, data });
		const entry =
			'word=hacked&partOfSpeech=noun&definition=a+thing&sentence=It+was+hacked.&synonyms=';

		expect((await post(`/parent/words/${grade3}?/add`, entry)).status()).toBe(404);
		expect((await post(`/parent/words/${grade3}?/paste`, 'pasted=hacked')).status()).toBe(404);
		expect((await post(`/parent/words/${grade3}?/rename`, 'name=Mine&grade=3')).status()).toBe(404);
		expect((await post(`/parent/words/${grade3}?/delete`, '')).status()).toBe(404);
		expect((await post(`/parent/words/${grade3}/${wordId}?/save`, entry)).status()).toBe(404);
		expect((await post(`/parent/words/${grade3}/${wordId}?/delete`, '')).status()).toBe(404);
		expect((await page.request.get(`/parent/words/${grade3}/${wordId}`)).status()).toBe(404);

		expect(one('select count(*) as n from word where list_id = ?', grade3)).toEqual({ n: 120 });
		expect(one('select name from word_list where id = ?', grade3)).toEqual({ name: 'Grade 3' });
		expect(one("select count(*) as n from word where word = 'hacked'")).toEqual({ n: 0 });
	});
});

test.describe('your own lists', () => {
	test('paste words, fill in their meanings, and save them', async ({ page }) => {
		await makeList(page, 'School week 12');
		await expect(page.getByText('This list has no words yet.')).toBeVisible();

		await page.getByLabel('Words to add').fill('Quokka\nice cream, zesty\nquokka');
		await page.getByRole('button', { name: 'Next: fill in meanings' }).click();

		// "ice cream" is two words; the repeat of quokka is dropped quietly.
		await expect(page.getByText('“ice cream” is not a single word of letters')).toBeVisible();
		await expect(page.locator('form fieldset')).toHaveCount(2);
		await expect(draft(page, 'quokka').getByLabel('Word', { exact: true })).toHaveValue('quokka');
		expect(one('select count(*) as n from word where word in (?, ?)', 'quokka', 'zesty')).toEqual({
			n: 0
		});

		await fillDraft(page, 'quokka', quokka);
		await fillDraft(page, 'zesty', zesty);
		await draft(page, 'zesty').getByLabel('Words that mean the same').fill('tangy, spicy');
		await page.getByRole('button', { name: 'Save 2 words' }).click();

		await expect(page.getByRole('status')).toHaveText('2 words added.');
		await expect(page.getByText('2 of 2 words in use')).toBeVisible();
		const rows = page.getByRole('group', { name: 'Words in this list' }).getByRole('row');
		await expect(rows).toHaveCount(3);
		await expect(rows.nth(1)).toContainText('quokka');
		await expect(rows.nth(1)).toContainText('a small smiling animal');
		expect(
			one(
				'select part_of_speech, sentence, synonyms_json, active from word where word = ?',
				'zesty'
			)
		).toEqual({
			part_of_speech: 'adjective',
			sentence: 'The zesty soup was hot.',
			synonyms_json: '["tangy","spicy"]',
			active: 1
		});
		// The paste box is back, ready for more.
		await expect(page.getByLabel('Words to add')).toHaveValue('');
	});

	test('says what is wrong, keeps what was typed, and saves nothing', async ({ page }) => {
		await makeList(page, 'School week 12');
		await page.getByLabel('Words to add').fill('quokka, zesty');
		await page.getByRole('button', { name: 'Next: fill in meanings' }).click();

		await fillDraft(page, 'quokka', quokka);
		// The meaning uses the word, and the sentence uses a different form of it.
		await fillDraft(page, 'zesty', {
			kind: 'adjective',
			meaning: 'having a zesty taste',
			sentence: 'She added zest to the soup.'
		});
		await page.getByRole('button', { name: 'Save 2 words' }).click();

		await expect(page.getByRole('alert')).toContainText('Nothing was saved');
		const bad = draft(page, 'zesty');
		await expect(bad.getByText('The meaning must not use the word itself.')).toBeVisible();
		await expect(bad.getByText(/must use the word exactly once/)).toBeVisible();
		await expect(bad.getByLabel('Meaning')).toHaveValue('having a zesty taste');
		await expect(bad.getByLabel('Meaning')).toHaveAttribute('aria-invalid', 'true');
		// The good entry is still there, untouched, and was not saved on its own.
		await expect(draft(page, 'quokka').getByLabel('Sentence')).toHaveValue(quokka.sentence);
		await expect(draft(page, 'quokka').getByLabel('Kind of word')).toHaveValue('noun');
		expect(one('select count(*) as n from word where word = ?', 'quokka')).toEqual({ n: 0 });

		await fillDraft(page, 'zesty', zesty);
		await page.getByRole('button', { name: 'Save 2 words' }).click();
		await expect(page.getByRole('status')).toHaveText('2 words added.');
	});

	test('the whole of it works without JavaScript', async ({ browser }) => {
		const context = await browser.newContext({ javaScriptEnabled: false });
		const page = await context.newPage();
		await fillSignIn(page);

		await makeList(page, 'No script');
		await page.getByLabel('Words to add').fill('quokka');
		await page.getByRole('button', { name: 'Next: fill in meanings' }).click();
		await fillDraft(page, 'quokka', { ...quokka, sentence: 'No such word here.' });
		await page.getByRole('button', { name: 'Save 1 word' }).click();
		await expect(page.getByRole('alert')).toContainText('Nothing was saved');
		await expect(draft(page, 'quokka').getByLabel('Meaning')).toHaveValue(quokka.meaning);

		await fillDraft(page, 'quokka', quokka);
		await page.getByRole('button', { name: 'Save 1 word' }).click();
		await expect(page.getByRole('status')).toHaveText('1 word added.');

		await page.getByRole('button', { name: 'Switch off quokka' }).click();
		await expect(page.getByRole('button', { name: 'Switch on quokka' })).toBeVisible();
		expect(one('select active from word where word = ?', 'quokka')).toEqual({ active: 0 });
		await context.close();
	});

	test('pasting nothing usable, or only words already there, is explained', async ({ page }) => {
		await makeList(page, 'School week 12');
		await page.getByLabel('Words to add').fill('ice cream, 123');
		await page.getByRole('button', { name: 'Next: fill in meanings' }).click();
		await expect(page.getByText(/Type or paste at least one word/)).toBeVisible();
		await expect(page.getByLabel('Words to add')).toHaveValue('ice cream, 123');

		await page.getByLabel('Words to add').fill('quokka');
		await page.getByRole('button', { name: 'Next: fill in meanings' }).click();
		await fillDraft(page, 'quokka', quokka);
		await page.getByRole('button', { name: 'Save 1 word' }).click();
		await expect(page.getByRole('status')).toBeVisible();

		await page.getByLabel('Words to add').fill('Quokka');
		await page.getByRole('button', { name: 'Next: fill in meanings' }).click();
		await expect(page.getByText('Those words are all in the list already.')).toBeVisible();
	});

	test('a word that is also in a built-in list is pointed out', async ({ page }) => {
		await makeList(page, 'School week 12');
		await page.getByLabel('Words to add').fill('enormous');
		await page.getByRole('button', { name: 'Next: fill in meanings' }).click();
		await expect(draft(page, 'enormous').getByText('Also in the list “Grade 3”.')).toBeVisible();
	});

	test('a word can be changed and removed', async ({ page }) => {
		await makeList(page, 'School week 12');
		await page.getByLabel('Words to add').fill('quokka');
		await page.getByRole('button', { name: 'Next: fill in meanings' }).click();
		await fillDraft(page, 'quokka', quokka);
		await page.getByRole('button', { name: 'Save 1 word' }).click();

		await page.getByRole('link', { name: 'quokka' }).click();
		await expect(page.getByRole('heading', { level: 1, name: 'quokka' })).toBeVisible();
		await expect(page.getByLabel('Kind of word')).toHaveValue('noun');

		await page.getByLabel('Meaning').fill('');
		await page.getByLabel('Meaning').fill('a quokka is an animal');
		await page.getByRole('button', { name: 'Save changes' }).click();
		await expect(page.getByText('The meaning must not use the word itself.')).toBeVisible();
		await expect(page.getByLabel('Meaning')).toHaveValue('a quokka is an animal');

		await page.getByLabel('Meaning').fill('a friendly little animal');
		await page.getByRole('button', { name: 'Save changes' }).click();
		await expect(page.getByRole('status')).toHaveText('Saved.');
		expect(one('select definition from word where word = ?', 'quokka')).toEqual({
			definition: 'a friendly little animal'
		});

		await page.getByRole('button', { name: 'Remove word' }).click();
		await expect(page.getByRole('heading', { level: 1, name: 'School week 12' })).toBeVisible();
		expect(one('select count(*) as n from word where word = ?', 'quokka')).toEqual({ n: 0 });
	});

	test('a list can be renamed, and deleted after confirming', async ({ page }) => {
		await makeList(page, 'School week 12');
		await page.waitForLoadState('networkidle');

		const about = page.locator('section').filter({ hasText: 'About this list' });
		await about.getByLabel('Name of the list').fill('Grade 4');
		await about.getByRole('button', { name: 'Save' }).click();
		await expect(page.getByText('There is already a list with that name.')).toBeVisible();

		await about.getByLabel('Name of the list').fill('Week 13');
		await about.getByLabel('Grade').selectOption('4');
		await about.getByRole('button', { name: 'Save' }).click();
		await expect(page.getByRole('heading', { level: 1, name: 'Week 13' })).toBeVisible();
		expect(one("select grade from word_list where name = 'Week 13'")).toEqual({ grade: 4 });

		await page.getByRole('button', { name: 'Delete list' }).click();
		await expect(page.getByRole('dialog', { name: 'Delete “Week 13”?' })).toBeVisible();
		await page.getByRole('button', { name: 'Cancel' }).click();
		expect(one("select count(*) as n from word_list where source = 'custom'")).toEqual({ n: 1 });

		await page.getByRole('button', { name: 'Delete list' }).click();
		await page.getByRole('button', { name: 'Yes, delete' }).click();
		await expect(page).toHaveURL(/\/parent\/words$/);
		expect(one("select count(*) as n from word_list where source = 'custom'")).toEqual({ n: 0 });
	});

	test('your words are the first new words a child meets, and then cannot be deleted', async ({
		page,
		browser
	}) => {
		await makeList(page, 'School week 12');
		await page.getByLabel('Words to add').fill('quokka, zesty');
		await page.getByRole('button', { name: 'Next: fill in meanings' }).click();
		await fillDraft(page, 'quokka', quokka);
		await fillDraft(page, 'zesty', zesty);
		await page.getByRole('button', { name: 'Save 2 words' }).click();
		await expect(page.getByRole('status')).toBeVisible();

		createChild('Sam');
		const child = await (await browser.newContext()).newPage();
		await enterAs(child, 'Sam');
		await child.getByRole('button', { name: 'Start practicing' }).click();
		await expect(child).toHaveURL(/\/play$/);
		await child.context().close();

		// Four new words a session, out of 122 for grade 3: both of the parent's are in.
		const plan = JSON.parse(
			one<{ plan_json: string }>('select plan_json from practice_session').plan_json
		) as { wordId: number }[];
		const mine = withDb(
			(db) =>
				db.prepare("select id from word where word in ('quokka', 'zesty')").all() as {
					id: number;
				}[]
		);
		for (const { id } of mine) expect(plan.some((item) => item.wordId === id)).toBe(true);

		// One of them has now been asked, so the list can only be switched off.
		await page.reload();
		await page.waitForLoadState('networkidle');
		await page.getByRole('button', { name: 'Delete list' }).click();
		await page.getByRole('button', { name: 'Yes, delete' }).click();
		await expect(page.getByRole('alert')).toContainText('cannot be deleted');
		expect(one("select count(*) as n from word_list where source = 'custom'")).toEqual({ n: 1 });
	});

	test('a list name is shown as text, never run as markup', async ({ page }) => {
		const nasty = '<img src=x onerror="document.title=1">';
		await makeList(page, nasty);
		await page.goto('/parent/words');
		await expect(page.getByRole('link', { name: nasty })).toBeVisible();
		await expect(page.locator('img[src="x"]')).toHaveCount(0);
		await expect(page).toHaveTitle('Word lists · Vocab');
	});

	test('pages for lists and words that do not exist are 404s', async ({ page }) => {
		for (const path of ['/parent/words/99999', '/parent/words/abc', '/parent/words/99999/1']) {
			expect((await page.request.get(path)).status(), path).toBe(404);
		}
	});
});

test.describe('backups', () => {
	test('the account page downloads a copy of the database that opens on its own', async ({
		page
	}, testInfo) => {
		createChild('Sam');
		await page.goto('/parent/settings');
		const [download] = await Promise.all([
			page.waitForEvent('download'),
			page.getByRole('button', { name: 'Download a backup now' }).click()
		]);
		expect(download.suggestedFilename()).toMatch(/^vocab-backup-\d{4}-\d{2}-\d{2}\.db$/);

		const file = testInfo.outputPath('backup.db');
		await download.saveAs(file);
		const copy = new Database(file, { readonly: true });
		expect(copy.pragma('integrity_check', { simple: true })).toBe('ok');
		expect(copy.prepare('select name from child').all()).toEqual([{ name: 'Sam' }]);
		expect(copy.prepare('select count(*) as n from word').get()).toEqual(
			one('select count(*) as n from word')
		);
		expect(copy.prepare('select username from parent').all()).toEqual([{ username: 'parent' }]);
		copy.close();

		// The copy made for the download is not left lying in the data folder.
		const left = existsSync(BACKUPS) ? readdirSync(BACKUPS) : [];
		expect(left.filter((name) => name.startsWith('download-'))).toEqual([]);
	});

	test('is sent as a file and never cached', async ({ page, baseURL }) => {
		const response = await page.request.post('/parent/settings/backup', {
			headers: { ...form, origin: baseURL! },
			data: ''
		});
		expect(response.status()).toBe(200);
		const headers = response.headers();
		expect(headers['content-type']).toBe('application/vnd.sqlite3');
		expect(headers['content-disposition']).toMatch(/^attachment; filename="vocab-backup-/);
		expect(headers['cache-control']).toContain('no-store');
		expect(headers['x-content-type-options']).toBe('nosniff');
		expect((await response.body()).subarray(0, 15).toString()).toBe('SQLite format 3');
	});

	test('cannot be fetched with a link, from another site, or without signing in', async ({
		page,
		baseURL,
		playwright
	}) => {
		// Not with a plain link (GET).
		expect((await page.request.get('/parent/settings/backup')).status()).toBe(405);

		// Not by a form on another site, even with the parent's cookies.
		const cross = await page.request.post('/parent/settings/backup', {
			headers: { ...form, origin: 'https://evil.example' },
			data: ''
		});
		expect(cross.status()).toBe(403);

		// Not without being signed in.
		const stranger = await playwright.request.newContext({ baseURL });
		const anonymous = await stranger.post('/parent/settings/backup', {
			headers: { ...form, origin: baseURL! },
			data: '',
			maxRedirects: 0
		});
		expect(anonymous.status()).toBe(303);
		expect(anonymous.headers()['location']).toBe('/parent/login');
		await stranger.dispose();
	});

	test('the account page lists the copies the app has saved', async ({ page }) => {
		mkdirSync(BACKUPS, { recursive: true });
		for (const name of readdirSync(BACKUPS)) {
			if (name.startsWith('nightly-2026010')) writeFileSync(path.join(BACKUPS, name), '');
		}
		withDb((db) => {
			const file = path.resolve(BACKUPS, 'nightly-20260102-030405.db');
			if (!existsSync(file)) db.exec(`VACUUM INTO '${file}'`);
		});
		writeFileSync(path.join(BACKUPS, 'not-a-backup.txt'), 'hello');

		await page.goto('/parent/settings');
		const table = page.getByRole('group', { name: 'Saved backups' });
		await expect(table.getByRole('row', { name: /Jan [12], 2026/ })).toContainText('Daily');
		await expect(table.getByRole('row', { name: /Jan [12], 2026/ })).toContainText('KB');
		await expect(table).not.toContainText('not-a-backup');
	});
});

test.describe('accessibility of the word pages', () => {
	test.use({ reducedMotion: 'reduce' });

	for (const theme of ['light', 'dark'] as const) {
		test(`no axe violations in the ${theme} theme`, async ({ page, context, baseURL }) => {
			await context.addCookies([{ name: 'theme', value: theme, url: baseURL! }]);
			withDb((db) => db.exec("update word_list set active = 0 where name = 'Grade 6'"));

			await page.goto('/parent/words');
			await expectAccessible(page);

			await page.goto(`/parent/words/${listId('Grade 3')}`);
			await page.getByRole('button', { name: 'Switch off enormous' }).click();
			await expect(page.getByRole('button', { name: 'Switch on enormous' })).toBeVisible();
			await expectAccessible(page);

			await makeList(page, 'School week 12');
			await expectAccessible(page); // empty list, paste box

			await page.getByLabel('Words to add').fill('quokka, zesty, ice cream');
			await page.getByRole('button', { name: 'Next: fill in meanings' }).click();
			await expect(draft(page, 'quokka')).toBeVisible();
			await expectAccessible(page); // blank entries

			await fillDraft(page, 'quokka', quokka);
			await fillDraft(page, 'zesty', { ...zesty, meaning: 'zesty', sentence: 'No.' });
			await page.getByRole('button', { name: 'Save 2 words' }).click();
			await expect(page.getByRole('alert')).toBeVisible();
			await expectAccessible(page); // entries with problems

			await fillDraft(page, 'zesty', zesty);
			await page.getByRole('button', { name: 'Save 2 words' }).click();
			await expect(page.getByRole('status')).toBeVisible();
			await expectAccessible(page); // list with words

			await page.waitForLoadState('networkidle');
			await page.getByRole('button', { name: 'Delete list' }).click();
			await expect(page.getByRole('dialog')).toBeVisible();
			await expectAccessible(page);
			await page.getByRole('button', { name: 'Cancel' }).click();

			await page.getByRole('link', { name: 'quokka' }).click();
			await expect(page.getByRole('heading', { level: 1, name: 'quokka' })).toBeVisible();
			await expectAccessible(page);

			await page.goto('/parent/settings');
			await expectAccessible(page); // with the backups section
		});
	}

	test('the word pages hold at 360px wide', async ({ page }) => {
		await page.setViewportSize({ width: 360, height: 800 });
		await makeList(page, 'A rather long name for a list of words');
		await page.getByLabel('Words to add').fill('quokka');
		await page.getByRole('button', { name: 'Next: fill in meanings' }).click();
		await expect(draft(page, 'quokka')).toBeVisible();

		const overflow = () =>
			page.evaluate(
				() => document.documentElement.scrollWidth - document.documentElement.clientWidth
			);
		expect(await overflow(), 'entries').toBeLessThanOrEqual(0);
		for (const route of [
			'/parent/words',
			`/parent/words/${listId('Grade 3')}`,
			'/parent/settings'
		]) {
			await page.goto(route);
			expect(await overflow(), route).toBeLessThanOrEqual(0);
		}
	});
});
