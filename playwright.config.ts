import { defineConfig, devices } from '@playwright/test';

const PORT = 4173;
const ORIGIN = `http://localhost:${PORT}`;

// End-to-end tests run against the real production entry point (server.js),
// with a throwaway database under .tmp/.
export default defineConfig({
	testDir: 'tests/e2e',
	testMatch: '**/*.e2e.ts',
	forbidOnly: !!process.env.CI,
	// The tests share one server and one database, and some of them change who is signed
	// up or locked out, so they run one at a time.
	workers: 1,
	use: { baseURL: ORIGIN },
	projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
	webServer: {
		command: 'rm -rf .tmp/e2e-data && npm run build && node server.js',
		url: `${ORIGIN}/healthz`,
		reuseExistingServer: false,
		env: {
			ORIGIN,
			PORT: String(PORT),
			HOST: '127.0.0.1',
			DATA_DIR: '.tmp/e2e-data',
			SETUP_TOKEN: 'e2e-setup-token'
		}
	}
});
