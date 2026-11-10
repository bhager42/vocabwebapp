import AxeBuilder from '@axe-core/playwright';
import Database from 'better-sqlite3';
import { expect, type Page } from '@playwright/test';

export const SETUP_TOKEN = 'e2e-setup-token';
export const PARENT = { username: 'parent', password: 'correct horse battery' };

/**
 * Runs `fn` with a direct connection to the database the test server is using
 * (see DATA_DIR in playwright.config.ts). Used to arrange things a browser cannot,
 * such as making a session look twelve hours old.
 */
export function withDb<T>(fn: (db: Database.Database) => T): T {
	const db = new Database('.tmp/e2e-data/vocab.db');
	db.pragma('busy_timeout = 5000');
	try {
		return fn(db);
	} finally {
		db.close();
	}
}

/** Back to a fresh install: no parent, no children, no practice, nobody signed in or locked out. */
export function resetAccounts() {
	withDb((db) =>
		db.exec(
			`delete from answer; delete from question; delete from practice_session;
			 delete from word_progress; delete from auth_session; delete from login_attempt;
			 delete from child; delete from parent;`
		)
	);
}

export async function fillSetup(
	page: Page,
	values: Partial<{ token: string; username: string; password: string; confirm: string }> = {}
) {
	const password = values.password ?? PARENT.password;
	await page.goto('/setup');
	await page.getByLabel('Setup code').fill(values.token ?? SETUP_TOKEN);
	await page.getByLabel('Username').fill(values.username ?? PARENT.username);
	await page.getByLabel('Password', { exact: true }).fill(password);
	await page.getByLabel('Password again').fill(values.confirm ?? password);
	await page.getByRole('button', { name: 'Create account' }).click();
}

/** Creates the parent account through the setup page, which also signs in. */
export async function setUpParent(page: Page) {
	await fillSetup(page);
	await expect(page).toHaveURL(/\/parent$/);
}

export async function fillSignIn(
	page: Page,
	password = PARENT.password,
	username = PARENT.username
) {
	await page.goto('/parent/login');
	await page.getByLabel('Username').fill(username);
	await page.getByLabel('Password').fill(password);
	await page.getByRole('button', { name: 'Sign in' }).click();
}

export async function signOut(page: Page) {
	await page.getByRole('button', { name: 'Sign out', exact: true }).click();
	await expect(page).toHaveURL(/\/$/);
}

export async function addChild(page: Page, name: string, grade = '3') {
	await page.goto('/parent/children/new');
	await page.getByLabel('First name').fill(name);
	await page.getByLabel('Grade').selectOption(grade);
	await page.getByRole('button', { name: 'Add child' }).click();
}

const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'];

/**
 * Runs axe on the page as it stands and insists that it really measured color contrast.
 * If axe cannot work out a color it files the element under "incomplete" instead of
 * failing, which would let unreadable text slip through.
 *
 * While a modal dialog is open the page behind it cannot be seen clearly or used, and axe
 * cannot tell that the dialog sits on top of it. So the page behind is hidden for the
 * check and only the dialog is judged; check the page itself before opening the dialog.
 */
export async function expectAccessible(page: Page) {
	const restore = await page.evaluateHandle(() => {
		const hidden: HTMLElement[] = [];
		const dialog = document.querySelector('dialog[open]');
		for (let node = dialog; node && node !== document.body; node = node.parentElement) {
			for (const sibling of node.parentElement?.children ?? []) {
				if (sibling !== node && sibling instanceof HTMLElement) {
					sibling.style.display = 'none';
					hidden.push(sibling);
				}
			}
		}
		return () => hidden.forEach((element) => element.style.removeProperty('display'));
	});

	const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
	await restore.evaluate((undo) => undo());

	expect(results.violations).toEqual([]);
	expect(results.incomplete.filter((result) => result.id === 'color-contrast')).toEqual([]);
	expect(results.passes.some((result) => result.id === 'color-contrast')).toBe(true);
}

// ---- Practice ----

/** Adds a child straight to the database, for tests that are not about the parent pages. */
export function createChild(
	name: string,
	grade = 3,
	settings: Record<string, unknown> = {}
): number {
	return withDb(
		(db) =>
			db
				.prepare(
					'insert into child (name, name_normalized, grade, settings_json, created_at) values (?, ?, ?, ?, ?)'
				)
				.run(name, name.toLowerCase(), grade, JSON.stringify(settings), Date.now())
				.lastInsertRowid as number
	);
}

/** A child types their name on the front page. */
export async function enterAs(page: Page, name: string) {
	await page.goto('/');
	await page.getByLabel('Your first name').fill(name);
	await page.getByRole('button', { name: "Let's go" }).click();
}

export interface PendingQuestion {
	id: number;
	type: 'word_to_def' | 'def_to_word' | 'cloze' | 'spell';
	choices: string[];
	correct: string;
	word: string;
	definition: string;
	sentence: string;
}

/** A question (by default the newest) with the answer only the server knows. */
export function pendingQuestion(id?: number): PendingQuestion {
	const row = withDb(
		(db) =>
			db
				.prepare(
					`select q.id, q.type, q.choices_json as choices, q.correct_choice as correct,
					        w.word, w.definition, w.sentence
					 from question q join word w on w.id = q.word_id
					 where q.id = coalesce(?, (select max(id) from question))`
				)
				.get(id ?? null) as Omit<PendingQuestion, 'choices'> & { choices: string }
	);
	return { ...row, choices: JSON.parse(row.choices) };
}

/** Answers the question on screen, rightly or wrongly, and waits for the feedback. */
export async function answerCurrent(page: Page, correct = true): Promise<PendingQuestion> {
	// Wait for a question to be on screen, then look up that very question.
	const current = pendingQuestion(
		Number(await page.locator('input[name="questionId"]').inputValue())
	);

	if (current.type === 'spell') {
		await page.getByLabel('Your answer').fill(correct ? current.correct : 'zzzz');
		await page.getByRole('button', { name: 'Check' }).click();
	} else {
		const right = current.choices.indexOf(current.correct);
		const pick = correct ? right : (right + 1) % current.choices.length;
		await page.locator(`button[name="choice"][value="${pick}"]`).click();
	}

	await expect(
		page.getByRole('heading', { level: 1, name: correct ? 'Correct' : 'Not quite' })
	).toBeAttached();
	return current;
}

export const nextButton = (page: Page) =>
	page.getByRole('button', { name: /^(Next|See how you did)$/ });

/** Puts words in given boxes for a child, due now, so particular kinds of question come up. */
export function placeWords(childId: number, boxes: Record<string, number>) {
	withDb((db) => {
		const find = db.prepare('select id from word where word = ?');
		const insert = db.prepare(
			`insert into word_progress (child_id, word_id, box, due_at, times_seen, times_correct, first_seen_at)
			 values (?, ?, ?, ?, 1, 1, ?)`
		);
		// Earlier in the list means more overdue, so it is asked first.
		Object.entries(boxes).forEach(([name, box], index) => {
			const { id } = find.get(name) as { id: number };
			const dueAt = Date.now() - (100 - index) * 60 * 60 * 1000;
			insert.run(childId, id, box, dueAt, dueAt - 7 * 24 * 60 * 60 * 1000);
		});
	});
}
