import { defineEnvVars } from '@sveltejs/kit/env';

// All variables are private (server-only) and read when the app starts.
// See PLAN.md section 6.1.
export const variables = defineEnvVars({
	ORIGIN: {
		description:
			'The exact origin the app is reached at, e.g. https://vocab.home.example. Required in production (enforced by server.js); unset in development.',
		schema: (value) => {
			if (!value) return undefined;
			const url = new URL(value);
			if (url.protocol !== 'http:' && url.protocol !== 'https:') {
				throw new Error('ORIGIN must start with http:// or https://');
			}
			if (url.origin !== value.replace(/\/$/, '')) {
				throw new Error('ORIGIN must be an origin only, with no path, query or credentials');
			}
			return url.origin;
		}
	},
	DATA_DIR: {
		description: 'Directory holding the SQLite database and backups.',
		schema: (value) => value || './data'
	},
	SETUP_TOKEN: {
		description: 'One-time token required to create the parent account on first run.',
		schema: (value) => value || undefined
	},
	GMAIL_USER: {
		description:
			'Gmail address the weekly summary email is sent from. Optional; email stays off without it.',
		schema: (value) => {
			if (!value) return undefined;
			if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
				throw new Error('GMAIL_USER must be an email address');
			}
			return value;
		}
	},
	GMAIL_APP_PASSWORD: {
		description:
			"The Gmail account's 16-letter Google app password. Optional; email stays off without it.",
		// Google shows app passwords in groups of four with spaces; either way works.
		schema: (value) => value?.replace(/\s+/g, '') || undefined
	},
	TRUST_PROXY: {
		description: 'Whether to read the client IP from X-Forwarded-For (behind a reverse proxy).',
		schema: (value) => {
			if (value === undefined || value === '' || value === 'false') return false;
			if (value === 'true') return true;
			throw new Error('TRUST_PROXY must be "true" or "false"');
		}
	}
});
