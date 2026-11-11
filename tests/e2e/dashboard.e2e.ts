import { expect, test, type Page } from '@playwright/test';
import {
	createChild,
	enterAs,
	expectAccessible,
	fillSignIn,
	FORMULA_ANSWER,
	knowWords,
	NASTY_ANSWER,
	resetAccounts,
	seedPractice,
	setUpParent,
	withDb,
	type SeededPractice
} from './helpers.ts';

const form = { 'content-type': 'application/x-www-form-urlencoded', accept: 'text/html' };

const count = (table: string) =>
	withDb((db) => (db.prepare(`select count(*) as n from ${table}`).get() as { n: number }).n);

let sam: number;
let seeded: SeededPractice;

test.beforeEach(async ({ page }) => {
	resetAccounts();
	sam = createChild('Sam');
	seeded = seedPractice(sam);
	await setUpParent(page);
});

/** The box of a headline figure, found by its label. */
const stat = (page: Page, label: string) =>
	page.locator('.stats > div').filter({ has: page.getByText(label, { exact: true }) });

test.describe('children list', () => {
	test('shows when each child last practiced and links to their progress', async ({ page }) => {
		createChild('Mia');
		await page.goto('/parent');

		const samCard = page.getByRole('listitem').filter({ hasText: 'Sam' });
		await expect(samCard).toContainText('last practiced');
		// Yesterday only: one day is not yet a streak worth mentioning.
		await expect(samCard).not.toContainText('in a row');
		await expect(page.getByRole('listitem').filter({ hasText: 'Mia' })).toContainText(
			'has not practiced yet'
		);

		await page.getByRole('link', { name: 'Progress for Sam' }).click();
		await expect(page.getByRole('heading', { level: 1, name: 'Progress for Sam' })).toBeVisible();
	});
});

