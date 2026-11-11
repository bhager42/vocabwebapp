import { expect, test, type Page } from '@playwright/test';
import {
	answerCurrent,
	createChild,
	enterAs,
	expectAccessible,
	nextButton,
	pendingQuestion,
	placeWords,
	resetAccounts,
	withDb
} from './helpers.ts';

const UNKNOWN = "Hmm, I don't know that name yet. Ask a grown-up to add you.";
const form = { 'content-type': 'application/x-www-form-urlencoded', accept: 'text/html' };

const count = (table: string) =>
	withDb((db) => (db.prepare(`select count(*) as n from ${table}`).get() as { n: number }).n);

const startButton = (page: Page) =>
	page.getByRole('button', { name: /^(Start practicing|Keep going)$/ });

/** Signs a child in and starts a session. */
async function begin(page: Page, name = 'Sam') {
	await enterAs(page, name);
	await startButton(page).click();
	await expect(page).toHaveURL(/\/play$/);
}

/** Answers every remaining question correctly and returns how many were asked. */
async function finishSession(page: Page): Promise<number> {
	let asked = 0;
	for (;;) {
		await answerCurrent(page);
		asked++;
		const last = (await nextButton(page).textContent())?.trim() === 'See how you did';
		await nextButton(page).click();
		if (last) break;
	}
	await expect(page).toHaveURL(/\/play\/done$/);
	return asked;
}

test.beforeEach(() => resetAccounts());

test.describe('typing a name', () => {
	test.beforeEach(() => {
		createChild('Sam');
	});

	test('a known name is greeted and offered practice', async ({ page, context }) => {
		await enterAs(page, 'Sam');

		await expect(page.getByRole('heading', { level: 1, name: 'Hi, Sam!' })).toBeVisible();
		await expect(page.getByRole('button', { name: 'Start practicing' })).toBeVisible();

		const cookie = (await context.cookies()).find((entry) => entry.name === 'vocab_child')!;
		expect(cookie).toMatchObject({ httpOnly: true, sameSite: 'Strict', path: '/' });
		// Lasts 30 days, so the child is not asked again on their usual device.
		const days = (cookie.expires * 1000 - Date.now()) / (24 * 60 * 60 * 1000);
		expect(days).toBeGreaterThan(29.9);
		expect(days).toBeLessThan(30.1);
	});

	test('capitals and extra spaces do not matter', async ({ page }) => {
		await enterAs(page, '  sAM ');
		await expect(page.getByRole('heading', { name: 'Hi, Sam!' })).toBeVisible();
	});

	test('an unknown name is turned away kindly and creates nothing', async ({ page, context }) => {
		await enterAs(page, 'Samm');

		await expect(page.getByText(UNKNOWN)).toBeVisible();
		await expect(page.getByLabel('Your first name')).toHaveValue('Samm');
		expect(count('child')).toBe(1);
		expect((await context.cookies()).some((entry) => entry.name === 'vocab_child')).toBe(false);
		// The page never says which names do exist.
		await expect(page.locator('body')).not.toContainText('Sam!');
	});

	test('an archived child gets the same answer as an unknown name', async ({ page }) => {
		withDb((db) => db.prepare('update child set archived_at = ?').run(Date.now()));

		await enterAs(page, 'Sam');

		await expect(page.getByText(UNKNOWN)).toBeVisible();
	});

	test('the child is still known after closing and reopening the page', async ({ page }) => {
		await enterAs(page, 'Sam');
		await expect(page.getByRole('heading', { name: 'Hi, Sam!' })).toBeVisible();

		await page.goto('/styleguide');
		await page.goto('/');

		await expect(page.getByRole('heading', { name: 'Hi, Sam!' })).toBeVisible();
	});

	test('"Switch" forgets the child on this device', async ({ page }) => {
		await enterAs(page, 'Sam');
		await page.getByRole('button', { name: 'Switch' }).click();

		await expect(page.getByRole('heading', { name: "What's your name?" })).toBeVisible();
		expect(count('auth_session')).toBe(0);
	});

	test('twenty wrong names in a row means a wait', async ({ request, baseURL }) => {
		const guess = (name: string) =>
			request.post('/?/enter', {
				headers: { ...form, origin: baseURL! },
				data: `name=${name}`,
				maxRedirects: 0
			});

		for (let index = 0; index < 20; index++) {
			expect((await guess(`nobody${String.fromCharCode(97 + index)}`)).status()).toBe(400);
		}
		const refused = await guess('Sam');
		expect(refused.status()).toBe(429);
		expect(await refused.text()).toContain('That is a lot of tries!');

		// It does not get in the parent's way.
		const parentLogin = await request.post('/parent/login', {
			headers: { ...form, origin: baseURL! },
			data: 'username=x&password=y'
		});
		expect(parentLogin.status()).toBe(400);
	});
});

