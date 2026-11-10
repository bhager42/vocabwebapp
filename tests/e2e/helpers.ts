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
	// The one thing axe cannot measure is text drawn inside an SVG picture (the labels on
	// a chart's axes). Those are let through here; dashboard.e2e.ts checks instead that they
	// use exactly the color of ordinary text next to them, which axe does measure.
	const unmeasured = results.incomplete
		.filter((result) => result.id === 'color-contrast')
		.flatMap((result) => result.nodes)
		.filter((node) => !/^<text[\s>]/.test(node.html));
	expect(unmeasured).toEqual([]);
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

// ---- Practice history, for the parent dashboard ----

const DAY_MS = 24 * 60 * 60 * 1000;

/** Text a child could type as a spelling answer to try to break the parent's pages. */
export const NASTY_ANSWER = '<img src=x onerror="document.title=\'pwned\'">';
export const FORMULA_ANSWER = '=HYPERLINK("http://example.com","click")';

export interface SeededPractice {
	/** Three days ago (finished), yesterday (finished), today (stopped early). */
	sessions: [number, number, number];
	/** Five grade 3 words, by the order they were first asked. */
	words: { id: number; word: string; definition: string }[];
}

/** Noon on the local day `daysAgo` days before today, so a test never straddles midnight. */
function noon(daysAgo: number): number {
	const date = new Date();
	date.setHours(12, 0, 0, 0);
	date.setDate(date.getDate() - daysAgo);
	return date.getTime();
}

/**
 * Gives a child a small practice history ending today, each session at noon:
 *
 *   three days ago, finished, 4 min: A ✓  B ✗ (picked C's meaning)  C ✓  B again ✓
 *   yesterday, finished, 3 min:      A ✓  B ✗ (picked C's meaning)  D ✓
 *   today, stopped early, 1 min:     E spelled wrong twice (see the two answers above)
 *
 * So, over the last 7 days: 4 of 7 first attempts right, 2 of 3 sessions finished,
 * 8 minutes practiced, and the trouble words are E (2 of 2 wrong) and B (2 of 3 wrong,
 * mixed up with C).
 */
export function seedPractice(childId: number): SeededPractice {
	return withDb((db) => {
		const words = db
			.prepare(
				`select w.id, w.word, w.definition from word w join word_list l on l.id = w.list_id
				 where l.grade = 3 order by w.id limit 5`
			)
			.all() as SeededPractice['words'];
		const [a, b, c, d, e] = words;

		const addSession = db.prepare(
			`insert into practice_session
			   (child_id, started_at, ended_at, active_ms, question_count, completed, plan_json)
			 values (?, ?, ?, ?, ?, ?, '[]')`
		);
		const addQuestion = db.prepare(
			`insert into question (practice_session_id, word_id, type, choices_json, correct_choice, served_at)
			 values (?, ?, ?, ?, ?, ?)`
		);
		const addAnswer = db.prepare(
			`insert into answer (question_id, chosen, is_correct, response_ms, is_retry, answered_at)
			 values (?, ?, ?, ?, ?, ?)`
		);

		type Ask = {
			word: SeededPractice['words'][number];
			type: string;
			chosen?: string;
			retry?: boolean;
		};
		const session = (startedAt: number, activeMs: number, completed: boolean, asks: Ask[]) => {
			const id = addSession.run(
				childId,
				startedAt,
				startedAt + activeMs,
				activeMs,
				asks.length,
				completed ? 1 : 0
			).lastInsertRowid as number;
			asks.forEach((ask, index) => {
				const right = ask.type === 'word_to_def' ? ask.word.definition : ask.word.word;
				const at = startedAt + (index + 1) * 20_000;
				const questionId = addQuestion.run(
					id,
					ask.word.id,
					ask.type,
					JSON.stringify(ask.type === 'spell' ? [] : [right, c.definition]),
					right,
					at - 4000
				).lastInsertRowid;
				addAnswer.run(
					questionId,
					ask.chosen ?? right,
					ask.chosen === undefined ? 1 : 0,
					4000,
					ask.retry ? 1 : 0,
					at
				);
			});
			return id;
		};

		const now = Date.now();
		const sessions: SeededPractice['sessions'] = [
			session(noon(3), 240_000, true, [
				{ word: a, type: 'word_to_def' },
				{ word: b, type: 'word_to_def', chosen: c.definition },
				{ word: c, type: 'word_to_def' },
				{ word: b, type: 'word_to_def', retry: true }
			]),
			session(noon(1), 180_000, true, [
				{ word: a, type: 'def_to_word' },
				{ word: b, type: 'word_to_def', chosen: c.definition },
				{ word: d, type: 'word_to_def' }
			]),
			session(noon(0), 60_000, false, [
				{ word: e, type: 'spell', chosen: NASTY_ANSWER },
				{ word: e, type: 'spell', chosen: FORMULA_ANSWER, retry: true }
			])
		];

		const place = db.prepare(
			`insert into word_progress
			   (child_id, word_id, box, due_at, times_seen, times_correct, first_seen_at)
			 values (?, ?, ?, ?, ?, ?, ?)`
		);
		const boxes: [number, number, number, number][] = [
			[a.id, 3, 2, 2],
			[b.id, 1, 3, 1],
			[c.id, 2, 1, 1],
			[d.id, 2, 1, 1],
			[e.id, 1, 2, 0]
		];
		for (const [wordId, box, seen, correct] of boxes) {
			place.run(childId, wordId, box, now + DAY_MS, seen, correct, now - 3 * DAY_MS);
		}

		return { sessions, words };
	});
}

/** Puts the first `count` words of a grade at box 4 for a child. */
export function knowWords(childId: number, grade: number, count: number) {
	withDb((db) =>
		db
			.prepare(
				`insert or replace into word_progress
				   (child_id, word_id, box, due_at, times_seen, times_correct, first_seen_at)
				 select ?, w.id, 4, ?, 4, 4, ?
				 from word w join word_list l on l.id = w.list_id
				 where l.grade = ? order by w.id limit ?`
			)
			.run(childId, Date.now() + DAY_MS, Date.now() - 30 * DAY_MS, grade, count)
	);
}
