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

const count = (table: string) =>
	withDb((db) => (db.prepare(`select count(*) as n from ${table}`).get() as { n: number }).n);

const gradeOf = (childId: number) =>
	withDb(
		(db) => db.prepare('select grade from child where id = ?').get(childId) as { grade: number }
	).grade;

interface PlacementQuestion {
	id: number;
	grade: number;
	choices: string[];
	correct: string;
	word: string;
	sentence: string;
	chosen: string | null;
}

/** A quiz question with the answer only the server knows. */
function placementQuestion(id: number): PlacementQuestion {
	const row = withDb(
		(db) =>
			db
				.prepare(
					`select p.id, p.grade, p.choices_json as choices, p.correct_choice as correct,
					        p.chosen, w.word, w.sentence
					 from placement_answer p join word w on w.id = p.word_id where p.id = ?`
				)
				.get(id) as Omit<PlacementQuestion, 'choices'> & { choices: string }
	);
	return { ...row, choices: JSON.parse(row.choices) };
}

/** Starts a quiz for a child the way the parent does, straight in the database. */
function openQuiz(childId: number) {
	withDb((db) =>
		db
			.prepare(
				'insert into placement_quiz (child_id, started_at, start_grade) select id, ?, grade from child where id = ?'
			)
			.run(Date.now(), childId)
	);
}

const questionId = async (page: Page) =>
	Number(await page.locator('input[name="questionId"]').inputValue());

/**
 * Answers quiz questions until the quiz ends: right at grades up to `knows`, "I don't
 * know" above. Returns how many were asked.
 */
async function takeQuiz(page: Page, knows: number): Promise<number> {
	const done = page.getByRole('heading', { level: 1, name: 'All done!' });
	let asked = 0;
	while (!(await done.isVisible())) {
		const id = await questionId(page);
		const current = placementQuestion(id);
		if (current.grade <= knows) {
			await page
				.locator(`button[name="choice"][value="${current.choices.indexOf(current.correct)}"]`)
				.click();
		} else {
			await page.getByRole('button', { name: "I don't know this one" }).click();
		}
		asked++;
		// Wait for the next question, or the end.
		await expect(async () => {
			const moved =
				(await done.isVisible()) ||
				(await page.locator('input[name="questionId"]').count()) === 0 ||
				(await questionId(page)) !== id;
			expect(moved).toBe(true);
		}).toPass();
		expect(asked).toBeLessThan(60);
	}
	return asked;
}

test.beforeEach(() => resetAccounts());

test('the parent gives a quiz, the child takes it, and the parent moves them up', async ({
	page
}) => {
	await setUpParent(page);
	const sam = createChild('Sam');

	// The parent asks for a quiz.
	await page.goto(`/parent/children/${sam}`);
	await page.getByRole('button', { name: 'Give Sam a placement quiz' }).click();
	await expect(page.getByText('A quiz is waiting for Sam.')).toBeVisible();

	// Sam sees it before practice, and knows grade 3 and 4 words but not grade 5.
	const before = ['question', 'answer', 'practice_session', 'word_progress'].map(count);
	await enterAs(page, 'Sam');
	await expect(page.getByText('First, a quick quiz to find the best words for you.')).toBeVisible();
	await expect(page.getByRole('button', { name: 'Start practicing' })).toHaveCount(0);
	await page.getByRole('button', { name: 'Start the quiz' }).click();
	await expect(page.getByText('Part 1, question 1 of 5')).toBeVisible();
	expect(await takeQuiz(page, 4)).toBe(15);
	await expect(page.getByText('Thanks for doing the quiz.')).toBeVisible();

	// The quiz is not practice: nothing there has changed.
	expect(['question', 'answer', 'practice_session', 'word_progress'].map(count)).toEqual(before);
	await page.getByRole('link', { name: 'Back to the start' }).click();
	await expect(page.getByRole('button', { name: 'Start practicing' })).toBeVisible();

	// The parent sees the result and acts on it.
	await page.goto(`/parent/children/${sam}`);
	await expect(page.getByText('It suggests grade 4.')).toBeVisible();
	await expect(page.getByText('Grade 3: 5 of 5 right')).toBeVisible();
	await expect(page.getByText('Grade 5: 0 of 5 right')).toBeVisible();
	await page.getByRole('button', { name: 'Move Sam to grade 4' }).click();
	await expect(page.getByText('Sam is now at grade 4.')).toBeVisible();
	expect(gradeOf(sam)).toBe(4);
	await expect(page.getByLabel('Grade', { exact: true })).toHaveValue('4');
	await expect(page.getByRole('button', { name: /Move Sam to grade/ })).toHaveCount(0);
});

test.describe('without JavaScript', () => {
	test.use({ javaScriptEnabled: false });

	test('the quiz works with plain forms', async ({ page }) => {
		const sam = createChild('Sam');
		openQuiz(sam);
		await enterAs(page, 'Sam');
		await page.getByRole('button', { name: 'Start the quiz' }).click();
		await expect(page).toHaveURL(/\/play\/placement$/);
		// Nothing known at grade 3: one round, and the quiz suggests grade 3.
		expect(await takeQuiz(page, 0)).toBe(5);
		const result = withDb((db) =>
			db.prepare('select result_grade as grade, completed from placement_quiz').get()
		);
		expect(result).toEqual({ grade: 3, completed: 1 });
	});
});

