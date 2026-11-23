# Vocab Web App — Development Plan

A self-hosted vocabulary practice app for a third grader (growing through grade 6 in v1, and through grade 12 once Phase 9 is done), with a parent dashboard. Runs as a single container on TrueNAS SCALE 25.10.

This plan is written to be executed by Claude Code one phase at a time. Each phase ends with acceptance criteria; do not start the next phase until they pass.

> **Instruction to the executing agent:** version numbers are deliberately not pinned in this document. At the start of Phase 1, look up the current stable/LTS release of each dependency and pin those exactly (lockfile plus image digests). Do not add any dependency not listed here without stating why.

---

## 1. Goals and non-goals

**Goals**

- Child types his first name and starts practicing. No username, no password.
- Short practice sessions (about 10 questions, 5–10 minutes) with immediate, encouraging feedback.
- Grade-appropriate word lists for grades 3, 4, 5 and 6, starting at grade 3; grades 7 to 12 follow in Phase 9.
- Words come back on a schedule (spaced repetition) so they are actually remembered.
- Parent logs in with a password and sees progress, accuracy, time spent and trouble words.
- Parent can add custom word lists (for example the weekly list from school).
- Reading comprehension (Phase 12): short stories with questions on what is stated and what has to be inferred, starting at grade 3.
- Light and dark mode, accessible, works well on a tablet, Chromebook or desktop.
- One container, one SQLite file, no external services, no telemetry. The one exception is the optional weekly summary email (Phase 11), which is off until the parent turns it on and talks only to Gmail.

**Non-goals for v1**

- Exposure to the public internet.
- Multi-family / multi-tenant use.
- Native mobile apps.
- AI-generated content at runtime (word content is authored at build time and reviewed).

---

## 2. Learning design

### 2.1 Question types

Definition plus multiple choice is the right foundation for this age, but on its own it only trains recognition. The app uses four question types and introduces the harder ones as a word becomes familiar:

| Type          | Prompt                                                                 | Answer                              | Used when                                               |
| ------------- | ---------------------------------------------------------------------- | ----------------------------------- | ------------------------------------------------------- |
| `word_to_def` | The word                                                               | Pick the definition (4 choices)     | Word is new                                             |
| `def_to_word` | The definition                                                         | Pick the word (4 choices)           | Word is somewhat known                                  |
| `cloze`       | Example sentence with a blank                                          | Pick the word that fits (4 choices) | Word is mostly known                                    |
| `spell`       | Definition, the sentence with a blank, the first letter and the length | Type the word                       | Word is nearly mastered (parent can turn this type off) |

Rules for wrong choices (distractors): same grade list, same part of speech, never a synonym of the correct answer, shuffled order on every serve.

### 2.2 Spaced repetition (Leitner boxes)

Each child/word pair sits in a box from 1 to 5.

| Box | Comes back after                         | Question type                           |
| --- | ---------------------------------------- | --------------------------------------- |
| 1   | Later in the same session, then next day | `word_to_def`                           |
| 2   | 1 day                                    | `word_to_def`                           |
| 3   | 3 days                                   | `def_to_word`                           |
| 4   | 7 days                                   | `cloze`                                 |
| 5   | 21 days                                  | `spell` (or `cloze` if spelling is off) |

- Correct: move up one box. Wrong: back to box 1, and the word is asked again later in the same session.
- A word is **mastered** when it is answered correctly out of box 5. A mastered word comes back every 60 days so it is not forgotten; a wrong answer sends it back to box 1 like any other.
- Due dates fall on local midnight in the app's time zone, so a word answered on Monday evening is due first thing Tuesday, not 24 hours later.
- A session is 10 questions: due reviews first, then at most 4 new words. Both numbers are parent settings.
- When reviews and new words do not fill a session (as in the first days), it is filled with extra practice: words that are nearly due, then a second and third look at the session's own words asked in a different way. Extra practice never moves a word up a box, though a wrong answer still sends it back to box 1. Words already asked earlier the same day are used only as a last resort, so a second session straight after the first brings new words rather than the same ones again.
- A missed word is added to the session again two questions later, unless it is already coming up, and a word is asked at most four times in one session.
- The spelling question has no "hear it" button: reading the word aloud would mean sending the answer to the browser before it is given. The first letter and the length point to the wanted word instead. Phase 10 adds dictation, with audio made ahead of time and served so the word never reaches the page.

### 2.3 Feedback and motivation

- After every answer show right/wrong, the correct answer, the definition and the example sentence. A wrong answer is phrased as "Not quite — here is what it means", never as failure.
- No countdown timers. Response time is recorded silently.
- End-of-session summary: stars earned, new words learned, current day streak.
- A "hear it" button on every word, using the browser's built-in `speechSynthesis` (no external service).
- Optional daily cap (parent setting) after which the app says "Great work, come back tomorrow".

### 2.4 Grade progression

- Each child has a current grade, set by the parent (default 3).
- When 80% of the current grade's words are in box 4 or higher, the parent dashboard suggests unlocking the next grade. A parent setting can make this automatic.
- Words from earlier grades keep coming back on their review schedule.

### 2.5 Word content