test.describe('a full session without JavaScript', () => {
	test.use({ javaScriptEnabled: false });

	test('ten questions, answered by plain form posts', async ({ page }) => {
		createChild('Sam');
		await begin(page);

		for (let number = 1; number <= 10; number++) {
			await expect(page.getByText(`Question ${number} of 10`)).toBeVisible();
			await expect(page.getByRole('progressbar')).toHaveAttribute('value', String(number));
			await answerCurrent(page);
			await expect(page).toHaveURL(/\/play$/); // a redirect, so reloading cannot re-submit
			await nextButton(page).click();
		}

		await expect(page).toHaveURL(/\/play\/done$/);
		await expect(page.getByRole('heading', { name: 'Great work, Sam!' })).toBeVisible();
		await expect(page.getByText('You earned 10 stars: you got 10 out of 10 right.')).toBeVisible();
		await expect(page.getByText('You met 4 new words today.')).toBeVisible();
		// Nothing can speak without JavaScript, so no speak buttons are offered.
		await expect(page.getByRole('button', { name: /^Hear/ })).toHaveCount(0);

		// What was written down.
		const session = withDb((db) => db.prepare('select * from practice_session').get()) as {
			completed: number;
			question_count: number;
			ended_at: number;
			active_ms: number;
		};
		expect(session).toMatchObject({ completed: 1, question_count: 10 });
		expect(session.ended_at).toBeGreaterThan(0);
		expect(session.active_ms).toBeGreaterThan(0);
		expect(count('question')).toBe(10);
		expect(count('answer')).toBe(10);

		const progress = withDb((db) => db.prepare('select box, due_at from word_progress').all()) as {
			box: number;
			due_at: number;
		}[];
		expect(progress.map((row) => row.box)).toEqual([2, 2, 2, 2]);
		for (const row of progress) {
			// Due at the start of tomorrow, local time.
			const due = new Date(row.due_at);
			expect(due.getTime()).toBeGreaterThan(Date.now());
			expect(due.getTime()).toBeLessThanOrEqual(Date.now() + 24 * 60 * 60 * 1000);
			expect([due.getHours(), due.getMinutes(), due.getSeconds()]).toEqual([0, 0, 0]);
		}
	});
});

