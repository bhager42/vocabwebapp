import nodemailer from 'nodemailer';
import * as v from 'valibot';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Db } from './db/client.ts';
import {
	describeError,
	getSummarySettings,
	gmailSender,
	MAX_TRIES,
	runWeekly,
	saveSummarySettings,
	sendTest,
	summarySettingsSchema,
	type Message
} from './email.ts';
import { createTestDb } from './test-db.ts';
import { buildFixture, CHICAGO } from './test-fixture.ts';

const CONFIG = { user: 'family.vocab@gmail.com', pass: 'abcdefghijklmnop' };
// Tuesday 17 November 2026, 4pm in Chicago.
const TUESDAY = new Date('2026-11-17T22:00:00Z');
// Monday 23 November: 6:59am and 7:00am in Chicago (UTC-6).
const MONDAY_EARLY = new Date('2026-11-23T12:59:00Z');
const MONDAY_SEVEN = new Date('2026-11-23T13:00:00Z');

let db: Db;
let close: () => void;
let sent: Message[];
const send = async (message: Message) => {
	sent.push(message);
};
const failing = (text: string) => async () => {
	throw new Error(text);
};
const deps = (now: Date, override: Partial<Parameters<typeof runWeekly>[1]> = {}) => ({
	now,
	timeZone: CHICAGO,
	origin: 'https://vocab.home.example',
	send,
	config: CONFIG,
	...override
});

beforeEach(() => {
	({ db, close } = createTestDb());
	buildFixture(db);
	sent = [];
});

afterEach(() => close());

describe('settings', () => {
	it('start off, with no address', () => {
		expect(getSummarySettings(db)).toEqual({
			enabled: false,
			to: '',
			lastWeek: null,
			lastSentAt: null,
			lastError: null
		});
	});

	it('check the form', () => {
		const parse = (input: Record<string, string>) => v.safeParse(summarySettingsSchema, input);
		expect(parse({ enabled: 'on', to: ' me@example.com ' }).output).toEqual({
			enabled: true,
			to: 'me@example.com'
		});
		expect(parse({ to: '' }).output).toEqual({ enabled: false, to: '' });
		expect(parse({ enabled: 'on', to: '' }).success).toBe(false);
		expect(parse({ to: 'not an address' }).success).toBe(false);
		expect(parse({ to: 'me@example.com\r\nBcc: someone@example.com' }).success).toBe(false);
	});

	it('count last week as sent when first turned on', () => {
		saveSummarySettings(db, { enabled: true, to: 'me@example.com' }, TUESDAY, CHICAGO);
		expect(getSummarySettings(db)).toMatchObject({
			enabled: true,
			to: 'me@example.com',
			lastWeek: '2026-11-09'
		});
	});
});

describe('runWeekly', () => {
	beforeEach(() => {
		saveSummarySettings(db, { enabled: true, to: 'me@example.com' }, TUESDAY, CHICAGO);
	});

	it('sends nothing while off', async () => {
		saveSummarySettings(db, { enabled: false, to: 'me@example.com' }, TUESDAY, CHICAGO);
		expect(await runWeekly(db, deps(MONDAY_SEVEN))).toBe('off');
		expect(sent).toEqual([]);
	});

	it('waits for the next Monday after being turned on', async () => {
		expect(await runWeekly(db, deps(TUESDAY))).toBe('sent-already');
	});

	it('sends on Monday at 7:00 local time, not before', async () => {
		expect(await runWeekly(db, deps(MONDAY_EARLY))).toBe('early');
		expect(await runWeekly(db, deps(MONDAY_SEVEN))).toBe('sent');
		expect(sent).toHaveLength(1);
		expect(sent[0].to).toBe('me@example.com');
		expect(sent[0].subject).toBe('Vocab: the week of Nov 16');
		expect(getSummarySettings(db)).toMatchObject({
			lastWeek: '2026-11-16',
			lastSentAt: MONDAY_SEVEN,
			lastError: null
		});
	});

	it('never sends the same week twice, even after a restart', async () => {
		await runWeekly(db, deps(MONDAY_SEVEN));
		// A restart reads everything from the database again; nothing is kept in memory.
		expect(await runWeekly(db, deps(new Date(MONDAY_SEVEN.getTime() + 3_600_000)))).toBe(
			'sent-already'
		);
		expect(sent).toHaveLength(1);
	});

	it('catches up later in the week if the app was off on Monday', async () => {
		expect(await runWeekly(db, deps(new Date('2026-11-25T15:00:00Z')))).toBe('sent');
	});

	it('retries a failed send, hides the password and gives up after six tries', async () => {
		const broken = failing(`535 Invalid login for ${CONFIG.user} with ${CONFIG.pass}`);
		for (let attempt = 0; attempt < MAX_TRIES; attempt++) {
			const at = new Date(MONDAY_SEVEN.getTime() + attempt * 3_600_000);
			expect(await runWeekly(db, deps(at, { send: broken }))).toBe('failed');
		}
		const error = getSummarySettings(db).lastError!;
		expect(error).toContain('Gmail did not accept the sign-in');
		expect(error).not.toContain(CONFIG.pass);
		expect(await runWeekly(db, deps(new Date('2026-11-24T13:00:00Z')))).toBe('gave-up');

		// The next week starts afresh, and a success clears the error.
		expect(await runWeekly(db, deps(new Date('2026-11-30T13:00:00Z')))).toBe('sent');
		expect(getSummarySettings(db).lastError).toBeNull();
	});
});

describe('sendTest', () => {
	it('sends now, marked as a test, without counting as the week', async () => {
		saveSummarySettings(db, { enabled: true, to: 'me@example.com' }, TUESDAY, CHICAGO);
		expect(await sendTest(db, 'me@example.com', deps(TUESDAY))).toEqual({ ok: true });
		expect(sent[0].subject).toBe('Vocab: the week of Nov 9 (test)');
		expect(getSummarySettings(db).lastSentAt).toBeNull();
	});

	it('reports a failure without the password', async () => {
		const result = await sendTest(
			db,
			'me@example.com',
			deps(TUESDAY, { send: failing(`oops ${CONFIG.pass}`) })
		);
		expect(result).toEqual({ ok: false, error: 'oops [hidden]' });
	});
});

describe('gmailSender', () => {
	it('builds a message from the Gmail account, in text and HTML', async () => {
		// The stream transport writes the message out instead of connecting to anything.
		const transport = nodemailer.createTransport({ streamTransport: true, buffer: true });
		const info = (await gmailSender(
			CONFIG,
			transport
		)({
			to: 'me@example.com',
			subject: 'Vocab: the week of Nov 9',
			text: 'Hello',
			html: '<p>Hello</p>'
		})) as { message: Buffer };
		const raw = info.message.toString();
		expect(raw).toMatch(/^From: Vocab <family\.vocab@gmail\.com>$/m);
		expect(raw).toMatch(/^To: me@example\.com$/m);
		expect(raw).toMatch(/^Subject: Vocab: the week of Nov 9$/m);
		expect(raw).toContain('text/plain');
		expect(raw).toContain('text/html');
		expect(raw).not.toContain(CONFIG.pass);
	});
});

describe('describeError', () => {
	it('keeps messages short', () => {
		expect(describeError(new Error('x'.repeat(1000)))).toHaveLength(300);
	});
});
