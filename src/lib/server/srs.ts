// Spaced repetition with Leitner boxes. See PLAN.md section 2.2.
//
// Each child/word pair sits in a box from 1 to 5. A correct answer moves the word up a
// box and makes it wait longer before it is asked again; a wrong answer sends it back to
// box 1. This module is pure: it decides, and practice.ts writes the result down.

import { startOfLocalDay } from './time.ts';

export const MAX_BOX = 5;

/** Days a word waits after landing in each box. */
export const BOX_INTERVAL_DAYS: Record<number, number> = { 1: 1, 2: 1, 3: 3, 4: 7, 5: 21 };

/** Mastered words still come back now and then, so they are not forgotten. */
export const MASTERED_INTERVAL_DAYS = 60;

export interface WordState {
	box: number;
	dueAt: Date;
	mastered: boolean;
}

export interface AnswerContext {
	correct: boolean;
	/** False when this word was already asked earlier in the same session. */
	firstAskInSession: boolean;
	now: Date;
	timeZone: string;
}

export interface Outcome extends WordState {
	change: 'introduced' | 'promoted' | 'mastered' | 'demoted' | 'unchanged';
}

/**
 * Works out where a word goes after an answer.
 *
 * @param state the word's current box, or null if the child has never seen it.
 *
 * - Wrong: back to box 1, due tomorrow. (It is also asked again later in the session;
 *   that is the session plan's job, not this function's.)
 * - Correct, and the word was due and not yet asked this session: up one box. A correct
 *   answer out of box 5 makes the word mastered.
 * - Correct, but asked early or for the second time in a session: nothing changes.
 *   Getting it right twice in five minutes is not evidence of remembering it.
 */
export function applyAnswer(state: WordState | null, context: AnswerContext): Outcome {
	const { correct, firstAskInSession, now, timeZone } = context;
	const dueIn = (days: number) => startOfLocalDay(now, timeZone, days);

	if (!state) {
		// A new word starts in box 1; a right first answer moves it straight to box 2.
		const box = correct ? 2 : 1;
		return { box, dueAt: dueIn(BOX_INTERVAL_DAYS[box]), mastered: false, change: 'introduced' };
	}

	if (!correct) {
		return {
			box: 1,
			dueAt: dueIn(BOX_INTERVAL_DAYS[1]),
			mastered: false,
			change: state.box === 1 ? 'unchanged' : 'demoted'
		};
	}

	const counts = firstAskInSession && state.dueAt.getTime() <= now.getTime();
	if (!counts) return { ...state, change: 'unchanged' };

	if (state.box >= MAX_BOX) {
		return {
			box: MAX_BOX,
			dueAt: dueIn(MASTERED_INTERVAL_DAYS),
			mastered: true,
			change: state.mastered ? 'unchanged' : 'mastered'
		};
	}

	const box = state.box + 1;
	return { box, dueAt: dueIn(BOX_INTERVAL_DAYS[box]), mastered: false, change: 'promoted' };
}
