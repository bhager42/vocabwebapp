import { expect, test, type Page } from '@playwright/test';
import {
	createChild,
	enterAs,
	expectAccessible,
	resetAccounts,
	setUpParent,
	withDb
} from './helpers.ts';

const form = { 'content-type': 'application/x-www-form-urlencoded', accept: 'text/html' };

interface Served {
	id: number;
	choices: string[];
	correct: string;
	explanation: string;
	chosen: string | null;
	title: string;
}

/** A served reading question with what only the server knows. */
function served(id: number): Served {
	const row = withDb(
		(db) =>
			db
				.prepare(
					`select a.id, a.choices_json as choices, a.correct_choice as correct, a.chosen,
					        q.explanation, s.title
					 from reading_answer a
					 join reading_question q on q.id = a.question_id
					 join reading_story s on s.id = q.story_id
					 where a.id = ?`
				)
				.get(id) as Omit<Served, 'choices'> & { choices: string }
	);
	return { ...row, choices: JSON.parse(row.choices) };
}

const questionId = async (page: Page) =>
	Number(await page.locator('input[name="questionId"]').inputValue());

const readButton = (page: Page) =>
	page.getByRole('button', { name: /^(Read a story|Keep reading)$/ });

/** Answers the question on screen and waits for the feedback. */
async function answer(page: Page, right = true): Promise<Served> {
	const current = served(await questionId(page));
	const index = current.choices.indexOf(current.correct);
	await page.locator(`button[name="choice"][value="${right ? index : (index + 1) % 4}"]`).click();
	await expect(page.getByText(current.explanation)).toBeVisible();
	return current;
}

/** Reads to the end, getting the first `right` questions right. */
async function finishStory(page: Page, right = 5) {
	for (let number = 1; ; number++) {
		await expect(page.getByText(`Question ${number} of 5`)).toBeVisible();
		await answer(page, number <= right);
		const next = page.getByRole('button', { name: /^(Next question|See how you did)$/ });
		const last = (await next.textContent())?.trim() === 'See how you did';
		await next.click();
		if (last) break;
	}
	await expect(page).toHaveURL(/\/play\/read\/done$/);
}

test.beforeEach(() => resetAccounts());

test('a child reads a story and the parent sees how it went', async ({ page }) => {
	await setUpParent(page);
	const sam = createChild('Sam');

	await enterAs(page, 'Sam');
	await readButton(page).click();
	await expect(page).toHaveURL(/\/play\/read$/);
	await expect(page.getByRole('heading', { level: 1, name: 'The Roof Garden' })).toBeVisible();
	await expect(page.getByText('Grade 3 story')).toBeVisible();
	// The whole story is on screen while answering.
	await expect(page.getByText('Priya lived with her grandpa')).toBeVisible();

	// A wrong answer shows the right one and why.
	await expect(page.getByText('Question 1 of 5')).toBeVisible();
	const first = await answer(page, false);
	await expect(page.getByText('Not quite. Here is why.')).toBeVisible();
	await expect(page.getByText(`The answer is ${first.correct}.`)).toBeVisible();
	await page.getByRole('button', { name: 'Next question' }).click();

	// The rest right.
	for (let number = 2; number <= 5; number++) {
		await expect(page.getByText(`Question ${number} of 5`)).toBeVisible();
		await answer(page);
		await page.getByRole('button', { name: /^(Next question|See how you did)$/ }).click();
	}
	await expect(page.getByRole('heading', { name: 'Well done, Sam!' })).toBeVisible();
	await expect(page.getByText('got 4 of 5 questions right')).toBeVisible();

	// Another story is the next one along.
	await page.getByRole('button', { name: 'Read another story' }).click();
	await expect(
		page.getByRole('heading', { level: 1, name: 'The Missing Library Book' })
	).toBeVisible();

	// The parent's Reading tab.
	await page.goto(`/parent/children/${sam}/reading`);
	await expect(page.getByRole('heading', { name: 'Reading for Sam' })).toBeVisible();
	// Stories finished at each grade: one so far, and none at the grades above.
	await expect(
		page.getByRole('progressbar', { name: 'Grade 3 (reading now): 1 of 15 stories finished' })
	).toBeVisible();
	await expect(
		page.getByRole('progressbar', { name: 'Grade 4: 0 of 15 stories finished' })
	).toBeVisible();
	await expect(page.getByRole('row', { name: /Answer is in the story/ })).toContainText('1 of 2');
	await expect(page.getByRole('row', { name: /Answer must be worked out/ })).toContainText(
		'2 of 2'
	);
	await page.getByRole('link', { name: 'The Roof Garden' }).click();
	await expect(page.getByText(`Answered: `).first()).toBeVisible();
	await expect(page.getByText(`The answer: ${first.correct}`)).toBeVisible();
});

/**
 * Answers one question and goes on to the next, checking each time that the page stays on the
 * questions rather than jumping back up to the story. The screen is short, so the story alone
 * is taller than it.
 */
