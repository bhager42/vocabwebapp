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
