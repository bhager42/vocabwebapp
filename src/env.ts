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
	TRUST_PROXY: {
		description: 'Whether to read the client IP from X-Forwarded-For (behind a reverse proxy).',
		schema: (value) => {
			if (value === undefined || value === '' || value === 'false') return false;
			if (value === 'true') return true;
			throw new Error('TRUST_PROXY must be "true" or "false"');
		}
	}
});