async function staysOnQuestions(page: Page) {
	await page.setViewportSize({ width: 1024, height: 600 });
	createChild('Sam');
	await enterAs(page, 'Sam');
	await readButton(page).click();
	const questions = page.locator('#questions');
	// A new story starts at the top, with the story to read first.
	expect((await questions.boundingBox())!.y).toBeGreaterThan(600);

	const nearTop = async () => {
		const box = (await questions.boundingBox())!;
		expect(box.y).toBeGreaterThanOrEqual(0);
		expect(box.y).toBeLessThan(100);
	};
	await answer(page);
	await nearTop();
	await page.getByRole('button', { name: 'Next question' }).click();
	await expect(page.getByText('Question 2 of 5')).toBeVisible();
	await nearTop();
}

test('answering keeps the page on the questions', async ({ page }) => {
	await staysOnQuestions(page);
});

test.describe('without JavaScript', () => {
	test.use({ javaScriptEnabled: false });

	test('a whole story works with plain forms', async ({ page }) => {
		createChild('Sam');
		await enterAs(page, 'Sam');
		await readButton(page).click();
		await finishStory(page, 3);
		await expect(page.getByText('got 3 of 5 questions right')).toBeVisible();
	});

	test('answering keeps the page on the questions', async ({ page }) => {
		await staysOnQuestions(page);
	});
});

test('the answer and explanation are never sent before the child has answered', async ({
	page
}) => {
	const bodies: string[] = [];
	page.on('response', async (response) => {
		if (new URL(response.url()).pathname.startsWith('/play')) {
			bodies.push(await response.text().catch(() => ''));
		}
	});
	const seen = () => bodies.splice(0).join('\n');

	createChild('Sam');
	await enterAs(page, 'Sam');
	await readButton(page).click();
	for (let number = 1; number <= 5; number++) {
		await expect(page.getByText(`Question ${number} of 5`)).toBeVisible();
		await page.waitForLoadState('networkidle');
		const current = served(await questionId(page));
		const before = `${seen()}\n${await page.content()}`;
		expect(before).not.toMatch(/correct_?choice|is_?correct|"correct"|data-state|explanation/i);
		expect(before).not.toContain(current.explanation);
		await answer(page);
		// The feedback rightly holds this question's answer; start afresh for the next one.
		await page.waitForLoadState('networkidle');
		seen();
		await page.getByRole('button', { name: /^(Next question|See how you did)$/ }).click();
	}
});

test('a child can only answer their own story', async ({ page }) => {
	createChild('Sam');
	createChild('Alex');
	await enterAs(page, 'Alex');
	await readButton(page).click();
	const id = await questionId(page);
	await page.goto('/');
	await page.getByRole('button', { name: 'Switch' }).click();

	await enterAs(page, 'Sam');
	const response = await page.request.post('/play/read?/answer', {
		headers: { ...form, origin: new URL(page.url()).origin },
		form: { questionId: String(id), choice: '0' },
		maxRedirects: 0
	});
	expect(response.status()).toBe(303);
	expect(served(id).chosen).toBeNull();

	await page.context().clearCookies();
	await page.goto('/play/read');
	await expect(page).toHaveURL(/\/$/);
});

test('stopping part way picks up at the same question', async ({ page }) => {
	createChild('Sam');
	await enterAs(page, 'Sam');
	await readButton(page).click();
	await answer(page);
	await page.getByRole('button', { name: 'Next question' }).click();
	await expect(page.getByText('Question 2 of 5')).toBeVisible();
	const id = await questionId(page);

	await page.getByRole('link', { name: 'Stop for now' }).click();
	await expect(page.getByRole('button', { name: 'Keep reading' })).toBeVisible();
	await page.getByRole('button', { name: 'Keep reading' }).click();
	await expect(page.getByText('Question 2 of 5')).toBeVisible();
	expect(await questionId(page)).toBe(id);
});

test('the parent can switch a story off and change the reading grade', async ({ page }) => {
	await setUpParent(page);
	const sam = createChild('Sam');

	await page.goto('/parent/stories');
	await expect(page.getByRole('heading', { name: 'Grade 3' })).toBeVisible();
	await page.locator('summary', { hasText: 'The Roof Garden' }).click();
	await expect(page.getByText('Answer: Tomato seeds')).toBeVisible();
	await page.getByRole('button', { name: 'Switch off The Roof Garden' }).click();
	await expect(page.getByRole('button', { name: 'Switch on The Roof Garden' })).toBeVisible();

	await enterAs(page, 'Sam');
	await readButton(page).click();
	await expect(
		page.getByRole('heading', { level: 1, name: 'The Missing Library Book' })
	).toBeVisible();

	// The reading grade is saved with the other settings.
	await page.goto(`/parent/children/${sam}`);
	const readingGrade = page.getByLabel('Reading grade', { exact: true });
	await expect(readingGrade).toHaveValue('3');
	await page.getByLabel('Move up a reading grade automatically').check();
	await page.getByRole('button', { name: 'Save changes' }).click();
	await expect(page.getByText('Saved.')).toBeVisible();
	const saved = withDb((db) =>
		db.prepare('select reading_grade as grade, settings_json as settings from child').get()
	) as { grade: number; settings: string };
	expect(saved.grade).toBe(3);
	expect(JSON.parse(saved.settings).autoUnlockReadingGrade).toBe(true);
});

