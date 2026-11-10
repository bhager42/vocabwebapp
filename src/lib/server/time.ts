// Calendar-day arithmetic in the family's time zone. See PLAN.md sections 2.2 and 6.1.
//
// "Tomorrow" for a child means after they have slept, not 24 hours after the answer:
// a word practiced at 7pm on Monday is due first thing on Tuesday. So due dates, streaks
// and daily limits all work in whole local days, and every function here takes the time
// zone explicitly so it can be tested without changing the machine's clock settings.

/** The zone the app runs in: the TZ variable if set, otherwise the system's. */
export function appTimeZone(): string {
	return process.env.TZ || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
}

const formatters = new Map<string, Intl.DateTimeFormat>();

function wallClock(instantMs: number, timeZone: string) {
	let formatter = formatters.get(timeZone);
	if (!formatter) {
		formatter = new Intl.DateTimeFormat('en-US', {
			timeZone,
			hourCycle: 'h23',
			year: 'numeric',
			month: 'numeric',
			day: 'numeric',
			hour: 'numeric',
			minute: 'numeric',
			second: 'numeric'
		});
		formatters.set(timeZone, formatter);
	}
	const parts: Record<string, number> = {};
	for (const part of formatter.formatToParts(instantMs)) {
		if (part.type !== 'literal') parts[part.type] = Number(part.value);
	}
	return parts as {
		year: number;
		month: number;
		day: number;
		hour: number;
		minute: number;
		second: number;
	};
}

/** How far the zone's clock is ahead of UTC at this instant, in milliseconds. */
function offsetMs(instantMs: number, timeZone: string): number {
	const t = wallClock(instantMs, timeZone);
	const asIfUtc = Date.UTC(t.year, t.month - 1, t.day, t.hour, t.minute, t.second);
	return asIfUtc - Math.floor(instantMs / 1000) * 1000;
}

/** The instant a calendar day begins in the zone. Day overflow (such as day 32) is fine. */
function startOfDay(year: number, month: number, day: number, timeZone: string): Date {
	const midnightUtc = Date.UTC(year, month - 1, day);
	// The offset can differ on either side of a clock change, so correct twice.
	const first = midnightUtc - offsetMs(midnightUtc, timeZone);
	return new Date(midnightUtc - offsetMs(first, timeZone));
}

/** The start of the local day `days` after the day that contains `now` (0 means today). */
export function startOfLocalDay(now: Date, timeZone: string, days = 0): Date {
	const { year, month, day } = wallClock(now.getTime(), timeZone);
	return startOfDay(year, month, day + days, timeZone);
}

/** The local calendar date as `YYYY-MM-DD`. */
export function localDayKey(date: Date, timeZone: string): string {
	const { year, month, day } = wallClock(date.getTime(), timeZone);
	return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** Moves a `YYYY-MM-DD` key by a number of calendar days. */
export function shiftDayKey(key: string, days: number): string {
	const [year, month, day] = key.split('-').map(Number);
	return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

/**
 * How many days in a row ended with practice, counting back from today. A day without
 * practice breaks the streak, except that today does not count against it until it is over.
 */
export function currentStreak(practicedDays: Set<string>, todayKey: string): number {
	let day = practicedDays.has(todayKey) ? todayKey : shiftDayKey(todayKey, -1);
	let streak = 0;
	while (practicedDays.has(day)) {
		streak++;
		day = shiftDayKey(day, -1);
	}
	return streak;
}

/** The hour of the day on the zone's clock, 0 to 23. */
export function localHour(date: Date, timeZone: string): number {
	return wallClock(date.getTime(), timeZone).hour;
}

/** The longest run of consecutive days in the set. */
export function longestStreak(practicedDays: Set<string>): number {
	let longest = 0;
	for (const day of practicedDays) {
		// Only count from the first day of each run.
		if (practicedDays.has(shiftDayKey(day, -1))) continue;
		let length = 1;
		while (practicedDays.has(shiftDayKey(day, length))) length++;
		longest = Math.max(longest, length);
	}
	return longest;
}

/** Every `YYYY-MM-DD` key from `first` to `last`, both included. */
export function dayKeysBetween(first: string, last: string): string[] {
	const keys: string[] = [];
	for (let key = first; key <= last; key = shiftDayKey(key, 1)) keys.push(key);
	return keys;
}

// ---- Text for people ----
// Dates are turned into text on the server, in the app's time zone, so a page reads the
// same wherever the parent's browser happens to be.

const dayFormat = new Intl.DateTimeFormat('en-US', {
	timeZone: 'UTC',
	weekday: 'short',
	month: 'short',
	day: 'numeric'
});
const shortDayFormat = new Intl.DateTimeFormat('en-US', {
	timeZone: 'UTC',
	month: 'short',
	day: 'numeric'
});

const keyToUtc = (key: string) => new Date(`${key}T00:00:00Z`);

/** A `YYYY-MM-DD` key as "Tue, Nov 10". */
export const formatDay = (key: string) => dayFormat.format(keyToUtc(key));
/** A `YYYY-MM-DD` key as "Nov 10". */
export const formatShortDay = (key: string) => shortDayFormat.format(keyToUtc(key));

/** An instant as "Nov 10, 2026, 4:05 PM" on the zone's clock. */
export function formatDateTime(date: Date, timeZone: string): string {
	return new Intl.DateTimeFormat('en-US', {
		timeZone,
		year: 'numeric',
		month: 'short',
		day: 'numeric',
		hour: 'numeric',
		minute: '2-digit'
	}).format(date);
}

/** An hour of the day (0 to 23) as "4 PM". */
export function formatHour(hour: number): string {
	return `${hour % 12 || 12} ${hour < 12 ? 'AM' : 'PM'}`;
}