test.describe('a full session with JavaScript', () => {
	test.beforeEach(() => {
		createChild('Sam');
	});

	test('ten questions, a miss, a retry and the summary', async ({ page }) => {
		let pageLoads = 0;
		page.on('load', () => pageLoads++);
		await begin(page);
		await page.waitForLoadState('networkidle');
		const loadsAtStart = pageLoads;

		// Question 1, right: the choices are marked and the word is explained.
		const first = await answerCurrent(page);
		await expect(page.getByRole('status')).toContainText(
			`${first.word} means ${first.definition}.`
		);
		await expect(page.getByRole('status')).toContainText(first.sentence);
		await expect(page.getByText('Correct answer')).toHaveCount(1);
		await expect(page.locator('button[name="choice"]')).toHaveCount(0);
		await expect(nextButton(page)).toBeFocused();
		await page.keyboard.press('Enter');

		// Question 2, wrong: both the pick and the right answer are shown.
		await expect(page.getByText('Question 2 of 10')).toBeVisible();
		await expect(page.getByRole('heading', { level: 1 })).toBeFocused();
		const second = await answerCurrent(page, false);
		await expect(page.getByRole('status')).toContainText('Not quite. Here is what it means.');
		await expect(page.getByRole('status')).toContainText(second.word);
		await expect(page.getByText('Your answer')).toHaveCount(1);
		await expect(page.getByText('Correct answer')).toHaveCount(1);
		await nextButton(page).click();

		// Question 3, by keyboard shortcut.
		await expect(page.getByText('Question 3 of 10')).toBeVisible();
		const third = pendingQuestion();
		await page.keyboard.press('ABCD'[third.choices.indexOf(third.correct)]);
		await expect(page.getByRole('heading', { level: 1, name: 'Correct' })).toBeAttached();
		await nextButton(page).click();

		for (let number = 4; number <= 9; number++) {
			await expect(page.getByText(`Question ${number} of 10`)).toBeVisible();
			await answerCurrent(page);
			await nextButton(page).click();
		}

		// Question 10 is this word's last look, so missing it adds one more question.
		await expect(page.getByText('Question 10 of 10')).toBeVisible();
		const tenth = await answerCurrent(page, false);
		await expect(page.getByText('Question 10 of 11')).toBeVisible();
		await expect(nextButton(page)).toHaveText('Next');
		await nextButton(page).click();

		await expect(page.getByText('Question 11 of 11')).toBeVisible();
		const retry = await answerCurrent(page);
		expect(retry.word).toBe(tenth.word);
		await expect(nextButton(page)).toHaveText('See how you did');
		await nextButton(page).click();

		await expect(page).toHaveURL(/\/play\/done$/);
		await expect(page.getByText('You earned 9 stars: you got 9 out of 11 right.')).toBeVisible();
		// The whole session ran without a single full page load.
		expect(pageLoads).toBe(loadsAtStart);

		const answers = withDb((db) =>
			db.prepare('select is_correct, is_retry, response_ms from answer order by question_id').all()
		) as { is_correct: number; is_retry: number; response_ms: number }[];
		expect(answers.map((row) => row.is_correct)).toEqual([1, 0, 1, 1, 1, 1, 1, 1, 1, 0, 1]);
		// Questions 5 to 11 are second and third looks at this session's words.
		expect(answers.map((row) => row.is_retry)).toEqual([0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1]);
		for (const row of answers) {
			expect(row.response_ms).toBeGreaterThan(0);
			expect(row.response_ms).toBeLessThan(10_000);
		}

		const boxes = withDb((db) =>
			db
				.prepare(
					'select w.word, p.box from word_progress p join word w on w.id = p.word_id order by w.word'
				)
				.all()
		) as { word: string; box: number }[];
		const boxOf = (name: string) => boxes.find((row) => row.word === name)!.box;
		expect(boxOf(first.word)).toBe(2);
		expect(boxOf(second.word)).toBe(1);
		expect(boxOf(tenth.word)).toBe(1);

		// And another session can be started straight away.
		await page.getByRole('button', { name: 'Practice some more' }).click();
		await expect(page).toHaveURL(/\/play$/);
		expect(count('practice_session')).toBe(2);
	});

	test('the answer is never sent before the child has answered', async ({ page }) => {
		// Keep every response body for the practice page, however it was fetched.
		const bodies: string[] = [];
		page.on('response', async (response) => {
			if (new URL(response.url()).pathname.startsWith('/play')) {
				bodies.push(await response.text().catch(() => ''));
			}
		});
		const seen = () => bodies.splice(0).join('\n');
		const places = new Set<number>();

		await begin(page);
		for (let number = 1; number <= 10; number++) {
			await expect(page.getByText(`Question ${number} of 10`)).toBeVisible();
			await page.waitForLoadState('networkidle');
			const current = pendingQuestion();
			const before = `${seen()}\n${await page.content()}`;

			// Nothing says which choice is right...
			expect(before).not.toMatch(/correct_?choice|is_?correct|"correct"|data-state/i);
			expect(before).not.toContain('Correct answer');
			// ...and nothing links the word to its meaning: the example sentence, which
			// uses the word in context, is held back until afterwards.
			expect(before).not.toContain(current.sentence);
			if (current.type === 'word_to_def') {
				expect(before).toContain(current.word);
				expect(before.split(current.definition).length).toBeGreaterThan(1);
			} else {
				expect(before).toContain(current.word); // one of four choices
			}
			places.add(current.choices.indexOf(current.correct));

			await answerCurrent(page);
			await page.waitForLoadState('networkidle');
			// Once answered, the explanation is there.
			expect(`${seen()}\n${await page.content()}`).toContain(current.sentence);
			await nextButton(page).click();
		}

		// The right answer moves around; it is not always in the same place.
		expect(places.size).toBeGreaterThan(1);
	});

	test('reads a word aloud', async ({ page }) => {
		await page.addInitScript(() => {
			const spoken: string[] = [];
			Object.assign(window, { __spoken: spoken });
			window.speechSynthesis.speak = (utterance) =>
				void spoken.push(`${utterance.lang}:${utterance.text}`);
			window.speechSynthesis.cancel = () => {};
		});
		await begin(page);
		const current = pendingQuestion();

		await page.getByRole('button', { name: `Hear “${current.word}”` }).click();

		expect(
			await page.evaluate(() => (window as unknown as { __spoken: string[] }).__spoken)
		).toEqual([`en-US:${current.word}`]);

		// It is offered again with the explanation.
		await answerCurrent(page);
		await expect(page.getByRole('button', { name: `Hear “${current.word}”` })).toBeVisible();
	});

	test('carries on where it left off after leaving and coming back', async ({ page }) => {
		await begin(page);
		await answerCurrent(page);
		await nextButton(page).click();
		await expect(page.getByText('Question 2 of 10')).toBeVisible();
		const waiting = pendingQuestion();

		await page.reload();
		await expect(page.getByText('Question 2 of 10')).toBeVisible();
		await expect(page.locator(`input[name="questionId"][value="${waiting.id}"]`)).toBeAttached();

		await page.goto('/');
		await page.getByRole('button', { name: 'Keep going' }).click();
		await expect(page.getByText('Question 2 of 10')).toBeVisible();
		expect(count('practice_session')).toBe(1);
		expect(count('question')).toBe(2);
	});

	test('reloading on the explanation does not skip or repeat anything', async ({ page }) => {
		await begin(page);
		await answerCurrent(page);

		await page.reload();
		await expect(page.getByRole('heading', { level: 1, name: 'Correct' })).toBeAttached();
		await page.goBack();
		await page.goto('/play');

		expect(count('answer')).toBe(1);
		expect(count('question')).toBe(1);
	});

	test('"Stop for now" asks first, then ends the session and keeps the answers', async ({
		page
	}) => {
		await begin(page);
		await answerCurrent(page);
		await nextButton(page).click();
		await page.waitForLoadState('networkidle');

		await page.getByRole('button', { name: 'Stop for now' }).click();
		const dialog = page.getByRole('dialog', { name: 'Stop for now?' });
		await dialog.getByRole('button', { name: 'Keep going' }).click();
		await expect(dialog).toBeHidden();
		await expect(page).toHaveURL(/\/play$/);

		await page.getByRole('button', { name: 'Stop for now' }).click();
		await dialog.getByRole('button', { name: 'Stop', exact: true }).click();

		await expect(page.getByRole('heading', { name: 'Hi, Sam!' })).toBeVisible();
		await expect(page.getByRole('button', { name: 'Start practicing' })).toBeVisible();
		expect(
			withDb((db) => db.prepare('select completed, question_count from practice_session').get())
		).toEqual({ completed: 0, question_count: 2 });
		expect(count('answer')).toBe(1);
	});
});