test.describe('progress', () => {
	test('a child who has not practiced gets a plain message, not empty charts', async ({ page }) => {
		const mia = createChild('Mia');
		await page.goto(`/parent/children/${mia}/progress`);
		await expect(page.getByText('Mia has not practiced yet.')).toBeVisible();
		await expect(page.getByRole('img')).toHaveCount(0);

		await page.getByRole('link', { name: 'Sessions', exact: true }).click();
		await expect(page.getByText('Mia has not practiced yet.')).toBeVisible();
		await page.getByRole('link', { name: 'Words', exact: true }).click();
		await expect(page.getByText('Mia has not been asked any words yet.')).toBeVisible();
	});

	test('shows the headline figures for the last 7 days', async ({ page }) => {
		await page.goto(`/parent/children/${sam}/progress`);

		// First attempts: ✓✗✓, ✓✗✓, ✗ = 4 of 7. See seedPractice.
		await expect(stat(page, 'Right first time')).toContainText('57%');
		await expect(stat(page, 'Right first time')).toContainText('4 of 7 questions');
		await expect(stat(page, 'Time practiced')).toContainText('8 min');
		await expect(stat(page, 'Days practiced')).toContainText('2');
		await expect(stat(page, 'Sessions finished')).toContainText('2 of 3');
		await expect(stat(page, 'Sessions finished')).toContainText('1 stopped early');
	});

	test('names the trouble words and what they were mixed up with', async ({ page }) => {
		const [, b, c, , e] = seeded.words;
		await page.goto(`/parent/children/${sam}/progress`);

		const rows = page.getByRole('group', { name: 'Trouble words' }).getByRole('row');
		await expect(rows).toHaveCount(3); // the heading row, and two words
		// E was wrong both times it was asked; B was wrong 2 times out of 3.
		await expect(rows.nth(1)).toContainText(e.word);
		await expect(rows.nth(1)).toContainText('2 of 2');
		await expect(rows.nth(2)).toContainText(b.word);
		await expect(rows.nth(2)).toContainText('2 of 3');
		// The wrong answer was C's definition; the page names the word instead.
		await expect(rows.nth(2)).toContainText(`${c.word} (2 times)`);
	});

	test('breaks results down by kind of question', async ({ page }) => {
		await page.goto(`/parent/children/${sam}/progress`);
		const table = page.getByRole('group', { name: 'Results by kind of question' });

		await expect(table.getByRole('row', { name: /Pick the meaning/ })).toContainText('3 of 5');
		await expect(table.getByRole('row', { name: /Pick the word/ })).toContainText('1 of 1');
		await expect(table.getByRole('row', { name: /Fill in the blank/ })).toContainText('Not asked');
		await expect(table.getByRole('row', { name: /Spell the word/ })).toContainText('0 of 1');
		await expect(table.getByRole('row', { name: /Spell the word/ })).toContainText('4.0 sec');
	});

	test('shows where the words stand', async ({ page }) => {
		await page.goto(`/parent/children/${sam}/progress`);
		const words = page
			.locator('section.panel')
			.filter({ has: page.getByRole('heading', { name: 'Words', exact: true }) });
		await expect(words.getByText('Grade 3: 0% of 120 words well known')).toBeVisible();
		await expect(words.getByRole('listitem').filter({ hasText: 'Learning' })).toContainText('5');
		await expect(words.getByRole('listitem').filter({ hasText: 'Not started' })).toContainText(
			'115'
		);
	});

	test('the period switch changes every figure, and remembers itself in the address', async ({
		page
	}) => {
		// A session from 20 days ago: outside 7 days, inside 30.
		withDb((db) =>
			db
				.prepare(
					`insert into practice_session (child_id, started_at, ended_at, active_ms, completed, plan_json)
					 values (?, ?, ?, 600000, 1, '[]')`
				)
				.run(sam, Date.now() - 20 * 86_400_000, Date.now() - 20 * 86_400_000 + 600_000)
		);

		await page.goto(`/parent/children/${sam}/progress`);
		const period = page.getByRole('navigation', { name: 'Period' });
		await expect(period.getByRole('link', { name: 'Last 7 days' })).toHaveAttribute(
			'aria-current',
			'true'
		);
		await expect(stat(page, 'Time practiced')).toContainText('8 min');

		await period.getByRole('link', { name: 'Last 30 days' }).click();
		await expect(page).toHaveURL(/range=30d$/);
		await expect(period.getByRole('link', { name: 'Last 30 days' })).toHaveAttribute(
			'aria-current',
			'true'
		);
		await expect(stat(page, 'Time practiced')).toContainText('18 min');
		await expect(stat(page, 'Sessions finished')).toContainText('3 of 4');

		await period.getByRole('link', { name: 'All time' }).click();
		await expect(page).toHaveURL(/range=all$/);
		await expect(stat(page, 'Days practiced')).toContainText('3');

		// Anything else in the address falls back to 7 days.
		await page.goto(`/parent/children/${sam}/progress?range=<script>`);
		await expect(stat(page, 'Time practiced')).toContainText('8 min');
	});

	test('each chart is a named picture with the same numbers in a table', async ({ page }) => {
		await page.goto(`/parent/children/${sam}/progress`);

		for (const title of ['Right first time', 'Time practiced']) {
			await expect(page.getByRole('img', { name: new RegExp(`^${title}`) })).toBeVisible();
		}

		const panel = page
			.locator('section.panel')
			.filter({ has: page.getByRole('heading', { name: /^Time practiced/ }) });
		await expect(panel.getByRole('table')).toBeHidden();
		await panel.getByText('Show as a table').click();
		const rows = panel.getByRole('table').getByRole('row');
		await expect(rows).toHaveCount(8); // the heading row, and seven days
		await expect(rows.last()).toContainText('1 min'); // today
		await expect(rows.nth(6)).toContainText('3 min'); // yesterday
		await expect(rows.nth(5)).toContainText('No practice');
	});

	test('pointing at the chart reads out that day', async ({ page }) => {
		await page.goto(`/parent/children/${sam}/progress`);
		const panel = page
			.locator('section.panel')
			.filter({ has: page.getByRole('heading', { name: /^Time practiced/ }) });
		const readout = panel.locator('.readout');
		await expect(readout).toContainText('1 min');
		await expect(readout).toContainText('(most recent)');

		// The second strip from the right is yesterday.
		const strips = panel.locator('rect.hit');
		await expect(strips).toHaveCount(7);
		await strips.nth(5).hover();
		await expect(readout).toContainText('3 min');
		await expect(readout).not.toContainText('(most recent)');
	});

	test('works without JavaScript', async ({ browser }) => {
		const context = await browser.newContext({ javaScriptEnabled: false });
		const page = await context.newPage();
		await fillSignIn(page);

		await page.goto(`/parent/children/${sam}/progress`);
		await expect(stat(page, 'Right first time')).toContainText('4 of 7 questions');
		await page.getByRole('link', { name: 'All time' }).click();
		await expect(page).toHaveURL(/range=all$/);
		await expect(page.getByRole('img', { name: /^Right first time/ })).toBeVisible();
		await context.close();
	});
});

