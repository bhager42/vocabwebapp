import { sql } from 'drizzle-orm';
import {
	check,
	index,
	integer,
	primaryKey,
	sqliteTable,
	text,
	uniqueIndex
} from 'drizzle-orm/sqlite-core';

// All timestamps are stored as integer milliseconds since the Unix epoch (UTC).
const timestamp = (name: string) => integer(name, { mode: 'timestamp_ms' });
const boolean = (name: string) => integer(name, { mode: 'boolean' });

export const QUESTION_TYPES = ['word_to_def', 'def_to_word', 'cloze', 'spell'] as const;
export type QuestionType = (typeof QUESTION_TYPES)[number];

/** One planned question in a practice session. */
export interface PlanItem {
	wordId: number;
	type: QuestionType;
}

/** The single parent (admin) account. */
export const parent = sqliteTable('parent', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	username: text('username').notNull().unique(),
	passwordHash: text('password_hash').notNull(),
	createdAt: timestamp('created_at').notNull()
});

export const child = sqliteTable(
	'child',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		name: text('name').notNull(),
		/** Trimmed, lower-cased name used to match what the child types. */
		nameNormalized: text('name_normalized').notNull().unique(),
		grade: integer('grade').notNull().default(3),
		/** Grade of the reading stories, kept apart from the word grade (PLAN.md Phase 12). */
		readingGrade: integer('reading_grade').notNull().default(3),
		settingsJson: text('settings_json', { mode: 'json' })
			.$type<Record<string, unknown>>()
			.notNull()
			.default({}),
		createdAt: timestamp('created_at').notNull(),
		archivedAt: timestamp('archived_at')
	},
	(t) => [
		check('child_grade_range', sql`${t.grade} between 1 and 12`),
		check('child_reading_grade_range', sql`${t.readingGrade} between 1 and 12`)
	]
);

export const authSession = sqliteTable(
	'auth_session',
	{
		/** SHA-256 of the 256-bit random session token. The token itself is never stored. */
		tokenHash: text('token_hash').primaryKey(),
		kind: text('kind', { enum: ['parent', 'child'] }).notNull(),
		/** `parent.id` or `child.id`, depending on `kind`. */
		subjectId: integer('subject_id').notNull(),
		createdAt: timestamp('created_at').notNull(),
		expiresAt: timestamp('expires_at').notNull(),
		lastSeenAt: timestamp('last_seen_at').notNull()
	},
	(t) => [
		index('auth_session_expires_idx').on(t.expiresAt),
		index('auth_session_subject_idx').on(t.kind, t.subjectId)
	]
);

export const wordList = sqliteTable('word_list', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	name: text('name').notNull(),
	grade: integer('grade').notNull(),
	source: text('source', { enum: ['builtin', 'custom'] }).notNull(),
	active: boolean('active').notNull().default(true)
});

export const word = sqliteTable(
	'word',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		listId: integer('list_id')
			.notNull()
			.references(() => wordList.id, { onDelete: 'cascade' }),
		word: text('word').notNull(),
		partOfSpeech: text('part_of_speech').notNull(),
		definition: text('definition').notNull(),
		sentence: text('sentence').notNull(),
		synonymsJson: text('synonyms_json', { mode: 'json' }).$type<string[]>().notNull().default([]),
		active: boolean('active').notNull().default(true)
	},
	(t) => [uniqueIndex('word_list_word_unique').on(t.listId, t.word)]
);

/** Leitner box state for one child and one word. */
export const wordProgress = sqliteTable(
	'word_progress',
	{
		childId: integer('child_id')
			.notNull()
			.references(() => child.id, { onDelete: 'cascade' }),
		wordId: integer('word_id')
			.notNull()
			.references(() => word.id, { onDelete: 'cascade' }),
		box: integer('box').notNull().default(1),
		dueAt: timestamp('due_at').notNull(),
		timesSeen: integer('times_seen').notNull().default(0),
		timesCorrect: integer('times_correct').notNull().default(0),
		firstSeenAt: timestamp('first_seen_at').notNull(),
		masteredAt: timestamp('mastered_at')
	},
	(t) => [
		primaryKey({ columns: [t.childId, t.wordId] }),
		index('word_progress_due_idx').on(t.childId, t.dueAt),
		check('word_progress_box_range', sql`${t.box} between 1 and 5`)
	]
);

