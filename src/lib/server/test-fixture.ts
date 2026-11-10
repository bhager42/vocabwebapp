// A small, fixed history of practice for unit tests. Every number the metric tests expect
// was worked out by hand from the tables in this comment.
//
// The clock: "now" is 4pm on Tuesday 10 November 2026 in Chicago (22:00 UTC). Chicago
// left daylight saving time on 1 November, so October times are UTC-5 and November UTC-6.
//
// Sam's sessions (✓ right, ✗ wrong, "again" = asked again in the same session):
//
//   S1  Tue 20 Oct, 5pm   finished       5 min active
//       w1 meaning ✓ 4.0s | w2 meaning ✗ 1.0s (picked w3's) | w3 meaning ✓ 5.0s
//       w2 meaning again ✓ 3.0s
//   S2  Wed 4 Nov, 4pm    finished       4 min active
//       w1 word ✓ 6.0s | w2 meaning ✗ 1.2s (picked w3's) | w4 meaning ✓ 2.0s
//       w2 meaning again ✗ 8.0s (picked w5's)
//   S3  Mon 9 Nov, 9am    stopped early  1 min active
//       w3 word ✗ 2.5s (picked w1) | w4 meaning ✓ 3.0s
//   S4  Tue 10 Nov, 3:50pm  still open   30 s active
//       w5 spell ✗ 0.9s (typed "gw5") | w1 blank ✓ 7.0s
//
// Sam's boxes: w1 box 3, w2 box 1, w3 box 4, w4 mastered, w5 box 1. Grade 3 has ten
// active words (w1 to w10) and one switched off (w11); grade 4 has five, none started.
//
// Mia has one finished session today with one right answer. Nothing of hers may ever
// show up in Sam's figures.

import { createChild } from './children.ts';
import type { Db } from './db/client.ts';
import {
	answer,
	practiceSession,
	question,
	word,
	wordList,
	wordProgress,
	type QuestionType
} from './db/schema.ts';

export const CHICAGO = 'America/Chicago';
export const NOW = new Date('2026-11-10T22:00:00Z');

type Ask = [
	word: string,
	type: QuestionType,
	correct: boolean,
	responseMs: number,
	extra?: { retry?: boolean; chosen?: string }
];

export interface Fixture {
	sam: number;
	mia: number;
	/** Word ids by name: w1 to w11 in grade 3, v1 to v5 in grade 4. */
	words: Record<string, number>;
	/** Sam's sessions S1 to S4, then Mia's. */
	sessions: number[];
}

export const definitionOf = (name: string) => `meaning of ${name}`;

export function buildFixture(db: Db): Fixture {
	const words: Record<string, number> = {};
	const addList = (grade: number, prefix: string, count: number) => {
		const list = db
			.insert(wordList)
			.values({ name: `Grade ${grade}`, grade, source: 'builtin' })
			.returning()
			.get();
		for (let index = 1; index <= count; index++) {
			const name = `${prefix}${index}`;
			words[name] = db
				.insert(word)
				.values({
					listId: list.id,
					word: name,
					partOfSpeech: 'adjective',
					definition: definitionOf(name),
					sentence: `It was a ${name} day.`,
					active: name !== 'w11'
				})
				.returning()
				.get().id;
		}
	};
	addList(3, 'w', 11);
	addList(4, 'v', 5);

	const child = (name: string) => {
		const result = createChild(db, { name, grade: 3 }, new Date('2026-10-01T12:00:00Z'));
		if (!result.ok) throw new Error('could not create child');
		return result.child.id;
	};
	const sam = child('Sam');
	const mia = child('Mia');

	const addSession = (
		childId: number,
		start: string,
		state: { activeMs: number; completed: boolean; open?: boolean },
		asks: Ask[]
	) => {
		const startedAt = new Date(start);
		const at = (index: number) => new Date(startedAt.getTime() + (index + 1) * 10_000);
		const session = db
			.insert(practiceSession)
			.values({
				childId,
				startedAt,
				endedAt: state.open ? null : at(asks.length),
				activeMs: state.activeMs,
				questionCount: asks.length,
				completed: state.completed
			})
			.returning()
			.get();

		asks.forEach(([name, type, correct, responseMs, extra], index) => {
			const right = type === 'word_to_def' ? definitionOf(name) : name;
			const asked = db
				.insert(question)
				.values({
					practiceSessionId: session.id,
					wordId: words[name],
					type,
					choicesJson: type === 'spell' ? [] : [right, 'other'],
					correctChoice: right,
					servedAt: new Date(at(index).getTime() - responseMs)
				})
				.returning()
				.get();
			db.insert(answer)
				.values({
					questionId: asked.id,
					chosen: correct ? right : (extra?.chosen ?? 'other'),
					isCorrect: correct,
					responseMs,
					isRetry: extra?.retry ?? false,
					answeredAt: at(index)
				})
				.run();
		});
		return session.id;
	};

	const sessions = [
		addSession(sam, '2026-10-20T22:00:00Z', { activeMs: 300_000, completed: true }, [
			['w1', 'word_to_def', true, 4000],
			['w2', 'word_to_def', false, 1000, { chosen: definitionOf('w3') }],
			['w3', 'word_to_def', true, 5000],
			['w2', 'word_to_def', true, 3000, { retry: true }]
		]),
		addSession(sam, '2026-11-04T22:00:00Z', { activeMs: 240_000, completed: true }, [
			['w1', 'def_to_word', true, 6000],
			['w2', 'word_to_def', false, 1200, { chosen: definitionOf('w3') }],
			['w4', 'word_to_def', true, 2000],
			['w2', 'word_to_def', false, 8000, { retry: true, chosen: definitionOf('w5') }]
		]),
		addSession(sam, '2026-11-09T15:00:00Z', { activeMs: 60_000, completed: false }, [
			['w3', 'def_to_word', false, 2500, { chosen: 'w1' }],
			['w4', 'word_to_def', true, 3000]
		]),
		addSession(sam, '2026-11-10T21:50:00Z', { activeMs: 30_000, completed: false, open: true }, [
			['w5', 'spell', false, 900, { chosen: 'gw5' }],
			['w1', 'cloze', true, 7000]
		]),
		addSession(mia, '2026-11-10T20:00:00Z', { activeMs: 99_000, completed: true }, [
			['w1', 'word_to_def', true, 100]
		])
	];

	const place = (
		childId: number,
		name: string,
		box: number,
		seen: [number, number],
		mastered = false
	) =>
		db
			.insert(wordProgress)
			.values({
				childId,
				wordId: words[name],
				box,
				dueAt: new Date('2026-11-12T06:00:00Z'),
				timesSeen: seen[0],
				timesCorrect: seen[1],
				firstSeenAt: new Date('2026-10-20T22:00:00Z'),
				masteredAt: mastered ? new Date('2026-11-09T15:00:20Z') : null
			})
			.run();
	place(sam, 'w1', 3, [3, 3]);
	place(sam, 'w2', 1, [4, 1]);
	place(sam, 'w3', 4, [2, 1]);
	place(sam, 'w4', 5, [2, 2], true);
	place(sam, 'w5', 1, [1, 0]);
	place(mia, 'w1', 2, [1, 1]);

	return { sam, mia, words, sessions };
}