test('the answer is never sent before the child has answered', async ({ page }) => {
	const bodies: string[] = [];
	page.on('response', async (response) => {
		if (new URL(response.url()).pathname.startsWith('/play')) {
			bodies.push(await response.text().catch(() => ''));
		}
	});
	const seen = () => bodies.splice(0).join('\n');

	const sam = createChild('Sam');
	openQuiz(sam);
	await enterAs(page, 'Sam');
	await page.getByRole('button', { name: 'Start the quiz' }).click();

	for (let number = 1; number <= 5; number++) {
		await expect(page.getByText(`Part 1, question ${number} of 5`)).toBeVisible();
		await page.waitForLoadState('networkidle');
		const current = placementQuestion(await questionId(page));
		const before = `${seen()}\n${await page.content()}`;
		expect(before).not.toMatch(/correct_?choice|is_?correct|"correct"|data-state/i);
		expect(before).not.toContain(current.sentence);
		expect(before).toContain(current.word);
		await page
			.locator(`button[name="choice"][value="${current.choices.indexOf(current.correct)}"]`)
			.click();
		await expect.poll(() => placementQuestion(current.id).chosen).toBe(current.correct);
	}
});

test('a child can only answer their own quiz', async ({ page }) => {
	createChild('Sam');
	const alex = createChild('Alex');
	openQuiz(alex);

	// Alex is served a question.
	await enterAs(page, 'Alex');
	await page.getByRole('button', { name: 'Start the quiz' }).click();
	const id = await questionId(page);
	await page.goto('/');
	await page.getByRole('button', { name: 'Switch' }).click();

	// Sam, who has no quiz, tries to answer it.
	await enterAs(page, 'Sam');
	await expect(page.getByRole('button', { name: 'Start practicing' })).toBeVisible();
	const response = await page.request.post('/play/placement?/answer', {
		headers: { ...form, origin: new URL(page.url()).origin },
		form: { questionId: String(id), choice: '0' },
		maxRedirects: 0
	});
	expect(response.status()).toBe(303);
	expect(placementQuestion(id).chosen).toBeNull();

	// And a visitor with no child session is sent to the name page.
	await page.context().clearCookies();
	await page.goto('/play/placement');
	await expect(page).toHaveURL(/\/$/);
});

test('stopping part way picks up at the same question', async ({ page }) => {
	const sam = createChild('Sam');
	openQuiz(sam);
	await enterAs(page, 'Sam');
	await page.getByRole('button', { name: 'Start the quiz' }).click();
	await page.getByRole('button', { name: "I don't know this one" }).click();
	await expect(page.getByText('Part 1, question 2 of 5')).toBeVisible();
	const id = await questionId(page);

	await page.getByRole('link', { name: 'Stop for now' }).click();
	await expect(page.getByText('You are part way through a quick quiz.')).toBeVisible();
	await page.getByRole('button', { name: 'Keep going' }).click();
	await expect(page.getByText('Part 1, question 2 of 5')).toBeVisible();
	expect(await questionId(page)).toBe(id);
});

test('the parent can cancel a quiz', async ({ page }) => {
	await setUpParent(page);
	const sam = createChild('Sam');
	openQuiz(sam);
	await page.goto(`/parent/children/${sam}`);
	await page.getByRole('button', { name: 'Cancel the quiz' }).click();
	await expect(page.getByText('The quiz was cancelled.')).toBeVisible();
	await expect(page.getByRole('button', { name: 'Give Sam a placement quiz' })).toBeVisible();

	await enterAs(page, 'Sam');
	await expect(page.getByRole('button', { name: 'Start practicing' })).toBeVisible();
});

test.describe('accessibility', () => {
	test.use({ reducedMotion: 'reduce' });

	for (const theme of ['light', 'dark'] as const) {
		test(`no axe violations in the ${theme} theme`, async ({ page, context, baseURL }) => {
			await context.addCookies([{ name: 'theme', value: theme, url: baseURL! }]);
			await setUpParent(page);
			const sam = createChild('Sam');

			await page.goto(`/parent/children/${sam}`);
			await page.getByRole('button', { name: 'Give Sam a placement quiz' }).click();
			await expect(page.getByText('A quiz is waiting for Sam.')).toBeVisible();
			await expectAccessible(page);

			await enterAs(page, 'Sam');
			await expectAccessible(page);
			await page.getByRole('button', { name: 'Start the quiz' }).click();
			await expect(page.getByText('Part 1, question 1 of 5')).toBeVisible();
			await expectAccessible(page);
			await takeQuiz(page, 3);
			await expectAccessible(page);

			await page.goto(`/parent/children/${sam}`);
			await expect(page.getByText('It suggests grade 3.')).toBeVisible();
			await expectAccessible(page);

			// The weekly summary: email not set up on the test server, and the preview.
			await page.goto('/parent/settings');
			await expect(page.getByText('Email is not set up.')).toBeVisible();
			await expectAccessible(page);
			await page.getByRole('link', { name: "See this week's summary" }).click();
			await expect(page.getByRole('heading', { level: 1, name: 'Weekly summary' })).toBeVisible();
			await expect(page.getByText('Sam did not practice this week.')).toBeVisible();
			await expectAccessible(page);
		});
	}
});