export const practiceSession = sqliteTable(
	'practice_session',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		childId: integer('child_id')
			.notNull()
			.references(() => child.id, { onDelete: 'cascade' }),
		startedAt: timestamp('started_at').notNull(),
		endedAt: timestamp('ended_at'),
		/** Sum of gaps between events, each gap capped (see PLAN.md section 5). */
		activeMs: integer('active_ms').notNull().default(0),
		questionCount: integer('question_count').notNull().default(0),
		completed: boolean('completed').notNull().default(false),
		/**
		 * The questions this session will ask, in order. Decided when the session starts;
		 * a missed word is added again further along. The next one to serve is the item at
		 * the index equal to the number of questions served so far.
		 */
		planJson: text('plan_json', { mode: 'json' }).$type<PlanItem[]>().notNull().default([])
	},
	(t) => [index('practice_session_child_idx').on(t.childId, t.startedAt)]
);

/**
 * Written when a question is served. Holds the correct answer on the server so the
 * browser only ever receives the question id and the shuffled choices.
 */
export const question = sqliteTable(
	'question',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		practiceSessionId: integer('practice_session_id')
			.notNull()
			.references(() => practiceSession.id, { onDelete: 'cascade' }),
		wordId: integer('word_id')
			.notNull()
			.references(() => word.id, { onDelete: 'restrict' }),
		type: text('type', { enum: QUESTION_TYPES }).notNull(),
		choicesJson: text('choices_json', { mode: 'json' }).$type<string[]>().notNull(),
		correctChoice: text('correct_choice').notNull(),
		servedAt: timestamp('served_at').notNull()
	},
	(t) => [
		index('question_session_idx').on(t.practiceSessionId),
		index('question_word_idx').on(t.wordId)
	]
);

/** At most one answer per served question. */
export const answer = sqliteTable('answer', {
	questionId: integer('question_id')
		.primaryKey()
		.references(() => question.id, { onDelete: 'cascade' }),
	chosen: text('chosen').notNull(),
	isCorrect: boolean('is_correct').notNull(),
	responseMs: integer('response_ms').notNull(),
	/** True when the word was already asked earlier in the same session. */
	isRetry: boolean('is_retry').notNull().default(false),
	answeredAt: timestamp('answered_at').notNull()
});

export const loginAttempt = sqliteTable(
	'login_attempt',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		/** What was being attempted: a parent sign-in (or setup), or a child typing a name. */
		scope: text('scope', { enum: ['parent', 'name'] })
			.notNull()
			.default('parent'),
		ip: text('ip').notNull(),
		at: timestamp('at').notNull(),
		success: boolean('success').notNull()
	},
	(t) => [index('login_attempt_ip_idx').on(t.scope, t.ip, t.at)]
);

export const setting = sqliteTable('setting', {
	key: text('key').primaryKey(),
	value: text('value').notNull()
});

/**
 * A placement quiz: a few rounds of questions that find the grade a child should start
 * at. Kept apart from practice so it never moves words between boxes or counts toward
 * the dashboard. See PLAN.md Phase 11.
 */
export const placementQuiz = sqliteTable(
	'placement_quiz',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		childId: integer('child_id')
			.notNull()
			.references(() => child.id, { onDelete: 'cascade' }),
		startedAt: timestamp('started_at').notNull(),
		endedAt: timestamp('ended_at'),
		startGrade: integer('start_grade').notNull(),
		/** The suggested grade. Set when the quiz is finished. */
		resultGrade: integer('result_grade'),
		completed: boolean('completed').notNull().default(false),
		cancelled: boolean('cancelled').notNull().default(false)
	},
	(t) => [index('placement_quiz_child_idx').on(t.childId, t.startedAt)]
);

