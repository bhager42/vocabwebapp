// The weekly summary email: the parent's settings for it, sending it through Gmail, and
// the hourly check that sends it on Monday morning. See PLAN.md Phase 11.
//
// Email is the app's only outbound connection. It is off until the parent turns it on,
// and it connects only to smtp.gmail.com. The Gmail account and app password come from
// environment variables, never from the database, so they are never in a backup.
//
// This module has no SvelteKit imports, so it can be used from unit tests.

import { eq } from 'drizzle-orm';
import nodemailer, { type Transporter } from 'nodemailer';
import * as v from 'valibot';
import type { Db } from './db/client.ts';
import { setting } from './db/schema.ts';
import { lastWeek, renderHtml, renderText, subject, weekday, weeklySummary } from './summary.ts';
import { localDayKey, localHour } from './time.ts';
import { checkbox } from './validation.ts';

/** Monday at this hour or later, on the app's clock. */
export const SEND_HOUR = 7;
/** Failed sends of one week's summary are tried this many times, an hour apart. */
export const MAX_TRIES = 6;
const HOUR_MS = 60 * 60_000;

// ---- Settings ----

const KEYS = {
	enabled: 'summary.enabled',
	to: 'summary.to',
	lastWeek: 'summary.lastWeek',
	lastSentAt: 'summary.lastSentAt',
	lastError: 'summary.lastError',
	/** `<week>:<count>`, so the count starts again each week. */
	tries: 'summary.tries'
} as const;

function read(db: Db, key: string): string | null {
	return db.select().from(setting).where(eq(setting.key, key)).get()?.value ?? null;
}

function write(db: Db, key: string, value: string | null): void {
	if (value === null) {
		db.delete(setting).where(eq(setting.key, key)).run();
		return;
	}
	db.insert(setting)
		.values({ key, value })
		.onConflictDoUpdate({ target: setting.key, set: { value } })
		.run();
}

export interface SummarySettings {
	enabled: boolean;
	to: string;
	/** The Monday of the last week sent, `YYYY-MM-DD`. */
	lastWeek: string | null;
	lastSentAt: Date | null;
	lastError: string | null;
}

export function getSummarySettings(db: Db): SummarySettings {
	const sentAt = read(db, KEYS.lastSentAt);
	return {
		enabled: read(db, KEYS.enabled) === 'true',
		to: read(db, KEYS.to) ?? '',
		lastWeek: read(db, KEYS.lastWeek),
		lastSentAt: sentAt ? new Date(Number(sentAt)) : null,
		lastError: read(db, KEYS.lastError)
	};
}

export const summarySettingsSchema = v.pipe(
	v.object({
		enabled: checkbox,
		to: v.pipe(v.optional(v.string(), ''), v.trim(), v.maxLength(254, 'That address is too long.'))
	}),
	v.forward(
		v.check((input) => !input.enabled || input.to !== '', 'Enter the address to send to.'),
		['to']
	),
	v.forward(
		v.check(
			(input) => input.to === '' || v.is(v.pipe(v.string(), v.email()), input.to),
			'Enter an email address, such as you@example.com.'
		),
		['to']
	)
);

/**
 * Saves the parent's choices. Turning email on counts last week as already sent, so the
 * first summary is the one due next Monday rather than one sent straight away. "Send a
 * test email now" shows what it will look like.
 */
export function saveSummarySettings(
	db: Db,
	input: { enabled: boolean; to: string },
	now: Date,
	timeZone: string
): void {
	db.transaction(() => {
		const wasEnabled = read(db, KEYS.enabled) === 'true';
		write(db, KEYS.enabled, String(input.enabled));
		write(db, KEYS.to, input.to || null);
		if (input.enabled && !wasEnabled) {
			write(db, KEYS.lastWeek, lastWeek(now, timeZone).firstDay);
			write(db, KEYS.lastError, null);
		}
	});
}

// ---- Sending ----

export interface MailConfig {
	user: string;
	pass: string;
}

export interface Message {
	to: string;
	subject: string;
	text: string;
	html: string;
}

/** Sends a message. What it resolves to depends on the transport; callers ignore it. */
export type Send = (message: Message) => Promise<unknown>;

/**
 * Sends through Gmail: TLS from the first byte on port 465, with the server's
 * certificate checked. `transport` is for tests, which never contact Gmail.
 */