test.describe('kinds of question', () => {
	let samId: number;

	test.beforeEach(() => {
		samId = createChild('Sam');
		// Three words Sam already knows a little, so the harder kinds come up first.
		placeWords(samId, { timid: 3, fragile: 4, enormous: 5 });
	});

	test('"which word means this?" shows the definition and four words', async ({ page }) => {
		await begin(page);

		await expect(page.getByText('Which word means this?')).toBeVisible();
		await expect(
			page.getByRole('heading', { level: 1, name: 'shy and easily scared' })
		).toBeVisible();
		await expect(page.locator('button[name="choice"]')).toHaveCount(4);
		await expect(page.getByRole('button', { name: /^Hear/ })).toHaveCount(4);

		const asked = await answerCurrent(page);
		expect(asked).toMatchObject({ type: 'def_to_word', word: 'timid', correct: 'timid' });
	});

	test('fill-in-the-blank shows the sentence with the word taken out', async ({ page }) => {
		await begin(page);
		await answerCurrent(page);
		await nextButton(page).click();

		await expect(page.getByText('Which word fits in the blank?')).toBeVisible();
		const heading = page.getByRole('heading', { level: 1 });
		await expect(heading).toHaveText(/^Pack the\s+blank\s+glass cups in soft paper\.$/);
		await expect(heading).not.toContainText('fragile');

		const asked = await answerCurrent(page);
		expect(asked).toMatchObject({ type: 'cloze', word: 'fragile' });
	});

	test('a spelling question takes a typed answer, whatever the capitals', async ({ page }) => {
		await begin(page);
		for (let index = 0; index < 2; index++) {
			await answerCurrent(page);
			await nextButton(page).click();
		}

		await expect(page.getByText('Type the word that means this.')).toBeVisible();
		await expect(page.getByRole('heading', { level: 1, name: 'very, very big' })).toBeVisible();
		await expect(page.getByText('It starts with “e” and has 8 letters.')).toBeVisible();
		// The word itself is nowhere on the page, and cannot be listened to. The page is
		// loaded afresh first: the data sent with the first page stays in it after moving on,
		// and the word may have been one of the choices offered for an earlier question.
		await page.reload();
		await expect(page.getByText('Type the word that means this.')).toBeVisible();
		expect(await page.content()).not.toMatch(/enormous/i);
		await expect(page.getByRole('button', { name: /^Hear/ })).toHaveCount(0);
		await expect(page.getByLabel('Your answer')).toHaveAttribute('spellcheck', 'false');

		await page.getByLabel('Your answer').fill('  Enormous ');
		await page.getByRole('button', { name: 'Check' }).click();

		await expect(page.getByRole('heading', { level: 1, name: 'Correct' })).toBeAttached();
		// Right out of box 5: the word is mastered.
		expect(
			withDb((db) =>
				db
					.prepare(
						`select p.box, p.mastered_at is not null as mastered
						 from word_progress p join word w on w.id = p.word_id where w.word = 'enormous'`
					)
					.get()
			)
		).toEqual({ box: 5, mastered: 1 });
	});

	test('a misspelling is shown next to the right spelling', async ({ page }) => {
		await begin(page);
		for (let index = 0; index < 2; index++) {
			await answerCurrent(page);
			await nextButton(page).click();
		}

		await page.getByLabel('Your answer').fill('enormus');
		await page.getByRole('button', { name: 'Check' }).click();

		await expect(page.getByRole('status')).toContainText(
			'You typed enormus. It is spelled enormous.'
		);
		expect(
			withDb((db) =>
				db
					.prepare(
						`select p.box from word_progress p join word w on w.id = p.word_id where w.word = 'enormous'`
					)
					.get()
			)
		).toEqual({ box: 1 });
	});

	test('spelling questions are not asked when the parent has turned them off', async ({ page }) => {
		withDb((db) =>
			db
				.prepare('update child set settings_json = ?')
				.run(JSON.stringify({ spellingEnabled: false }))
		);
		await begin(page);
		await finishSession(page);

		expect(
			withDb((db) => db.prepare("select count(*) as n from question where type = 'spell'").get())
		).toEqual({ n: 0 });
	});
});

