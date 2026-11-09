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
		settingsJson: text('settings_json', { mode: 'json' })
			.$type<Record<string, unknown>>()
			.notNull()
			.default({}),
		createdAt: timestamp('created_at').notNull(),
		archivedAt: timestamp('archived_at')
	},
	(t) => [check('child_grade_range', sql`${t.grade} between 1 and 12`)]
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
		completed: boolean('completed').notNull().default(false)
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
		ip: text('ip').notNull(),
		at: timestamp('at').notNull(),
		success: boolean('success').notNull()
	},
	(t) => [index('login_attempt_ip_idx').on(t.ip, t.at)]
);

export const setting = sqliteTable('setting', {
	key: text('key').primaryKey(),
	value: text('value').notNull()
});