test.describe('moving up a grade', () => {
	test('is offered at 80% and moves the child up when the parent agrees', async ({ page }) => {
		knowWords(sam, 3, 95); // 95 of 120 is just under 80%
		await page.goto(`/parent/children/${sam}/progress`);
		await expect(page.getByRole('button', { name: /Move up/ })).toHaveCount(0);

		knowWords(sam, 3, 96); // exactly 80%
		await page.reload();
		await page.getByRole('button', { name: 'Move up to grade 4' }).click();
		await expect(page.getByRole('status')).toHaveText('Sam is now on grade 4 words.');
		expect(withDb((db) => db.prepare('select grade from child where id = ?').get(sam))).toEqual({
			grade: 4
		});
		// Grade 4 has no progress yet, so the offer is gone.
		await page.reload();
		await expect(page.getByRole('button', { name: /Move up/ })).toHaveCount(0);
		await expect(page.getByText('Grade 4: 0% of 120 words well known')).toBeVisible();
	});

	test('cannot be forced before the grade is known well enough', async ({ page, baseURL }) => {
		const response = await page.request.post(`/parent/children/${sam}/progress?/moveUp`, {
			headers: { ...form, origin: baseURL! },
			data: ''
		});
		expect(response.status()).toBe(400);
		expect(withDb((db) => db.prepare('select grade from child where id = ?').get(sam))).toEqual({
			grade: 3
		});
	});

	test('stops at the last grade', async ({ page }) => {
		const { last } = withDb(
			(db) =>
				db.prepare("select max(grade) as last from word_list where source = 'builtin'").get() as {
					last: number;
				}
		);
		withDb((db) => db.prepare('update child set grade = ? where id = ?').run(last, sam));
		knowWords(sam, last, 120);

		await page.goto(`/parent/children/${sam}/progress`);
		await expect(
			page.getByText(`Sam knows most of the grade ${last} words, the last grade there is.`)
		).toBeVisible();
		await expect(page.getByRole('button', { name: /Move up/ })).toHaveCount(0);
	});
});