test.describe('what a child can and cannot reach', () => {
	test.beforeEach(() => {
		createChild('Sam');
		createChild('Mia');
	});

	test('practice needs a signed-in child', async ({ page, request, baseURL }) => {
		for (const route of ['/play', '/play/done']) {
			await page.goto(route);
			await expect(page).toHaveURL(/\/$/);
			await expect(page.getByRole('heading', { name: "What's your name?" })).toBeVisible();
		}

		for (const action of ['start', 'answer', 'next', 'quit']) {
			const response = await request.post(`/play?/${action}`, {
				headers: { ...form, origin: baseURL! },
				data: 'questionId=1&choice=0',
				maxRedirects: 0
			});
			expect(response.status(), action).toBe(303);
			expect(response.headers()['location'], action).toBe('/');
		}
		expect(count('practice_session')).toBe(0);
	});

	test('a child session opens nothing in the parent area', async ({ page, context, baseURL }) => {
		await enterAs(page, 'Sam');
		await expect(page.getByRole('heading', { name: 'Hi, Sam!' })).toBeVisible();

		for (const route of [
			'/parent',
			'/parent/settings',
			'/parent/children/1',
			'/parent/children/new'
		]) {
			const response = await page.request.get(route, { maxRedirects: 0 });
			expect(response.status(), route).toBe(303);
			expect(response.headers()['location'], route).toBe('/parent/login');
		}
		await page.goto('/parent');
		await expect(page).toHaveURL(/\/parent\/login$/);

		// Not even by presenting the child's token under the parent's cookie name.
		const token = (await context.cookies()).find((entry) => entry.name === 'vocab_child')!.value;
		await context.addCookies([{ name: 'vocab_parent', value: token, url: baseURL! }]);
		const forged = await page.request.get('/parent', { maxRedirects: 0 });
		expect(forged.status()).toBe(303);

		const post = await page.request.post('/parent/children/new', {
			headers: { ...form, origin: baseURL! },
			data: 'name=Zed&grade=3',
			maxRedirects: 0
		});
		expect(post.status()).toBe(303);
		expect(count('child')).toBe(2);
	});

	test('one child cannot answer or see another child’s question', async ({
		page,
		browser,
		baseURL
	}) => {
		await begin(page, 'Sam');
		const samsQuestion = pendingQuestion();

		const other = await browser.newContext();
		const miaPage = await other.newPage();
		await begin(miaPage, 'Mia');
		const miasQuestion = pendingQuestion();
		expect(miasQuestion.id).not.toBe(samsQuestion.id);

		// Mia posts an answer naming Sam's question.
		const response = await miaPage.request.post('/play?/answer', {
			headers: { ...form, origin: baseURL! },
			data: `questionId=${samsQuestion.id}&choice=${samsQuestion.choices.indexOf(samsQuestion.correct)}`
		});
		expect(response.ok()).toBe(true);

		expect(count('answer')).toBe(0);
		// Each child still sees only their own question.
		await page.reload();
		await expect(
			page.locator(`input[name="questionId"][value="${samsQuestion.id}"]`)
		).toBeAttached();
		await miaPage.reload();
		await expect(
			miaPage.locator(`input[name="questionId"][value="${miasQuestion.id}"]`)
		).toBeAttached();
		await other.close();
	});

	test('a second answer to the same question is ignored', async ({ page, baseURL }) => {
		await begin(page);
		const current = pendingQuestion();
		const right = current.choices.indexOf(current.correct);
		const post = (choice: number) =>
			page.request.post('/play?/answer', {
				headers: { ...form, origin: baseURL! },
				data: `questionId=${current.id}&choice=${choice}`
			});

		await post((right + 1) % 4);
		await post(right); // trying again after seeing the explanation

		expect(withDb((db) => db.prepare('select is_correct from answer').all())).toEqual([
			{ is_correct: 0 }
		]);
	});

	test('a made-up choice is refused', async ({ page, baseURL }) => {
		await begin(page);
		const current = pendingQuestion();

		for (const data of [`questionId=${current.id}`, `questionId=${current.id}&choice=9`]) {
			const response = await page.request.post('/play?/answer', {
				headers: { ...form, origin: baseURL! },
				data
			});
			expect(response.status()).toBe(400);
		}
		expect(count('answer')).toBe(0);
	});

	test('archiving a child ends their session at once', async ({ page }) => {
		await begin(page, 'Sam');
		withDb((db) =>
			db.prepare("update child set archived_at = ? where name = 'Sam'").run(Date.now())
		);

		await page.goto('/play');

		await expect(page.getByRole('heading', { name: "What's your name?" })).toBeVisible();
	});

	test('practice pages are never cached', async ({ page }) => {
		await begin(page);

		for (const route of ['/', '/play']) {
			expect((await page.request.get(route)).headers()['cache-control'], route).toBe('no-store');
		}
	});
});