- v1 ships 120 words per grade for grades 3–6 (480 total), as JSON seed files in `content/grade-N.json`. Phase 9 adds grades 7–12 the same way (720 more, 1,200 in all).
- Each entry: `word`, `partOfSpeech`, `definition` (written for the grade's reading level, 15 words or fewer, must not contain the word itself), `sentence` (contains the word exactly once), `synonyms` (used only to exclude bad distractors).
- All definitions and sentences are originally written. Do not copy from commercial dictionaries or published word lists.
- A validation script (`npm run content:check`) enforces: no duplicate words across grades, definition does not contain the word, sentence contains the word exactly once, at least 3 same-part-of-speech distractor candidates exist per word, no profanity (simple blocklist).
- The parent reviews the lists before first use; the admin UI can disable any built-in word.

---

## 3. Architecture

### 3.1 Stack

| Layer            | Choice                                                                                             | Why                                                                                                                           |
| ---------------- | -------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Framework        | SvelteKit (Svelte 5) with `adapter-node`, TypeScript strict                                        | Server-rendered, small client bundle, built-in CSRF origin checks and CSP nonce support, form actions work without JavaScript |
| Database         | SQLite in WAL mode, via Drizzle ORM and `better-sqlite3`                                           | One file on a ZFS dataset, trivial backup, no second container                                                                |
| Validation       | Valibot                                                                                            | Every form and endpoint input is schema-validated                                                                             |
| Password hashing | Argon2id (Node built-in `crypto.argon2` if present in the chosen LTS, otherwise `@node-rs/argon2`) | Current OWASP recommendation                                                                                                  |
| Styling          | Plain modern CSS, no framework                                                                     | See 3.4                                                                                                                       |
| Charts           | Hand-written inline SVG components                                                                 | No chart library, CSP-friendly                                                                                                |
| Tests            | Vitest (unit), Playwright (end-to-end), `@axe-core/playwright` (accessibility)                     |                                                                                                                               |
| Runtime          | Current Node LTS, slim or distroless base image                                                    |                                                                                                                               |

### 3.2 Repository layout

```
vocabwebapp/
├── PLAN.md
├── README.md                  # install and operate on TrueNAS
├── Dockerfile
├── compose.truenas.yaml       # paste into TrueNAS "Install via YAML"
├── compose.dev.yaml
├── content/                   # grade-3.json … grade-6.json
├── scripts/                   # content-check, seed, backup
├── drizzle/                   # generated SQL migrations
├── src/
│   ├── hooks.server.ts        # sessions, security headers, rate limiting
│   ├── lib/server/            # db, auth, srs (Leitner), question builder, metrics
│   ├── lib/components/
│   ├── lib/styles/            # tokens.css, base.css
│   └── routes/
│       ├── +page.svelte       # "What's your name?"
│       ├── play/              # practice session
│       ├── setup/             # first-run parent account creation
│       ├── parent/login/
│       ├── parent/            # dashboard, children, words, settings, export
│       └── healthz/
└── tests/                     # unit and e2e
```

### 3.3 Data model

| Table              | Key columns                                                                                                             |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------- |
| `parent`           | `id`, `username`, `password_hash`, `created_at`                                                                         |
| `child`            | `id`, `name`, `name_normalized` (unique), `grade`, `settings_json`, `created_at`, `archived_at`                         |
| `auth_session`     | `token_hash` (SHA-256 of a 256-bit random token), `kind` (`parent`/`child`), `subject_id`, `expires_at`, `last_seen_at` |
| `word_list`        | `id`, `name`, `grade`, `source` (`builtin`/`custom`), `active`                                                          |
| `word`             | `id`, `list_id`, `word`, `part_of_speech`, `definition`, `sentence`, `synonyms_json`, `active`                          |
| `word_progress`    | `child_id`, `word_id`, `box`, `due_at`, `times_seen`, `times_correct`, `first_seen_at`, `mastered_at`                   |
| `practice_session` | `id`, `child_id`, `started_at`, `ended_at`, `active_ms`, `question_count`, `completed`, `plan_json`                     |
| `question`         | `id`, `practice_session_id`, `word_id`, `type`, `choices_json`, `correct_choice`, `served_at`                           |
| `answer`           | `question_id`, `chosen`, `is_correct`, `response_ms`, `is_retry`, `answered_at`                                         |
| `login_attempt`    | `scope`, `ip`, `at`, `success` (for rate limiting)                                                                      |
| `setting`          | `key`, `value`                                                                                                          |

The `question` row is written when a question is served and holds the correct answer on the server. The browser receives only the question id and the shuffled choices, and the answer is checked server-side. This keeps the metrics trustworthy.

### 3.4 Front-end standards

- Semantic HTML first; every flow works with keyboard only. Forms work without JavaScript (progressive enhancement).
- Theming: `color-scheme: light dark` and the CSS `light-dark()` function over design tokens in `tokens.css`. Follows the system setting by default; a toggle stores an override in a cookie so the server renders the right theme with no flash.
- Modern CSS only: nesting, container queries, `:has()`, logical properties, `clamp()` fluid type, `oklch()` colors. Only features that are Baseline "widely available" at build time.
- Native platform pieces instead of libraries: `<dialog>`, the Popover API, the View Transitions API for question-to-question movement.
- Honors `prefers-reduced-motion` and `prefers-contrast`.
- WCAG 2.2 AA: contrast, visible focus, 44px minimum touch targets, no meaning by color alone (right/wrong also uses icon and text), `aria-live` announcements for feedback.
- Typography for young readers: large base size, generous line height, a self-hosted highly legible font (Atkinson Hyperlegible, OFL licensed). No fonts or scripts from third-party hosts.
- Web app manifest and icons so it can be added to a tablet home screen. A service worker is added only for the app shell and only when served over HTTPS.

---

## 4. Access and security

### 4.1 Child access

- The parent creates each child profile. The child types his first name; it is trimmed, lower-cased and matched against existing profiles.
- An unknown name gets "Hmm, I don't know that name yet — ask a grown-up", and never creates a profile. This stops typos from creating junk profiles and splitting his stats.
- A successful match sets a 30-day child session cookie, so on his usual device he lands straight on "Welcome back". A "Not you?" button switches child.
- A child session can reach only `/` and `/play`. It can never read `/parent` or any other child's data.
- The name lookup is rate limited (20 wrong names per network address in 15 minutes, counted separately from parent sign-in) and the response does not list valid names.

Accepted trade-off: anyone on the home network who knows his name can practice as him. The worst case is skewed stats, and the parent can delete a practice session from the dashboard.

### 4.2 Parent access

- First run: `/setup` is available only while no parent exists, and requires the one-time `SETUP_TOKEN` environment value. It creates the single parent account.
- Password: minimum 12 characters, hashed with Argon2id using current OWASP parameters.
- Login rate limit: 5 failures per 15 minutes per IP, with increasing delay. Uniform error message and timing.
- Parent session: 12 hours idle, 7 days absolute; rotated on login; "log out everywhere" in settings.
- Passkey (WebAuthn) login is not planned; the parent signs in with a password only.

### 4.3 Web security baseline

- **Cookies:** `HttpOnly`, `SameSite=Lax`, `Path=/`. When `ORIGIN` is https, also `Secure` and the `__Host-` prefix. (`Strict` until 1.4.1: it left the cookie off visits that start on another site, such as the weekly email's link, and Safari kept it off when such a page was refreshed, so a signed-in parent was sent to the sign-in page. Form posts from other sites are still refused by the cookie and by SvelteKit's origin check.)
- **CSRF:** SvelteKit origin checking stays on; every state change is a POST form action; `ORIGIN` is set explicitly.
- **Content Security Policy:** nonce-based via SvelteKit's `csp` config: `default-src 'self'`; `script-src 'self' 'nonce-…'`; `style-src 'self'`; `style-src-attr` limited by hash to the one inline style attribute SvelteKit's route announcer uses; `img-src 'self' data:`; `font-src 'self'`; `connect-src 'self'`; `object-src 'none'`; `base-uri 'none'`; `form-action 'self'`; `frame-ancestors 'none'`. No inline event handlers and no third-party origins.
- **Other headers:** `X-Content-Type-Options: nosniff`, `Referrer-Policy: same-origin` (not `no-referrer`, which makes browsers send `Origin: null` on plain form posts and so breaks the CSRF check for forms submitted without JavaScript), `Cross-Origin-Opener-Policy: same-origin`, `Cross-Origin-Resource-Policy: same-origin`, a `Permissions-Policy` that disables camera, microphone, geolocation and the rest. `Strict-Transport-Security` only when `ORIGIN` is https.
- **Input:** every form and parameter validated with Valibot; only parameterized queries through Drizzle; Svelte's default output escaping, with `{@html}` banned by a lint rule.
- **Authorization:** checked centrally in `hooks.server.ts` by route group, and again in each load function and action. Tests cover child-to-parent and child-to-other-child access.
- **Privacy:** only a first name is stored for the child. No analytics, no outbound network calls at runtime, no logging of names or answers to stdout. The one exception is the weekly summary email (Phase 11): when the parent turns it on, the app connects to Gmail's mail server once a week to send the parent a summary that includes each child's first name and figures.
- **Supply chain:** exact-pinned lockfile, `npm ci`, `npm audit` and a Trivy image scan in CI, base images pinned by digest, SBOM generated at build.

### 4.4 Container hardening

- Multi-stage build; final image has production dependencies and build output only.
- The final image is distroless (`gcr.io/distroless/nodejs26-debian13`, pinned by digest): Node and its libraries, with no shell, package manager or npm. Chosen in Phase 7 after the Debian slim image showed high-severity findings with no fix available; the distroless image scans clean.
- Runs as UID/GID 568 (the TrueNAS `apps` user), never root.
- `read_only: true` root filesystem, `/tmp` as tmpfs, `/data` the only writable mount.
- `cap_drop: [ALL]`, `security_opt: [no-new-privileges:true]`, memory and CPU limits.
- `HEALTHCHECK` against `/healthz`, which also verifies the database is writable.

### 4.5 HTTPS

The container serves plain HTTP on one port. Recommended: put it behind a reverse proxy that already runs on the NAS (Nginx Proxy Manager, Caddy or Traefik) with a real certificate for a hostname such as `vocab.home.example`. HTTPS is required for `Secure` cookies, the service worker and home-screen install. Without it the app still works over `http://nas-ip:port`, with those features off.

Do not port-forward this app to the internet. For access away from home use Tailscale or WireGuard.

---

## 5. Parent dashboard and metrics

Everything below is computed from the `answer`, `question`, `practice_session` and `word_progress` tables. No extra tracking is needed.

**Per child, with a 7-day / 30-day / all-time switch**

| Metric                    | Definition                                                                                     |
| ------------------------- | ---------------------------------------------------------------------------------------------- |
| Accuracy                  | Correct first attempts ÷ first attempts. Same-session retries are counted separately.          |
| Accuracy trend            | Daily accuracy as a line chart                                                                 |
| Time practiced            | Active minutes per day (bar chart) and total                                                   |
| Days practiced and streak | Days with at least one completed session; current and longest streak                           |
| Sessions                  | Started, completed, abandoned                                                                  |
| Word status               | Counts of new / learning (box 1–3) / almost there (box 4–5) / mastered                         |
| Grade progress            | Percent of current grade's words at box 4 or higher                                            |
| Trouble words             | Most-missed words, with the wrong choice he picked most often (shows what he confuses it with) |
| Retention                 | Accuracy on words last seen 7 or more days ago: is it sticking?                                |
| Accuracy by question type | Shows, for example, that he knows definitions but struggles to use words in sentences          |
| Response time             | Median seconds per question, by type                                                           |
| Guessing signal           | Share of wrong answers given in under 1.5 seconds                                              |
| Best time of day          | Accuracy by hour, once there is enough data                                                    |

How the definitions above are applied (decided in Phase 6):

- A **first attempt** is the first time a word is asked in a session. Retries after a miss, and the second looks that fill out a short session, are easier and are left out of every accuracy figure. Response time and trouble words count every answer.
- **7 days** means today and the six calendar days before it in the `TZ` zone, not the last 168 hours. A session belongs to the day it started on.
- Charts show one point per day up to 60 days and one per week (Monday to Sunday) beyond that.
- **Abandoned** covers sessions stopped early and sessions walked away from. A session still open and touched within the last hour is counted as in progress instead.
- **Word status** and **grade progress** describe today and do not change with the period switch. Only words that can be asked are counted.
- **Trouble words:** when the wrong choice was another word's definition, the dashboard names that word.
- **Guessing signal** leaves out spelling questions, which nobody can type in 1.5 seconds.
- **Best time of day** is named only after 50 first attempts, with at least two hours of the day having 10 each.
- **Deleting a session** removes its questions and answers from every figure. The boxes its words reached are kept, since undoing them would mean replaying everything since.
- **Grade progression:** when 80% is reached and automatic move-up is off, the progress page offers a "Move up to grade N" button.
- **CSV export** is per child. Cells that a spreadsheet would run as a formula are prefixed with an apostrophe, because spelling answers are typed by the child. The full database backup download is part of Phase 7.

**Active time** is not wall-clock time. It is the sum of gaps between consecutive events in a session (question served, answered, next), with each gap capped at 60 seconds. Walking away from the tablet does not inflate the number.

**Other parent features**

- Per-word history: every answer he gave for a word.
- Session log: each session with its questions and answers; delete a session.
- Manage children: add, rename, set grade, archive.
- Manage words: disable built-in words, create custom lists, paste a list of words and fill in definition and sentence.
- Settings, kept per child: questions per session, new words per session, spelling questions on/off, daily cap, auto-unlock next grade.
- Export: CSV of answers and a full database backup download.

---

## 6. Deployment on TrueNAS SCALE 25.10

### 6.1 Configuration

| Variable             | Example                                                     | Purpose                                                                  |
| -------------------- | ----------------------------------------------------------- | ------------------------------------------------------------------------ |
| `ORIGIN`             | `https://vocab.home.example` or `http://192.168.1.10:30080` | CSRF origin check, cookie flags, HSTS                                    |
| `DATA_DIR`           | `/data`                                                     | SQLite file and backups                                                  |
| `TZ`                 | `America/New_York`                                          | Day boundaries for streaks and charts                                    |
| `SETUP_TOKEN`        | long random string                                          | One-time first-run setup                                                 |
| `TRUST_PROXY`        | `true` / `false`                                            | Whether to read client IP from `X-Forwarded-For`                         |
| `PORT`               | `3000`                                                      | Listen port inside the container                                         |
| `GMAIL_USER`         | `family.vocab@gmail.com`                                    | Gmail account the weekly summary is sent from (Phase 11). Optional       |
| `GMAIL_APP_PASSWORD` | 16-letter app password                                      | That account's Google app password. Optional; email stays off without it |

### 6.2 Storage

- By default `/data` is a named volume, `vocab-data`, which TrueNAS keeps in its `ix-apps` dataset (`/mnt/.ix-apps/docker/volumes/`). The image's `/data` belongs to 568, and Docker copies that ownership into a new, empty volume, so nothing has to be set up by hand.
- Alternative: a dataset of your own, for example `tank/apps/vocab`, owned by `apps:apps` (568:568), mounted at `/data`.
- Local ZFS only. Do not put the SQLite file on an SMB or NFS share.
- Migrations run automatically on startup, after the app copies the database to `/data/backups/pre-migrate-<timestamp>.db`.
- A nightly in-app job writes a consistent copy with `VACUUM INTO` to `/data/backups/` and keeps the last 14. Add a periodic ZFS snapshot task on the dataset as well.

### 6.3 Image delivery

TrueNAS pulls images; it does not build them. Two supported routes, documented in the README:

1. **Registry (recommended):** a GitHub Actions workflow builds `linux/amd64`, scans it, and pushes to GHCR on every tag. TrueNAS pulls `ghcr.io/<user>/vocabwebapp:<tag>`.
2. **No registry:** build on the dev machine, then `docker save vocabwebapp:<tag> | ssh <nas> sudo docker load`, with `pull_policy: never` in the compose file.

### 6.4 Compose file (`compose.truenas.yaml`)

Installed through **Apps → Discover Apps → ⋮ → Install via YAML**.

```yaml
services:
  vocab:
    image: ghcr.io/bhager42/vocabwebapp:latest
    pull_policy: always
    user: '568:568'
    restart: unless-stopped
    ports:
      - '30080:3000'
    environment:
      ORIGIN: 'http://NAS_IP:30080'
      DATA_DIR: /data
      TZ: America/New_York
      SETUP_TOKEN: 'CHANGE_ME'
      TRUST_PROXY: 'false'
    volumes:
      - vocab-data:/data
    read_only: true
    tmpfs:
      - /tmp
    cap_drop:
      - ALL
    security_opt:
      - no-new-privileges:true
    deploy:
      resources:
        limits:
          cpus: '1.0'
          memory: 512M

volumes:
  vocab-data:
```

---

## 7. Phases

### Phase 1 — Scaffold and tooling

- `git init`; SvelteKit project with TypeScript strict, ESLint, Prettier, Vitest, Playwright.
- Drizzle schema for all tables in 3.3, first migration, database opened in WAL mode with foreign keys on.
- `hooks.server.ts` skeleton that sets every header in 4.3; CSP configured.
- `/healthz` route.
- `Dockerfile` and `compose.dev.yaml`.

**Accepts when:** `npm run check`, `npm run lint`, `npm test` pass; `docker compose -f compose.dev.yaml up` serves a page as UID 568 with a read-only root filesystem; a Playwright test asserts each security header is present.

### Phase 2 — Word content

- Write `content/grade-3.json` through `grade-6.json`, 120 words each, per 2.5.
- `scripts/content-check.ts` and `scripts/seed.ts` (idempotent: re-running updates built-in words without touching progress).

**Accepts when:** `npm run content:check` passes with zero warnings; seeding twice produces the same row counts; unit tests cover each validation rule.

### Phase 3 — Design system and theming

- `tokens.css` and `base.css`; components: button, choice card, progress bar, feedback panel, dialog, theme toggle.
- Light, dark and system modes with server-rendered theme from cookie.

**Accepts when:** axe reports no violations on a component gallery page in both themes; no theme flash on reload; all controls reachable and operable by keyboard; layout holds from 360px to 1920px wide.

### Phase 4 — Parent setup, login and child management

- `/setup` with `SETUP_TOKEN`, `/parent/login`, logout, session handling, rate limiting.
- Children CRUD and settings.

**Accepts when:** e2e tests cover setup-once-only, wrong password, lockout after 5 failures, session expiry, and that every `/parent` route redirects when not logged in.

### Phase 5 — Child entry and practice loop

- Name entry page per 4.1; child session cookie.
- `lib/server/srs.ts` (Leitner logic) and `lib/server/questions.ts` (session composition, distractor selection), both pure and unit-tested.
- `/play`: serve question, submit answer, feedback, next, end-of-session summary. Server-side answer checking. Speech button.
- Recording of `question`, `answer`, `practice_session` and `word_progress`.

**Accepts when:** unit tests cover every box transition, due-date calculation across a `TZ` day boundary, and distractor rules; an e2e test plays a full 10-question session with JavaScript disabled and another with it enabled; the correct answer never appears in any response before the answer is submitted (asserted in a test); a child session gets 403/redirect on `/parent`.

### Phase 6 — Parent dashboard

- `lib/server/metrics.ts` with one function per metric in section 5, each unit-tested against a fixture database.
- Dashboard pages, SVG charts with text alternatives (each chart has an accompanying data table), session log, per-word history, CSV export.

**Accepts when:** metric functions match hand-calculated values on the fixture; active-time capping is tested; axe passes on every dashboard page in both themes.

### Phase 7 — Custom words, backups and deployment

- Word management UI and custom lists.
- Pre-migration backup, nightly backup job, backup download.
- `compose.truenas.yaml`, GitHub Actions workflow (lint, test, build, Trivy scan, SBOM, push on tag), `README.md` with step-by-step TrueNAS install, update, backup and restore instructions.

Decided in Phase 7:

- **Custom words** follow the same rules as built-in ones: a single word of letters, a meaning of at most 15 words that does not use the word, a sentence that uses it exactly once. Up to 30 can be pasted at a time; they are saved all together or not at all.
- **New words from custom lists are given before built-in ones** for the same grade, since they are usually this week's words from school.
- **Nothing a child has been asked is deleted.** A custom word or list can be deleted until one of its words has been asked; after that it can only be switched off, and a practiced word's spelling cannot change.
- **Backups** are made with `VACUUM INTO`, written under a temporary name and renamed when complete. Nightly: checked hourly, made when the newest is a day old, newest 14 kept. Pre-migration: only when an existing database has migrations to run, newest 5 kept.
- **Backup download** is a POST from the Account page, so it cannot be triggered by a link or from another site. The copy is made at that moment and removed from disk after sending.
- **CI** pins every action to a commit. The scan fails on any high or critical finding, fixed or not. The image is published only for a `v*.*.*` tag, after tests and scan pass.

**Accepts when:** CI is green; the image scan has no high or critical findings; a restore from a backup file is performed and documented; the app is installed on the NAS from the compose file and a full child session and parent login succeed from another device.

### Phase 8 — Optional extras

Pick individually after a few weeks of real use:

- Service worker for app-shell caching and home-screen install polish.
- ~~Placement quiz to pick a starting grade.~~ Planned as Phase 11.
- ~~Weekly summary page ("this week he learned 14 words").~~ Planned as Phase 11, sent by email.
- Extra question types: synonym/antonym matching, picture prompts.
- Printable review sheet of trouble words.

### Phase 9 — Grades 7 to 12

Extends the built-in words from grade 6 up to grade 12, so a child can keep going through high school. Nothing about how practice works changes.

- **Content:** write `content/grade-7.json` through `grade-12.json`, 120 words each, to the rules in 2.5. Definitions stay at 15 words or fewer and are written for that grade's reading level; sentences suit the age without being childish. Grades 9–12 lean on academic and test-prep vocabulary (words like _ubiquitous_, _tenacious_, _juxtapose_), not obscure rarities. No word may repeat one from an earlier grade.
- **Write in batches:** one grade per commit, each passing `npm run content:check` before the next is started, so the parent can review a grade at a time.
- **Grade range:** `GRADES` in `src/lib/server/children.ts` becomes 3–12. Every grade picker (child form, custom list form) offers the new grades. The "Move up to grade N" suggestion and automatic move-up stop at 12; at 12 the progress page says the last grade has been reached instead of offering a move.
- **Existing installs:** the startup seed already creates a list for any new `grade-N.json` file and leaves existing words, progress and the parent's on/off choices alone, so updating the image is all it takes. A unit test confirms that seeding grades 7–12 onto a database holding grade 3–6 progress changes none of it.
- **Checks to review:** the spelling question's length limit (`SPELLING_MAX_LENGTH`) and the "starts with … and has N letters" hint for long words; distractors still come from the same grade and part of speech; the word-status bar and dashboard tables still read well with twelve grades' worth of words.
- **Grade 3 starting point:** the default grade for a new child stays 3. The placement quiz in Phase 8 becomes more useful with this range; it can be done either before or after this phase.

**Accepts when:** `npm run content:check` passes for all ten grades with 120 words in each and no duplicates across grades; the parent has reviewed each new grade; a child can be set to any grade from 3 to 12; a child at grade 12 who reaches 80% is not offered a grade 13; an existing database updated to the new image keeps every child's progress and every word the parent switched off; all unit and end-to-end tests pass, including new ones for the grade range and the seed.

### Phase 10 — Dictation audio for spelling

Turns the spelling question into real dictation: the child hears the word, then a sentence using it, then the word again, and types it. The audio comes from the server, so the word never reaches the page as text before it is answered (the reason 2.2 gives for having no "hear it" button on spelling today). Nothing else about practice changes: the question still comes from box 5, and is still marked and scheduled the same way.

- **Audio is made ahead of time, not in the container.** A script, `npm run audio:build`, voices every built-in word with an offline neural text-to-speech engine (Piper, run on the dev machine only) and writes one clip per word: the word, the sentence from the content file, the word again. The clips are committed under `content/audio/`, named by a hash of the word, so the running app needs no speech engine, makes no outbound calls and keeps its distroless image. Expect roughly 1,200 clips of 2–4 seconds each, about 10–25 MB in all.
- **Format:** mono MP3 at a low bit rate, which every target browser plays (Chromebook, iPad Safari, desktop). All metadata tags are stripped so a clip carries no title or file name that spells the word.
- **Voice:** one English voice for every clip, chosen by listening to a sample of hard words from each grade. Its model license must allow sharing the generated audio; the README records it next to the font license.
- **Pronunciation fixes:** a content entry may carry an optional `pronounce` field, a respelling fed to the engine instead of the word (for example a word the voice says wrongly). `content:check` confirms every built-in word has a clip and that no clip is stale (made from an older sentence or `pronounce`).
- **Serving without giving the answer away:** clips are not in `static/`. They are served only through `/play/audio`, which returns the clip for the child's current, unanswered spelling question in their own session, and 404 for anything else: another child's question, an answered one, a question that is not spelling, or a guessed word. The URL holds no word and no file name. Responses are `Cache-Control: no-store`. The CSP already allows same-origin media through `default-src 'self'`; add an explicit `media-src 'self'`.
- **The question:** "Listen, then type the word." A large "Play" button (and "Play slowly", at 0.75× speed) can be pressed as often as the child likes, and the clip plays once by itself when the question opens. The definition stays on screen as support; the first-letter and length hint is dropped, since the word has been heard. Without JavaScript, a plain `<audio controls>` element plays the same clip.
- **When there is no clip:** custom words the parent adds, a built-in word the parent marks as badly voiced, or audio that fails to load all fall back to today's written spelling question (definition, sentence with a blank, first letter and length). The child is never stuck.
- **Parent side:** each built-in word's page gets a play button so the parent can check how it sounds, and a "Voice is wrong" switch that sends that word back to the written spelling question until a fixed clip ships. Each child's settings gain a choice between "Hear and spell" (the default once this ships) and "Read and spell" (today's question). The answer history and CSV mark which kind of spelling question was asked.
- **Feedback and other "hear it" buttons:** after a dictation answer, the feedback panel replays the clip. The other "hear it" buttons keep the browser's own voice; switching them to the clips is optional and can be done later.

**Choices to confirm before starting:**

| Choice                | Default in this phase                | Alternative                                                                                               |
| --------------------- | ------------------------------------ | --------------------------------------------------------------------------------------------------------- |
| Where speech is made  | On the dev machine, clips committed  | Put Piper and a voice in the image so custom words get audio too (bigger image, not distroless)           |
| What a clip says      | Word, sentence, word                 | The word alone                                                                                            |
| Default spelling kind | "Hear and spell" for every child     | Stay on "Read and spell" until the parent switches it on                                                  |
| Custom words          | Written spelling question (no audio) | Parent records the word in the browser (needs microphone permission, a CSP and Permissions-Policy change) |

**Accepts when:** every built-in word has a current clip and `content:check` passes; the parent has listened to a sample from each grade and fixed or switched off any word the voice gets wrong; a dictation question's HTML, page data, URL and response headers never contain the word or its hash (an end-to-end test checks all four); `/play/audio` returns 404 for another child's question, an answered question, a non-spelling question and a made-up id; a clip plays in Chromium and on the child's own device, with and without JavaScript; a custom word and a word marked "Voice is wrong" get the written spelling question instead; the per-child setting and the CSV column work; the image is still distroless, makes no outbound calls and passes the Trivy scan; axe reports no violations on the dictation question in both themes; all unit and end-to-end tests pass.

### Phase 11 — Placement quiz and weekly summary email

Two of the Phase 8 extras. Both are optional: the parent starts a placement quiz only when they want one, and the weekly email is off until they turn it on.

**Placement quiz**

A short quiz that finds the grade a child should start at, so a child who already knows the easier words does not spend weeks on them.

- **Started by the parent.** Each child's Settings page gets a "Placement quiz" section with "Give {name} a placement quiz". The next time the child opens the app, the home page offers "Quick quiz first" in place of practice. The parent can cancel a quiz that has not finished. Only one quiz per child can be open at a time.
- **How it runs:** rounds of 5 questions, each from one grade's built-in words (custom lists are left out, as they are not graded). Every question is `word_to_def` with four choices and a fifth button, "I don't know this one", which counts as wrong and keeps guessing down. The first round uses the child's current grade. 4 or 5 right passes a grade: the quiz moves up one grade. 3 or fewer fails it: the quiz moves down one grade. It ends when it has found a passed grade whose next grade was failed, or a pass at grade 12, or a fail at grade 3. The result is the highest grade passed, or 3 if none was. The longest possible quiz is 10 rounds, but a child usually needs 2 to 4 (10 to 20 questions).
- **Words chosen:** prefer words the child has not met in practice, so the quiz measures what they knew before; fall back to any active built-in word of that grade. Wrong choices follow the usual rules (2.1).
- **No right/wrong feedback during the quiz.** The child sees only a progress bar and "Next", so a hard grade is not discouraging. At the end: "All done! Thanks for doing the quiz." with no score.
- **It changes nothing on its own.** Quiz answers are kept in their own tables, `placement_quiz` and `placement_answer`, not in `question` and `answer`. So they do not move words between boxes and do not count toward any dashboard figure, the streak or the daily limit. As in practice, the correct answer stays on the server until the child has answered.
- **Result for the parent.** The Settings page shows the latest finished quiz: when it was taken, the grade it suggests and each grade's score ("Grade 5: 5 of 5, Grade 6: 2 of 5"), and a "Move to grade N" button. The button is not shown when the child is already at that grade. Older quizzes are listed below it.
- **Stopping part way:** "Stop for now" keeps the quiz open, and the child picks up where they left off. A quiz left untouched for 7 days is closed unfinished.

**Weekly summary email**

A short email to the parent every Monday morning about the week before.

- **Content, per child who is not archived, for the past Monday to Sunday in `TZ`:** days practiced, minutes practiced, sessions finished, new words started, words mastered, accuracy (first attempts, as in section 5) with last week's figure next to it, the three most-missed words, grade progress, and "Ready to move up to grade N" when the 80% mark is reached and automatic move-up is off. A finished placement quiz from that week is mentioned with its suggested grade. A child who did not practice gets one line saying so. There is a link to the dashboard, using `ORIGIN`.
- **Format:** both plain text and simple HTML, laid out as a table. The HTML has no images, scripts or remote resources, and every value in it is escaped.
- **Preview:** the Account page has "See this week's summary", which shows the same content in the app. This works whether or not email is set up.
- **Sending through Gmail:** SMTP to `smtp.gmail.com` on port 465 (TLS from the first byte), signed in with a Google app password. The account and app password come from the `GMAIL_USER` and `GMAIL_APP_PASSWORD` environment variables, not from the database, so the password is never in a backup. The README explains how to make an app password (it needs 2-step verification on the Google account), and recommends a separate Gmail account just for the app.
- **Parent settings (Account page, "Weekly summary email"):** an on/off switch (off by default), the address to send to, and "Send a test email now". When the two environment variables are missing, this section says email is not set up and links to the README instead of showing the form. The page also shows when the last summary was sent, or the last error.
- **When it is sent:** an hourly check, like the nightly backup. It sends when the switch is on, an address is set, it is Monday 7:00 or later in `TZ` (or any later day that week, if the app was off on Monday), and last week's summary has not been sent. The week sent is saved in `setting` so a restart never sends it twice. A failed send is logged without the password, shown on the Account page, and tried again next hour, up to 6 tries per week.
- **Dependency:** `nodemailer`, the usual SMTP client for Node. It has no dependencies of its own, so it adds little to audit, and writing SMTP and TLS handling by hand would be riskier. Pinned exactly like everything else.
- **Security:** the address to send to is validated as an email address, and no header is built from anything the child typed. A child's typed spelling answers are never in the email: trouble words are listed from the word lists, not from what was typed. The app connects out only when sending, only to `smtp.gmail.com`, and verifies the server's certificate. The image stays distroless.

**Data model additions**

| Table              | Key columns                                                                                                                                                              |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `placement_quiz`   | `id`, `child_id`, `started_at`, `ended_at`, `start_grade`, `result_grade`, `completed`, `cancelled`                                                                      |
| `placement_answer` | `id`, `quiz_id`, `grade`, `word_id`, `choices_json`, `correct_choice`, `served_at`, `chosen` (null until answered, `''` for "I don't know"), `is_correct`, `answered_at` |

Email settings (`summary.enabled`, `summary.to`, `summary.lastWeek`, `summary.lastSentAt`, `summary.lastError`, `summary.tries`) go in the existing `setting` table.

**Accepts when:** unit tests cover the quiz staircase (pass up, fail down, stop at 3 and at 12, the result rule), word choice preferring unseen words, and that a quiz changes no `word_progress`, `question`, `answer` or `practice_session` rows; an end-to-end test runs a full quiz with JavaScript on and another with it off, and checks the correct answer is not in any response before it is answered; the parent can start, cancel and apply a quiz, and a child can reach only their own quiz; unit tests cover the weekly figures against a fixture, the Monday 7:00 rule across a `TZ` boundary, no double send after a restart, retries, and HTML escaping of a child's name; the message that would be sent is checked with nodemailer's stream transport, so tests never contact Gmail; the settings section hides the form when the environment variables are missing; a test email arrives from the real Gmail account on the NAS; axe reports no violations on the new pages in both themes; all unit and end-to-end tests pass, the image is still distroless and passes the Trivy scan.

### Phase 12 — Reading comprehension

A second activity next to word practice: the child reads a short story of several paragraphs and answers questions about it. Some answers are stated in the story; others have to be worked out from it. It starts at grade 3.

**Stories are written and reviewed ahead of time, not fetched or generated while the app runs.** Like the word lists (2.5), Claude writes them during development, checks them with a script, reviews each one, and the parent reviews each grade before it ships. Published reading passages (ReadWorks, CommonLit, state test samples) are copyrighted and are not used. Public-domain readers are dated, uneven in level and come without questions, so they are not used either.

**Content format.** `content/reading/grade-N.json` holds that grade's stories. Each story has:

- `id`: a short slug, unique across all grades, kept for good once shipped (progress is stored against it).
- `title`, and `paragraphs`: an array of plain-text paragraphs.
- `questions`: five multiple-choice questions, each with `kind`, `prompt`, `correct`, `wrong` (exactly three), `explanation` (one or two sentences shown afterwards, saying where in the story the answer comes from) and `evidence` (one or more phrases copied exactly from the story that support the answer).

**Question kinds.** Every story has five questions: at least two `literal` (the answer is stated in the story), at least two `inference` (the answer is not stated and has to be worked out, such as why a character did something, how they probably felt, or what will likely happen next), and one of `vocabulary` (what a word means here), `main_idea` or `sequence`.

**Size and level per grade.** Checked by the script:

| Grade | Paragraphs | Words   | Readability (Flesch-Kincaid grade) |
| ----- | ---------- | ------- | ---------------------------------- |
| 3     | 3–5        | 200–400 | 2.0–4.0                            |
| 4     | 3–6        | 250–500 | 3.0–5.0                            |
| 5     | 4–6        | 300–600 | 4.0–6.0                            |
| 6     | 4–7        | 350–700 | 5.0–7.0                            |

Grades 7 to 12 follow the same pattern when they are written. Readability is computed by the check script itself (sentence and syllable counts), so no dependency is added. It is a guide that flags a story worth a second look, not a measure of quality.

**`npm run reading:check`** enforces: every field present; unique ids; the paragraph, word and readability ranges above; five questions with the kinds above; four distinct choices per question; every question has at least one `evidence` phrase and each appears word for word in the story (whether the evidence really supports the answer is part of the review below); an `inference` question's correct answer does not appear word for word in the story; the right answer is not much longer than the longest wrong one (a long right answer gives itself away); and the same blocklist as the words.

**Claude's review of each story**, recorded in `content/reading/REVIEW.md`, one entry per story with what was checked and anything changed:

- The story holds together: names, places, the order of events and facts do not contradict each other, and it has a clear beginning, middle and end.
- Each literal answer is really in the story, and each inference answer is the one best answer the story supports.
- No wrong answer could also be argued to be right. This is the most common flaw in comprehension questions, so each wrong answer is checked against the story on its own.
- No question can be answered without reading the story (from general knowledge alone).
- Words, sentence length and themes suit the grade. Nothing frightening, violent, romantic, or about death, illness or family breakup at grades 3 to 5. Characters and settings are varied, and no group is made fun of.
- The stories are original. No retelling of a known book, film or game.

The review is a strong first filter, not a guarantee; the parent reviewing each grade stays part of the process.

**Pilot first.** Before any app code: the content format, `reading:check` and 5 grade-3 stories with their review entries. The parent reads them and judges story quality and question style. Changes to the format or the rules are made then, while they are cheap. After that, grade 3 is filled to 15 stories, and the app is built. More grades (4, 5, 6, …) follow later, one grade per batch, as in Phase 9.

**In the app**

- **Home page:** a child sees "Practice words" and "Read a story". A placement quiz the parent has asked for still comes first.
- **Which story:** the next unread story at the child's reading grade. When every story in the grade has been read, the one read longest ago comes back. A story can be stopped and picked up later.
- **Reading screen:** the story at the top, with a "Read it to me" button per paragraph using the browser's speech (as the "hear it" buttons do), then the questions one at a time underneath. The story stays on screen while answering; looking back at the text is part of reading comprehension.
- **Questions and feedback:** choices are shuffled on every serve, and the correct answer stays on the server until the child has answered, as in practice. After each answer, the same encouraging feedback as practice, plus the explanation. At the end: how many were right, without separating literal and inference for the child.
- **Reading grade:** each child gets a reading grade apart from their word grade (default 3), since the two skills can differ. When the child's last 5 stories at their reading grade average 80% or more, with at least 70% on inference questions, the parent is offered "Move up to reading grade N", or it happens automatically if the parent chose that, as with words (2.4).
- **Daily limit:** reading time counts toward the same daily limit as word practice.
- **Parent side:** a **Reading** tab per child: stories read, minutes, accuracy overall and separately for stated and inferred answers (the gap between the two shows whether the child understands or only remembers what was read), and each story with every answer given. Story lists appear under **Word lists** as **Stories**, where any story can be switched off. The weekly summary email gains a reading line per child.
- **Data model:** `reading_story` (`id`, `slug`, `grade`, `title`, `paragraphs_json`, `active`) and `reading_question` (`id`, `story_id`, `position`, `kind`, `prompt`, `correct`, `wrong_json`, `explanation`), seeded from the content files at startup like the words; `reading_attempt` (`id`, `child_id`, `story_id`, `started_at`, `ended_at`, `completed`, `active_ms`); `reading_answer` (`id`, `attempt_id`, `question_id`, `choices_json`, `correct_choice`, `served_at`, `chosen`, `is_correct`, `response_ms`, `answered_at`). These are separate from word practice, so no word figure changes.

**Choices to confirm before building the app (after the pilot):**

| Choice              | Default in this phase                  | Alternative                                          |
| ------------------- | -------------------------------------- | ---------------------------------------------------- |
| Reading grade       | Separate from the word grade, starts 3 | Follow the word grade                                |
| Feedback            | After each question, with explanation  | All at the end, so earlier answers cannot give hints |
| Daily limit         | Reading counts toward it               | Reading has its own limit, or none                   |
| Grade 3 at launch   | 15 stories                             | More at launch, at the cost of review time           |
| Questions per story | 5                                      | 4 for grade 3, rising to 6 for older grades          |

**Decided while building it:**

- The reading pages live under `/play/read`, so the child-only guard and the no-caching rule for `/play` cover them too.
- Time between two actions counts as reading up to 5 minutes (word practice caps it at 1 minute), since reading the story before the first question takes a few minutes.
- "Stop for now" keeps the story open to pick up later; one left untouched for 7 days is closed unfinished.
- Reading does not count toward the day streak, which stays about word practice. The home page keeps "Start practicing" and adds "Read a story" beside it.
- The reading grade can be set only to a grade that has stories (or the one the child is on).
- The `child.reading_grade` column is added in place with `ALTER TABLE`. The generated migration rebuilt the `child` table, which would have deleted every child's history through the cascading foreign keys, so it was replaced, and a test checks that the migration keeps an existing child's data.

**Accepts when (pilot):** `reading:check` passes on 5 grade-3 stories, its rules are unit-tested, each story has a review entry, and the parent has read them and approved the format.

**Accepts when (feature):** grade 3 has 15 stories that pass `reading:check`, each reviewed by Claude and by the parent; a child can read a story and answer its questions with JavaScript on and off; the correct answer is not in any response before it is answered (an end-to-end test); a child can reach only their own attempts; stopping and picking up works; reading figures match hand-worked values on a fixture, including literal versus inference accuracy; the reading-grade suggestion and automatic move-up work; word practice figures are unchanged by reading; axe reports no violations on the new pages in both themes; all unit and end-to-end tests pass.

---

## 8. Decisions to confirm before Phase 1

Defaults are in place for each; change any of them now and the plan adjusts.

| Decision                    | Default in this plan                       | Alternative                                                                |
| --------------------------- | ------------------------------------------ | -------------------------------------------------------------------------- |
| Unknown name typed by child | Rejected; parent creates profiles          | Auto-create a profile for any new name                                     |
| Image delivery              | GitHub Actions to GHCR                     | Build locally and `docker load` on the NAS                                 |
| HTTPS                       | Plain HTTP port, reverse proxy recommended | Require HTTPS from day one and enable the service worker in the base build |
| Next-grade unlock           | Parent approves suggestion                 | Automatic at 80%                                                           |
| Spelling questions          | On, parent can turn off                    | Off until parent turns on                                                  |
| Words per grade in v1       | 120                                        | More at launch, at the cost of review time for the parent                  |