test.describe('sessions', () => {
	test('lists sessions newest first and opens one', async ({ page }) => {
		const [a, b, c] = seeded.words;
		await page.goto(`/parent/children/${sam}/sessions`);

		const rows = page.getByRole('group', { name: 'Sessions' }).getByRole('row');
		await expect(rows).toHaveCount(4);
		await expect(rows.nth(1)).toContainText('0 of 2');
		await expect(rows.nth(1)).toContainText('Stopped early');
		await expect(rows.nth(2)).toContainText('2 of 3');
		await expect(rows.nth(3)).toContainText('3 of 4');
		await expect(rows.nth(3)).toContainText('4 min');
		await expect(rows.nth(3)).toContainText('Finished');

		await rows.nth(3).getByRole('link').click();
		await expect(page).toHaveURL(new RegExp(`/sessions/${seeded.sessions[0]}$`));
		await expect(page.getByRole('heading', { level: 1 })).toContainText('Session on');

		const questions = page.getByRole('group', { name: 'Questions in this session' });
		const asked = questions.getByRole('row');
		await expect(asked).toHaveCount(5);
		await expect(asked.nth(1)).toContainText(a.word);
		await expect(asked.nth(1)).toContainText('✓ Right');
		await expect(asked.nth(2)).toContainText('✗ Wrong');
		await expect(asked.nth(2)).toContainText(c.definition); // what was picked
		await expect(asked.nth(2)).toContainText(`right answer: ${b.definition}`);
		await expect(asked.nth(4)).toContainText('(asked again)');
	});

	test('a word in a session leads to every answer for that word', async ({ page }) => {
		const b = seeded.words[1];
		await page.goto(`/parent/children/${sam}/sessions/${seeded.sessions[0]}`);
		await page.getByRole('link', { name: b.word, exact: true }).first().click();

		await expect(page.getByRole('heading', { level: 1, name: b.word })).toBeVisible();
		await expect(page.getByText(b.definition).first()).toBeVisible();
		await expect(stat(page, 'Right')).toContainText('1 of 3');
		await expect(stat(page, 'Stage')).toContainText('stage 1 of 5');

		const rows = page.getByRole('group', { name: 'Every answer for this word' }).getByRole('row');
		await expect(rows).toHaveCount(4);
		// Newest first: yesterday's miss, then the retry and the miss of three days ago.
		await expect(rows.nth(1)).toContainText('✗ Wrong');
		await expect(rows.nth(2)).toContainText('✓ Right');
		await expect(rows.nth(3)).toContainText('✗ Wrong');

		// And back to the session an answer was given in.
		await rows.nth(1).getByRole('link').click();
		await expect(page).toHaveURL(new RegExp(`/sessions/${seeded.sessions[1]}$`));
	});

	test('the words page lists every word met, least settled first', async ({ page }) => {
		await page.goto(`/parent/children/${sam}/words`);
		const rows = page.getByRole('group', { name: 'Words' }).getByRole('row');
		await expect(rows).toHaveCount(6);
		await expect(rows.nth(1)).toContainText('Learning (1 of 5)');
		await expect(rows.last()).toContainText(seeded.words[0].word); // box 3
		await expect(rows.last()).toContainText('2 of 2');
	});

	test('deletes a session after asking, and the figures follow', async ({ page }) => {
		await page.goto(`/parent/children/${sam}/sessions/${seeded.sessions[2]}`);
		await page.waitForLoadState('networkidle');

		await page.getByRole('button', { name: 'Delete session' }).click();
		await expect(page.getByRole('dialog', { name: 'Delete this session?' })).toBeVisible();
		await page.getByRole('button', { name: 'Cancel' }).click();
		expect(count('practice_session')).toBe(3);

		await page.getByRole('button', { name: 'Delete session' }).click();
		await page.getByRole('button', { name: 'Yes, delete' }).click();
		await expect(page).toHaveURL(new RegExp(`/children/${sam}/sessions$`));
		await expect(page.getByRole('group', { name: 'Sessions' }).getByRole('row')).toHaveCount(3);
		expect(count('practice_session')).toBe(2);
		expect(count('question')).toBe(7);
		expect(count('answer')).toBe(7);
		// The stages the words reached are kept.
		expect(count('word_progress')).toBe(5);

		await page.goto(`/parent/children/${sam}/progress`);
		await expect(stat(page, 'Right first time')).toContainText('4 of 6 questions');
		await expect(stat(page, 'Sessions finished')).toContainText('2 of 2');
	});

	test('deleting works without JavaScript', async ({ browser }) => {
		const context = await browser.newContext({ javaScriptEnabled: false });
		const page = await context.newPage();
		await fillSignIn(page);

		await page.goto(`/parent/children/${sam}/sessions/${seeded.sessions[2]}`);
		await page.getByRole('button', { name: 'Delete session' }).click();
		await expect(page).toHaveURL(new RegExp(`/children/${sam}/sessions$`));
		expect(count('practice_session')).toBe(2);
		await context.close();
	});

	test('the log is split into pages', async ({ page }) => {
		withDb((db) => {
			const add = db.prepare(
				`insert into practice_session (child_id, started_at, ended_at, completed, plan_json)
				 values (?, ?, ?, 1, '[]')`
			);
			for (let index = 0; index < 30; index++) {
				const at = Date.now() - (10 + index) * 86_400_000;
				add.run(sam, at, at);
			}
		});

		await page.goto(`/parent/children/${sam}/sessions`);
		const rows = page.getByRole('group', { name: 'Sessions' }).getByRole('row');
		await expect(rows).toHaveCount(26);
		await expect(page.getByText('Page 1 of 2')).toBeVisible();
		await expect(page.getByRole('link', { name: '← Newer' })).toHaveCount(0);

		await page.getByRole('link', { name: 'Older →' }).click();
		await expect(page).toHaveURL(/page=2$/);
		await expect(rows).toHaveCount(9);

		// A page that does not exist, or is not a number, is not an error.
		for (const bad of ['99', '0', '-1', 'abc']) {
			const response = await page.goto(`/parent/children/${sam}/sessions?page=${bad}`);
			expect(response!.status(), bad).toBe(200);
		}
	});
});