test.describe('daily limit', () => {
	test('after the limit the child is told to come back tomorrow', async ({ page, baseURL }) => {
		const samId = createChild('Sam', 3, { dailyCapMinutes: 5 });
		// Six minutes of practice already today.
		withDb((db) =>
			db
				.prepare(
					`insert into practice_session (child_id, started_at, ended_at, active_ms, question_count, completed)
					 values (?, ?, ?, ?, 10, 1)`
				)
				.run(samId, Date.now() - 60_000, Date.now() - 30_000, 6 * 60_000)
		);

		await enterAs(page, 'Sam');

		await expect(
			page.getByText('Great work today! You are all done. Come back tomorrow.')
		).toBeVisible();
		await expect(startButton(page)).toHaveCount(0);

		// Posting the start form anyway starts nothing.
		const response = await page.request.post('/play?/start', {
			headers: { ...form, origin: baseURL! },
			maxRedirects: 0
		});
		expect(response.headers()['location']).toBe('/');
		expect(count('practice_session')).toBe(1);
	});

	test('yesterday’s practice does not count against today', async ({ page }) => {
		const samId = createChild('Sam', 3, { dailyCapMinutes: 5 });
		const yesterday = Date.now() - 26 * 60 * 60 * 1000;
		withDb((db) =>
			db
				.prepare(
					`insert into practice_session (child_id, started_at, ended_at, active_ms, question_count, completed)
					 values (?, ?, ?, ?, 10, 1)`
				)
				.run(samId, yesterday, yesterday + 60_000, 6 * 60_000)
		);

		await enterAs(page, 'Sam');

		await expect(page.getByRole('button', { name: 'Start practicing' })).toBeVisible();
	});
});