/** One question of a placement quiz, written when served and filled in when answered. */
export const placementAnswer = sqliteTable(
	'placement_answer',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		quizId: integer('quiz_id')
			.notNull()
			.references(() => placementQuiz.id, { onDelete: 'cascade' }),
		grade: integer('grade').notNull(),
		wordId: integer('word_id')
			.notNull()
			.references(() => word.id, { onDelete: 'restrict' }),
		choicesJson: text('choices_json', { mode: 'json' }).$type<string[]>().notNull(),
		correctChoice: text('correct_choice').notNull(),
		servedAt: timestamp('served_at').notNull(),
		/** What was picked; '' for "I don't know this one"; null until answered. */
		chosen: text('chosen'),
		isCorrect: boolean('is_correct'),
		answeredAt: timestamp('answered_at')
	},
	(t) => [index('placement_answer_quiz_idx').on(t.quizId)]
);

// ---- Reading (PLAN.md Phase 12) ----

export const READING_KINDS = [
	'literal',
	'inference',
	'vocabulary',
	'main_idea',
	'sequence'
] as const;
export type ReadingKind = (typeof READING_KINDS)[number];

/** A built-in reading story, seeded from content/reading at startup. */
export const readingStory = sqliteTable('reading_story', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	/** The id in the content file. Never changes once shipped. */
	slug: text('slug').notNull().unique(),
	grade: integer('grade').notNull(),
	title: text('title').notNull(),
	paragraphsJson: text('paragraphs_json', { mode: 'json' }).$type<string[]>().notNull(),
	/** The parent's on/off switch; also off for a story taken out of the content files. */
	active: boolean('active').notNull().default(true)
});

export const readingQuestion = sqliteTable(
	'reading_question',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		storyId: integer('story_id')
			.notNull()
			.references(() => readingStory.id, { onDelete: 'cascade' }),
		/** Order within the story, from 0. */
		position: integer('position').notNull(),
		kind: text('kind', { enum: READING_KINDS }).notNull(),
		prompt: text('prompt').notNull(),
		correct: text('correct').notNull(),
		wrongJson: text('wrong_json', { mode: 'json' }).$type<string[]>().notNull(),
		explanation: text('explanation').notNull(),
		/** Off for a question taken out of the content file. */
		active: boolean('active').notNull().default(true)
	},
	(t) => [uniqueIndex('reading_question_story_position').on(t.storyId, t.position)]
);

/** One child reading one story, from start to finish (or not). */
export const readingAttempt = sqliteTable(
	'reading_attempt',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		childId: integer('child_id')
			.notNull()
			.references(() => child.id, { onDelete: 'cascade' }),
		storyId: integer('story_id')
			.notNull()
			.references(() => readingStory.id, { onDelete: 'restrict' }),
		startedAt: timestamp('started_at').notNull(),
		endedAt: timestamp('ended_at'),
		completed: boolean('completed').notNull().default(false),
		/** Sum of gaps between events, each gap capped (see reading.ts). */
		activeMs: integer('active_ms').notNull().default(0)
	},
	(t) => [index('reading_attempt_child_idx').on(t.childId, t.startedAt)]
);

/**
 * A question served during an attempt. The correct answer is kept here, on the server,
 * and the browser receives only the shuffled choices until the child has answered.
 */
export const readingAnswer = sqliteTable(
	'reading_answer',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		attemptId: integer('attempt_id')
			.notNull()
			.references(() => readingAttempt.id, { onDelete: 'cascade' }),
		questionId: integer('question_id')
			.notNull()
			.references(() => readingQuestion.id, { onDelete: 'restrict' }),
		choicesJson: text('choices_json', { mode: 'json' }).$type<string[]>().notNull(),
		correctChoice: text('correct_choice').notNull(),
		servedAt: timestamp('served_at').notNull(),
		chosen: text('chosen'),
		isCorrect: boolean('is_correct'),
		responseMs: integer('response_ms'),
		answeredAt: timestamp('answered_at')
	},
	(t) => [index('reading_answer_attempt_idx').on(t.attemptId)]
);

/**
 * Stories a parent has asked the child to read again, once every story at the grade was
 * finished: those with a wrong answer the last time. A row goes when the story is
 * finished again, however it went.
 */
export const readingRetest = sqliteTable(
	'reading_retest',
	{
		childId: integer('child_id')
			.notNull()
			.references(() => child.id, { onDelete: 'cascade' }),
		storyId: integer('story_id')
			.notNull()
			.references(() => readingStory.id, { onDelete: 'cascade' }),
		addedAt: timestamp('added_at').notNull()
	},
	(t) => [primaryKey({ columns: [t.childId, t.storyId] })]
);
