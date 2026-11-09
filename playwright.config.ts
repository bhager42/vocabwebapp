import { defineConfig, devices } from '@playwright/test';

const PORT = 4173;
const ORIGIN = `http://localhost:${PORT}`;

// End-to-end tests run against the real production entry point (server.js),
// with a throwaway database under .tmp/.
export default defineConfig({
	testDir: 'tests/e2e',
	testMatch: '**/*.e2e.ts',
	forbidOnly: !!process.env.CI,
	use: { baseURL: ORIGIN },
	projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
	webServer: {
		command: 'rm -rf .tmp/e2e-data && npm run build && node server.js',
		url: `${ORIGIN}/healthz`,
		reuseExistingServer: false,
		env: { ORIGIN, PORT: String(PORT), HOST: '127.0.0.1', DATA_DIR: '.tmp/e2e-data' }
	}
});