export function gmailSender(config: MailConfig, transport?: Transporter): Send {
	const mailer =
		transport ??
		nodemailer.createTransport({
			host: 'smtp.gmail.com',
			port: 465,
			secure: true,
			auth: { user: config.user, pass: config.pass },
			tls: { rejectUnauthorized: true, minVersion: 'TLSv1.2' },
			connectionTimeout: 30_000,
			greetingTimeout: 30_000,
			socketTimeout: 60_000
		});
	return (message) =>
		mailer.sendMail({ from: { name: 'Vocab', address: config.user }, ...message });
}

/** A message safe to show and store: never the password, and not too long. */
export function describeError(cause: unknown, config?: MailConfig): string {
	let text = cause instanceof Error ? cause.message : String(cause);
	if (config?.pass) text = text.replaceAll(config.pass, '[hidden]');
	if (/\b535\b|Username and Password not accepted|Invalid login/i.test(text)) {
		text = `Gmail did not accept the sign-in. Check GMAIL_USER and GMAIL_APP_PASSWORD. (${text})`;
	}
	return text.slice(0, 300);
}

export function buildMessage(db: Db, to: string, now: Date, timeZone: string, origin?: string) {
	const summary = weeklySummary(db, now, timeZone);
	return {
		summary,
		message: {
			to,
			subject: subject(summary),
			text: renderText(summary, origin),
			html: renderHtml(summary, origin)
		}
	};
}

// ---- When to send ----

export interface WeeklyDeps {
	now: Date;
	timeZone: string;
	origin?: string;
	send: Send;
	config?: MailConfig;
}

/**
 * Sends last week's summary if it is due. Returns what happened.
 * - off: email is off or has no address.
 * - early: it is Monday before 7:00.
 * - sent-already: last week's summary went out already.
 * - gave-up: this week's tries have all failed.
 * - sent / failed: it was tried just now.
 */
export async function runWeekly(
	db: Db,
	deps: WeeklyDeps
): Promise<'off' | 'early' | 'sent-already' | 'gave-up' | 'sent' | 'failed'> {
	const { now, timeZone } = deps;
	const settings = getSummarySettings(db);
	if (!settings.enabled || !settings.to) return 'off';

	const week = lastWeek(now, timeZone).firstDay;
	if (settings.lastWeek !== null && settings.lastWeek >= week) return 'sent-already';
	const today = localDayKey(now, timeZone);
	if (weekday(today) === 0 && localHour(now, timeZone) < SEND_HOUR) return 'early';

	const [triedWeek, triedCount] = (read(db, KEYS.tries) ?? '').split(':');
	const tries = triedWeek === week ? Number(triedCount) || 0 : 0;
	if (tries >= MAX_TRIES) return 'gave-up';

	try {
		const { message } = buildMessage(db, settings.to, now, timeZone, deps.origin);
		await deps.send(message);
	} catch (cause) {
		write(db, KEYS.tries, `${week}:${tries + 1}`);
		write(db, KEYS.lastError, describeError(cause, deps.config));
		return 'failed';
	}
	db.transaction(() => {
		write(db, KEYS.lastWeek, week);
		write(db, KEYS.lastSentAt, String(now.getTime()));
		write(db, KEYS.lastError, null);
		write(db, KEYS.tries, null);
	});
	return 'sent';
}

/**
 * "Send a test email now": sends last week's summary straight away to the saved
 * address. It does not count as the week's summary.
 */
export async function sendTest(
	db: Db,
	to: string,
	deps: Omit<WeeklyDeps, 'config'> & { config?: MailConfig }
): Promise<{ ok: true } | { ok: false; error: string }> {
	try {
		const { message } = buildMessage(db, to, deps.now, deps.timeZone, deps.origin);
		await deps.send({ ...message, subject: `${message.subject} (test)` });
		return { ok: true };
	} catch (cause) {
		return { ok: false, error: describeError(cause, deps.config) };
	}
}

/**
 * Checks once an hour whether the weekly summary is due, starting two minutes after the
 * app does. A failure is logged and tried again the next hour; it never stops the app.
 */
export function scheduleWeekly(db: Db, deps: () => WeeklyDeps): () => void {
	let running = false;
	const check = async () => {
		if (running) return;
		running = true;
		try {
			const result = await runWeekly(db, deps());
			if (result === 'sent') console.log('Weekly summary email sent.');
			if (result === 'failed') {
				console.error(`Weekly summary email failed: ${getSummarySettings(db).lastError}`);
			}
		} catch (cause) {
			console.error('Weekly summary check failed:', describeError(cause, deps().config));
		} finally {
			running = false;
		}
	};
	const first = setTimeout(check, 2 * 60_000);
	const hourly = setInterval(check, HOUR_MS);
	first.unref();
	hourly.unref();
	return () => {
		clearTimeout(first);
		clearInterval(hourly);
	};
}