test('after the last story at a grade, the child is sent to a grown-up, who can have the ones with mistakes read again', async ({
	page
}) => {
	await setUpParent(page);
	const sam = createChild('Sam');
	// One story at grade 3, so that reading it finishes the grade.
	withDb((db) =>
		db.exec("update reading_story set active = 0 where grade = 3 and title != 'The Roof Garden'")
	);

	await enterAs(page, 'Sam');
	await readButton(page).click();
	await finishStory(page, 4);
	await expect(page.getByText('You have read all the grade 3 stories!')).toBeVisible();
	await expect(page.getByRole('button', { name: 'Read another story' })).toHaveCount(0);
	await page.getByRole('link', { name: 'All done' }).click();
	await expect(page.getByText('You have read all the grade 3 stories. Amazing!')).toBeVisible();
	await expect(readButton(page)).toHaveCount(0);

	// The parent sees which story had a mistake and has it read again.
	await page.goto(`/parent/children/${sam}/reading`);
	await expect(page.getByText('Sam has read all 1 grade 3 stories.')).toBeVisible();
	await expect(page.getByRole('listitem').filter({ hasText: 'The Roof Garden' })).toBeVisible();
	await expect(page.getByRole('button', { name: 'Move up to reading grade 4' })).toBeVisible();
	await page.getByRole('button', { name: 'Read that story again' }).click();
	await expect(page.getByText('Sam will read that story again')).toBeVisible();

	await page.goto('/'); // Sam is still signed in on this device
	await readButton(page).click();
	await expect(page.getByRole('heading', { level: 1, name: 'The Roof Garden' })).toBeVisible();
	await finishStory(page, 5);
	await expect(page.getByText('You have read all the grade 3 stories!')).toBeVisible();

	// All right this time: nothing left to read again, and the parent can move Sam up.
	await page.goto(`/parent/children/${sam}/reading`);
	await expect(page.getByText('Every one had all its answers right the last time.')).toBeVisible();
	await expect(page.getByRole('button', { name: /again$/ })).toHaveCount(0);
	await page.getByRole('button', { name: 'Move up to reading grade 4' }).click();
	await expect(page.getByText('Sam is now reading grade 4 stories.')).toBeVisible();
});

test.describe('accessibility', () => {
	test.use({ reducedMotion: 'reduce' });

	for (const theme of ['light', 'dark'] as const) {
		test(`no axe violations in the ${theme} theme`, async ({ page, context, baseURL }) => {
			await context.addCookies([{ name: 'theme', value: theme, url: baseURL! }]);
			await setUpParent(page);
			const sam = createChild('Sam');

			await enterAs(page, 'Sam');
			await expect(readButton(page)).toBeVisible();
			await expectAccessible(page);
			await readButton(page).click();
			await expect(page.getByText('Question 1 of 5')).toBeVisible();
			await expectAccessible(page);
			await answer(page, false);
			await expectAccessible(page);
			await page.getByRole('button', { name: 'Next question' }).click();
			for (let number = 2; number <= 5; number++) {
				await expect(page.getByText(`Question ${number} of 5`)).toBeVisible();
				await answer(page);
				if (number === 5) await expectAccessible(page);
				await page.getByRole('button', { name: /^(Next question|See how you did)$/ }).click();
			}
			await expect(page.getByRole('heading', { name: 'Well done, Sam!' })).toBeVisible();
			await expectAccessible(page);

			await page.goto(`/parent/children/${sam}/reading`);
			await expect(page.getByRole('heading', { name: 'Reading for Sam' })).toBeVisible();
			await expectAccessible(page);
			await page.getByRole('link', { name: 'The Roof Garden' }).click();
			await expect(page.getByRole('heading', { name: 'The Roof Garden' })).toBeVisible();
			await page.getByText('Read the story').click();
			await expectAccessible(page);

			await page.goto('/parent/stories');
			await page.locator('summary', { hasText: 'The Fun Run' }).click();
			await expectAccessible(page);

			await page.goto(`/parent/children/${sam}`);
			await expectAccessible(page);
		});
	}

	test('the reading page holds at 360px wide', async ({ page }) => {
		await page.setViewportSize({ width: 360, height: 740 });
		createChild('Sam');
		await enterAs(page, 'Sam');
		await readButton(page).click();
		await expect(page.getByText('Question 1 of 5')).toBeVisible();
		const overflow = await page.evaluate(
			() => document.documentElement.scrollWidth - document.documentElement.clientWidth
		);
		expect(overflow).toBeLessThanOrEqual(0);
	});
});