test.describe('one child, one history', () => {
	let mia: number;
	let miaSession: number;

	test.beforeEach(() => {
		mia = createChild('Mia');
		miaSession = seedPractice(mia).sessions[0];
	});

	test("a session cannot be opened under another child's address", async ({ page }) => {
		expect((await page.goto(`/parent/children/${mia}/sessions/${miaSession}`))!.status()).toBe(200);
		expect((await page.goto(`/parent/children/${sam}/sessions/${miaSession}`))!.status()).toBe(404);
	});

	test("a session cannot be deleted through another child's address", async ({ page, baseURL }) => {
		const response = await page.request.post(
			`/parent/children/${sam}/sessions/${miaSession}?/delete`,
			{ headers: { ...form, origin: baseURL! }, data: '' }
		);
		expect(response.status()).toBe(404);
		expect(count('practice_session')).toBe(6);
	});

	test('pages for things that do not exist are 404s, not errors', async ({ page }) => {
		for (const path of [
			'/parent/children/99999/progress',
			'/parent/children/99999/sessions',
			'/parent/children/99999/words',
			'/parent/children/99999/export.csv',
			`/parent/children/${sam}/sessions/99999`,
			`/parent/children/${sam}/sessions/abc`,
			`/parent/children/${sam}/words/99999`,
			`/parent/children/${sam}/words/1%20or%201=1`
		]) {
			const response = await page.request.get(path);
			expect(response.status(), path).toBe(404);
		}
	});

	test('a signed-in child cannot read any of it', async ({ browser }) => {
		const context = await browser.newContext();
		const page = await context.newPage();
		await enterAs(page, 'Sam');
		await expect(page.getByRole('heading', { level: 1, name: 'Hi, Sam!' })).toBeVisible();

		for (const path of [
			`/parent/children/${sam}/progress`,
			`/parent/children/${sam}/sessions`,
			`/parent/children/${sam}/sessions/${seeded.sessions[0]}`,
			`/parent/children/${sam}/words`,
			`/parent/children/${sam}/export.csv`
		]) {
			const response = await page.request.get(path, { maxRedirects: 0 });
			expect(response.status(), path).toBe(303);
			expect(response.headers()['location'], path).toBe('/parent/login');
		}
		await context.close();
	});
});

test.describe('what a child typed is only ever shown as text', () => {
	test('on the session, word and progress pages', async ({ page }) => {
		const e = seeded.words[4];
		const dialogs: string[] = [];
		page.on('dialog', (dialog) => {
			dialogs.push(dialog.message());
			void dialog.dismiss();
		});

		for (const path of [
			`/parent/children/${sam}/sessions/${seeded.sessions[2]}`,
			`/parent/children/${sam}/words/${e.id}`,
			`/parent/children/${sam}/progress`
		]) {
			await page.goto(path);
			await expect(page.getByText(NASTY_ANSWER).first(), path).toBeVisible();
			await expect(page.locator('img[src="x"]'), path).toHaveCount(0);
			await expect(page, path).not.toHaveTitle('pwned');
		}
		expect(dialogs).toEqual([]);
	});
});

