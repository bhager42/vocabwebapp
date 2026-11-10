# Vocab

A self-hosted vocabulary practice app for kids, with a parent dashboard. It runs as a single
container with a SQLite database. See [PLAN.md](PLAN.md) for the full design and build phases.

Status: Phases 1 to 5 are complete: a child can type their name and practice, and a parent can
sign in and manage children. The parent dashboard arrives in Phase 6 and TrueNAS install
instructions in Phase 7.

## Develop

Requires Node 24 or newer (the container image uses Node 26 LTS).

```sh
npm install
npm run dev          # http://localhost:5173, database in ./data
```

| Command                 | What it does                                                    |
| ----------------------- | --------------------------------------------------------------- |
| `npm run check`         | Type-check TypeScript and Svelte                                |
| `npm run lint`          | Prettier and ESLint                                             |
| `npm run test:unit`     | Vitest unit tests (watch mode; add `-- --run` for a single run) |
| `npm run test:e2e`      | Build, start `server.js`, run Playwright tests against it       |
| `npm test`              | Unit tests, then end-to-end tests                               |
| `npm run db:generate`   | Write a new SQL migration after editing the schema              |
| `npm run content:check` | Validate the word lists in `content/`                           |
| `npm run db:seed`       | Load the word lists into the database by hand                   |

Migrations in `drizzle/` are applied automatically when the app starts, and the built-in word
lists in `content/` (120 words each for grades 3 to 6) are loaded or updated at the same time.

## First run

1. Start the app with `SETUP_TOKEN` set (for `npm run dev`, add `SETUP_TOKEN=some-long-code` to `.env`).
2. Open `/setup`, enter that code, and choose a username and a password of at least 12 characters.
3. You are signed in and taken to `/parent`, where you add each child and set their grade.

The setup page closes for good once the parent account exists, so `SETUP_TOKEN` can be removed
afterwards. There is no password reset by email: if the password is lost, delete the row in the
`parent` table and run setup again (children and their progress are kept).

Sign-in allows 5 wrong attempts per network address in 15 minutes. A parent is signed out after
12 hours without use and always after 7 days.

## How practice works

A child types their first name on the front page and presses Start. A session is ten questions
by default: reviews that are due, then up to four new words, then extra looks at the same words
asked in other ways. A right answer moves a word up one of five boxes and makes it wait longer
before it returns (1, 3, 7, then 21 days); a wrong answer sends it back to the first box and
asks it again a little later in the same session. The rules live in `src/lib/server/srs.ts`
and `src/lib/server/questions.ts`, and section 2 of [PLAN.md](PLAN.md) explains them.

Set `TZ` to your time zone: "due tomorrow", streaks and the daily limit all follow local days.

## Design system

Colors, sizes and timings are defined once in `src/lib/styles/tokens.css`; the components are in
`src/lib/components`. Start the app and open `/styleguide` to see all of them together. The
light, dark and match-this-device themes are switched with the buttons at the top of every page.

## Run the production image locally

```sh
docker compose -f compose.dev.yaml up --build   # or: podman compose ...
```

Then open <http://localhost:3000>. The container runs as UID 568 with a read-only root
filesystem; `/data` is the only writable path.

## Configuration

| Variable      | Required   | Purpose                                                                           |
| ------------- | ---------- | --------------------------------------------------------------------------------- |
| `ORIGIN`      | production | Exact origin used to reach the app, e.g. `http://192.168.1.10:30080`              |
| `DATA_DIR`    | no         | Directory for the database (default `./data`, `/data` in the image)               |
| `TZ`          | no         | Time zone for day boundaries, e.g. `America/Chicago`                              |
| `SETUP_TOKEN` | first run  | One-time code for creating the parent account at `/setup`                         |
| `TRUST_PROXY` | no         | `true` only behind a reverse proxy: read visitor addresses from `X-Forwarded-For` |
| `PORT`        | no         | Listen port (default `3000`)                                                      |

`ORIGIN` must match what is in the browser's address bar exactly (scheme, host and port).
Form submissions from any other origin are rejected with a 403.
