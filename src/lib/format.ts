// Turning numbers into text for the parent pages. No dates here: those are formatted on
// the server in the app's time zone (see lib/server/time.ts).

/** A share from 0 to 1 as "85%". A missing value is shown as a dash. */
export function percent(share: number | null): string {
	return share === null ? '–' : `${Math.round(share * 100)}%`;
}

/** A length of time as "45 sec", "12 min" or "1 h 5 min". */
export function duration(ms: number): string {
	const seconds = Math.round(ms / 1000);
	if (seconds < 60) return `${seconds} sec`;
	const minutes = Math.round(seconds / 60);
	if (minutes < 60) return `${minutes} min`;
	const rest = minutes % 60;
	return rest === 0 ? `${Math.floor(minutes / 60)} h` : `${Math.floor(minutes / 60)} h ${rest} min`;
}

/** Thinking time as "3.2 sec". A missing value is shown as a dash. */
export function seconds(ms: number | null): string {
	return ms === null ? '–' : `${(ms / 1000).toFixed(1)} sec`;
}

/** "1 day", "2 days". */
export function plural(count: number, one: string, many = `${one}s`): string {
	return `${count} ${count === 1 ? one : many}`;
}

export const QUESTION_TYPE_LABELS = {
	word_to_def: 'Pick the meaning',
	def_to_word: 'Pick the word',
	cloze: 'Fill in the blank',
	spell: 'Spell the word'
} as const;

export const STAGE_LABELS = {
	fresh: 'Not started',
	learning: 'Learning',
	almost: 'Almost there',
	mastered: 'Mastered'
} as const;