test.describe('accessibility and layout of the child pages', () => {
	test.use({ reducedMotion: 'reduce' });

	for (const theme of ['light', 'dark'] as const) {
		test(`no axe violations in the ${theme} theme`, async ({ page, context, baseURL }) => {
			await context.addCookies([{ name: 'theme', value: theme, url: baseURL! }]);
			const samId = createChild('Sam');
			placeWords(samId, { timid: 3, fragile: 4, enormous: 5 });

			// The name page, empty and with a message.
			await page.goto('/');
			await expectAccessible(page);
			await enterAs(page, 'Nobody');
			await expect(page.getByText(UNKNOWN)).toBeVisible();
			await expectAccessible(page);

			await enterAs(page, 'Sam');
			await expect(page.getByRole('heading', { name: 'Hi, Sam!' })).toBeVisible();
			await expectAccessible(page);
			await startButton(page).click();

			// "Which word means this?", then a wrong answer.
			await expect(page.getByText('Which word means this?')).toBeVisible();
			await expectAccessible(page);
			await answerCurrent(page, false);
			await expectAccessible(page);
			await nextButton(page).click();

			// Fill-in-the-blank, then a right answer.
			await expect(page.getByText('Which word fits in the blank?')).toBeVisible();
			await expectAccessible(page);
			await answerCurrent(page);
			await expectAccessible(page);
			await nextButton(page).click();

			// Spelling, answered wrongly.
			await expect(page.getByText('Type the word that means this.')).toBeVisible();
			await expectAccessible(page);
			await answerCurrent(page, false);
			await expectAccessible(page);
			await nextButton(page).click();

			// "What does this word mean?"
			await expect(page.getByText('What does this word mean?')).toBeVisible();
			await expectAccessible(page);

			// The confirmation dialog.
			await page.waitForLoadState('networkidle');
			await page.getByRole('button', { name: 'Stop for now' }).click();
			await expect(page.getByRole('dialog')).toBeVisible();
			await expectAccessible(page);
			await page.getByRole('dialog').getByRole('button', { name: 'Keep going' }).click();

			await finishSession(page);
			await expect(page.getByRole('heading', { name: 'Great work, Sam!' })).toBeVisible();
			await expectAccessible(page);
		});
	}

	test('every practice screen holds at 360px wide, even with long words', async ({ page }) => {
		await page.setViewportSize({ width: 360, height: 740 });
		const samId = createChild('Sam', 6);
		placeWords(samId, { approximately: 3, comprehensive: 4, commemorate: 5 });
		const fits = async (label: string) => {
			const overflow = await page.evaluate(
				() => document.documentElement.scrollWidth - document.documentElement.clientWidth
			);
			expect(overflow, label).toBeLessThanOrEqual(0);
		};

		await enterAs(page, 'Sam');
		await fits('welcome');
		await startButton(page).click();

		for (let number = 1; number <= 4; number++) {
			await expect(page.locator('input[name="questionId"]')).toBeAttached();
			await fits(`question ${number}`);
			await answerCurrent(page, number % 2 === 0);
			await fits(`feedback ${number}`);
			await nextButton(page).click();
		}
		await finishSession(page);
		await fits('summary');
	});

	test('every answer choice is a comfortably large target', async ({ page }) => {
		await page.setViewportSize({ width: 360, height: 740 });
		const samId = createChild('Sam');
		placeWords(samId, { timid: 3 });
		await begin(page);
		await page.waitForLoadState('networkidle');

		const sizes = await page.locator('button[name="choice"], button.speak').evaluateAll((buttons) =>
			buttons.map((button) => {
				const box = button.getBoundingClientRect();
				return Math.min(box.width, box.height);
			})
		);
		expect(sizes).toHaveLength(8); // four choices, four speak buttons
		for (const size of sizes) expect(size).toBeGreaterThanOrEqual(44);
	});
});
