import { defineConfig } from 'drizzle-kit';

// Used by `npm run db:generate` to write SQL migrations into ./drizzle.
// Migrations are applied by the app itself at startup (src/lib/server/db/client.ts).
export default defineConfig({
	schema: './src/lib/server/db/schema.ts',
	out: './drizzle',
	dialect: 'sqlite',
	dbCredentials: { url: `${process.env.DATA_DIR ?? './data'}/vocab.db` },
	verbose: true,
	strict: true
});