test.describe('export', () => {
	test('downloads every answer as a CSV file that is never cached', async ({ page }) => {
		const response = await page.request.get(`/parent/children/${sam}/export.csv`);
		expect(response.status()).toBe(200);

		const headers = response.headers();
		expect(headers['content-type']).toBe('text/csv; charset=utf-8');
		expect(headers['content-disposition']).toMatch(
			new RegExp(`^attachment; filename="vocab-answers-${sam}-\\d{4}-\\d{2}-\\d{2}\\.csv"$`)
		);
		expect(headers['cache-control']).toContain('no-store');
		expect(headers['x-content-type-options']).toBe('nosniff');

		const lines = (await response.text())
			.replace(String.fromCharCode(0xfeff), '')
			.trimEnd()
			.split('\r\n');
		expect(lines).toHaveLength(10); // the heading line and nine answers
		expect(lines[0]).toMatch(/^answered_at_utc,local_date,session,word,grade,question_type,/);
		const [a] = seeded.words;
		expect(lines[1]).toContain(`,${a.word},3,word_to_def,yes,`);
	});

	test('text typed by a child cannot run as a spreadsheet formula', async ({ page }) => {
		const text = await (await page.request.get(`/parent/children/${sam}/export.csv`)).text();
		// The formula is kept as text: a leading apostrophe, inside quotes, quotes doubled.
		expect(text).toContain(`,"'${FORMULA_ANSWER.replaceAll('"', '""')}",`);
		expect(text).not.toMatch(/(^|,)"?=/m);
	});

	test('the progress page links to it', async ({ page }) => {
		await page.goto(`/parent/children/${sam}/progress`);
		const [download] = await Promise.all([
			page.waitForEvent('download'),
			page.getByRole('link', { name: /Download every answer/ }).click()
		]);
		expect(download.suggestedFilename()).toMatch(/^vocab-answers-\d+-\d{4}-\d{2}-\d{2}\.csv$/);
	});

	test("holds only that child's answers", async ({ page }) => {
		const mia = createChild('Mia');
		const text = await (await page.request.get(`/parent/children/${mia}/export.csv`)).text();
		expect(text.trimEnd().split('\r\n')).toHaveLength(1);
	});
});

test.describe('accessibility of the dashboard', () => {
	test.use({ reducedMotion: 'reduce' });

	for (const theme of ['light', 'dark'] as const) {
		test(`no axe violations in the ${theme} theme`, async ({ page, context, baseURL }) => {
			await context.addCookies([{ name: 'theme', value: theme, url: baseURL! }]);
			const mia = createChild('Mia');
			knowWords(sam, 3, 100); // so the "move up" offer and a fuller status bar show

			await page.goto('/parent');
			await expectAccessible(page);

			await page.goto(`/parent/children/${mia}/progress`);
			await expectAccessible(page); // nothing practiced yet

			await page.goto(`/parent/children/${sam}/progress`);
			await expect(page.getByRole('button', { name: 'Move up to grade 4' })).toBeVisible();
			await expectAccessible(page);
			for (const summary of await page.getByText('Show as a table').all()) await summary.click();
			await expectAccessible(page); // with both tables open

			await page.goto(`/parent/children/${sam}/progress?range=all`);
			await expectAccessible(page);

			await page.goto(`/parent/children/${sam}/sessions`);
			await expectAccessible(page);

			await page.goto(`/parent/children/${sam}/sessions/${seeded.sessions[0]}`);
			await expectAccessible(page);
			await page.waitForLoadState('networkidle');
			await page.getByRole('button', { name: 'Delete session' }).click();
			await expect(page.getByRole('dialog')).toBeVisible();
			await expectAccessible(page);

			await page.goto(`/parent/children/${sam}/words`);
			await expectAccessible(page);

			await page.goto(`/parent/children/${sam}/words/${seeded.words[1].id}`);
			await expectAccessible(page);

			await page.goto(`/parent/children/${sam}`);
			await expectAccessible(page); // settings, now under the tabs
		});
	}

	for (const theme of ['light', 'dark'] as const) {
		// axe cannot measure text inside an SVG, so this ties the chart's labels to text it
		// can measure: the muted note under the same chart, on the same background.
		test(`chart labels are the color of the muted text beside them (${theme})`, async ({
			page,
			context,
			baseURL
		}) => {
			await context.addCookies([{ name: 'theme', value: theme, url: baseURL! }]);
			await page.goto(`/parent/children/${sam}/progress`);

			const colors = await page.evaluate(() =>
				[...document.querySelectorAll('.chart')].map((chart) => ({
					labels: [...chart.querySelectorAll('svg text')].map(
						(label) => getComputedStyle(label).fill
					),
					note: getComputedStyle(chart.querySelector('.readout .muted')!).color
				}))
			);
			expect(colors).toHaveLength(2);
			for (const chart of colors) {
				expect(chart.labels.length).toBeGreaterThan(3);
				expect(new Set(chart.labels)).toEqual(new Set([chart.note]));
			}
		});
	}

	test('the dashboard pages hold at 360px wide', async ({ page }) => {
		await page.setViewportSize({ width: 360, height: 800 });
		for (const route of [
			'/parent',
			`/parent/children/${sam}/progress`,
			`/parent/children/${sam}/progress?range=all`,
			`/parent/children/${sam}/sessions`,
			`/parent/children/${sam}/sessions/${seeded.sessions[0]}`,
			`/parent/children/${sam}/words`,
			`/parent/children/${sam}/words/${seeded.words[1].id}`,
			`/parent/children/${sam}`
		]) {
			await page.goto(route);
			const overflow = await page.evaluate(
				() => document.documentElement.scrollWidth - document.documentElement.clientWidth
			);
			expect(overflow, route).toBeLessThanOrEqual(0);
		}
	});

	test('the tabs mark the page you are on', async ({ page }) => {
		await page.goto(`/parent/children/${sam}/sessions/${seeded.sessions[0]}`);
		const tabs = page.getByRole('navigation', { name: 'Sam' });
		await expect(tabs.getByRole('link', { name: 'Sessions' })).toHaveAttribute(
			'aria-current',
			'page'
		);
		await expect(tabs.getByRole('link', { name: 'Settings' })).not.toHaveAttribute(
			'aria-current',
			'page'
		);
		await tabs.getByRole('link', { name: 'Settings' }).click();
		await expect(page.getByRole('heading', { level: 1, name: 'Settings for Sam' })).toBeVisible();
		await expect(tabs.getByRole('link', { name: 'Settings' })).toHaveAttribute(
			'aria-current',
			'page'
		);
	});
});
