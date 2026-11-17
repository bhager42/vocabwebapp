import { GMAIL_APP_PASSWORD, GMAIL_USER } from '$app/env/private';
import { gmailSender, type MailConfig, type Send } from './email.ts';

/** The Gmail account to send from, or null when email has not been set up. */
export function mailConfig(): MailConfig | null {
	return GMAIL_USER && GMAIL_APP_PASSWORD ? { user: GMAIL_USER, pass: GMAIL_APP_PASSWORD } : null;
}

let sender: Send | undefined;

/** The shared Gmail sender. Only call this when mailConfig() is not null. */
export function getSender(config: MailConfig): Send {
	sender ??= gmailSender(config);
	return sender;
}
