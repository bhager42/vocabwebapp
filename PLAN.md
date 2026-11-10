# Vocab Web App — Development Plan

A self-hosted vocabulary practice app for a third grader (growing through grade 6), with a parent dashboard. Runs as a single container on TrueNAS SCALE 25.10.

This plan is written to be executed by Claude Code one phase at a time. Each phase ends with acceptance criteria; do not start the next phase until they pass.

> **Instruction to the executing agent:** version numbers are deliberately not pinned in this document. At the start of Phase 1, look up the current stable/LTS release of each dependency and pin those exactly (lockfile plus image digests). Do not add any dependency not listed here without stating why.

---

## 1. Goals and non-goals

**Goals**

- Child types his first name and starts practicing. No username, no password.
- Short practice sessions (about 10 questions, 5–10 minutes) with immediate, encouraging feedback.
- Grade-appropriate word lists for grades 3, 4, 5 and 6, starting at grade 3.
- Words come back on a schedule (spaced repetition) so they are actually remembered.
- Parent logs in with a password and sees progress, accuracy, time spent and trouble words.
- Parent can add custom word lists (for example the weekly list from school).
- Light and dark mode, accessible, works well on a tablet, Chromebook or desktop.
- One container, one SQLite file, no external services, no telemetry.

**Non-goals for v1**

- Exposure to the public internet.
- Multi-family / multi-tenant use.
- Native mobile apps.
- AI-generated content at runtime (word content is authored at build time and reviewed).

---

## 2. Learning design

### 2.1 Question types

Definition plus multiple choice is the right foundation for this age, but on its own it only trains recognition. The app uses four question types and introduces the harder ones as a word becomes familiar:

| Type          | Prompt                             | Answer                              | Used when                                               |
| ------------- | ---------------------------------- | ----------------------------------- | ------------------------------------------------------- |
| `word_to_def` | The word                           | Pick the definition (4 choices)     | Word is new                                             |
| `def_to_word` | The definition                     | Pick the word (4 choices)           | Word is somewhat known                                  |
| `cloze`       | Example sentence with a blank      | Pick the word that fits (4 choices) | Word is mostly known                                    |
| `spell`       | Definition plus a "hear it" button | Type the word                       | Word is nearly mastered (parent can turn this type off) |

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
- A word is **mastered** when it is answered correctly out of box 5.
- A session is 10 questions: due reviews first, then at most 4 new words. Both numbers are parent settings.

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

- v1 ships 120 words per grade for grades 3–6 (480 total), as JSON seed files in `content/grade-N.json`.
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
| `practice_session` | `id`, `child_id`, `started_at`, `ended_at`, `active_ms`, `question_count`, `completed`                                  |
| `question`         | `id`, `practice_session_id`, `word_id`, `type`, `choices_json`, `correct_choice`, `served_at`                           |
| `answer`           | `question_id`, `chosen`, `is_correct`, `response_ms`, `is_retry`, `answered_at`                                         |
| `login_attempt`    | `ip`, `at`, `success` (for rate limiting)                                                                               |
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
- The name lookup is rate limited and the response does not list valid names.

Accepted trade-off: anyone on the home network who knows his name can practice as him. The worst case is skewed stats, and the parent can delete a practice session from the dashboard.

### 4.2 Parent access

- First run: `/setup` is available only while no parent exists, and requires the one-time `SETUP_TOKEN` environment value. It creates the single parent account.
- Password: minimum 12 characters, hashed with Argon2id using current OWASP parameters.
- Login rate limit: 5 failures per 15 minutes per IP, with increasing delay. Uniform error message and timing.
- Parent session: 12 hours idle, 7 days absolute; rotated on login; "log out everywhere" in settings.
- Passkey (WebAuthn) login is a Phase 8 option. It needs HTTPS and a stable hostname, so it is not in the base build.

### 4.3 Web security baseline

- **Cookies:** `HttpOnly`, `SameSite=Strict`, `Path=/`. When `ORIGIN` is https, also `Secure` and the `__Host-` prefix.
- **CSRF:** SvelteKit origin checking stays on; every state change is a POST form action; `ORIGIN` is set explicitly.
- **Content Security Policy:** nonce-based via SvelteKit's `csp` config: `default-src 'self'`; `script-src 'self' 'nonce-…'`; `style-src 'self'`; `style-src-attr` limited by hash to the one inline style attribute SvelteKit's route announcer uses; `img-src 'self' data:`; `font-src 'self'`; `connect-src 'self'`; `object-src 'none'`; `base-uri 'none'`; `form-action 'self'`; `frame-ancestors 'none'`. No inline event handlers and no third-party origins.
- **Other headers:** `X-Content-Type-Options: nosniff`, `Referrer-Policy: same-origin` (not `no-referrer`, which makes browsers send `Origin: null` on plain form posts and so breaks the CSRF check for forms submitted without JavaScript), `Cross-Origin-Opener-Policy: same-origin`, `Cross-Origin-Resource-Policy: same-origin`, a `Permissions-Policy` that disables camera, microphone, geolocation and the rest. `Strict-Transport-Security` only when `ORIGIN` is https.
- **Input:** every form and parameter validated with Valibot; only parameterized queries through Drizzle; Svelte's default output escaping, with `{@html}` banned by a lint rule.
- **Authorization:** checked centrally in `hooks.server.ts` by route group, and again in each load function and action. Tests cover child-to-parent and child-to-other-child access.
- **Privacy:** only a first name is stored for the child. No analytics, no outbound network calls at runtime, no logging of names or answers to stdout.
- **Supply chain:** exact-pinned lockfile, `npm ci`, `npm audit` and a Trivy image scan in CI, base images pinned by digest, SBOM generated at build.

### 4.4 Container hardening

- Multi-stage build; final image has production dependencies and build output only.
- Runs as UID/GID 568 (the TrueNAS `apps` user), never root.
- `read_only: true` root filesystem, `/tmp` as tmpfs, `/data` the only writable mount.
- `cap_drop: [ALL]`, `security_opt: [no-new-privileges:true]`, memory and CPU limits.
- `HEALTHCHECK` against `/healthz`, which also verifies the database is writable.

### 4.5 HTTPS

The container serves plain HTTP on one port. Recommended: put it behind a reverse proxy that already runs on the NAS (Nginx Proxy Manager, Caddy or Traefik) with a real certificate for a hostname such as `vocab.home.example`. HTTPS is required for `Secure` cookies, the service worker, home-screen install and passkeys. Without it the app still works over `http://nas-ip:port`, with those features off.

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

**Active time** is not wall-clock time. It is the sum of gaps between consecutive events in a session (question served, answered, next), with each gap capped at 60 seconds. Walking away from the tablet does not inflate the number.

**Other parent features**

- Per-word history: every answer he gave for a word.
- Session log: each session with its questions and answers; delete a session.
- Manage children: add, rename, set grade, archive.
- Manage words: disable built-in words, create custom lists, paste a list of words and fill in definition and sentence.
- Settings: questions per session, new words per session, spelling questions on/off, daily cap, auto-unlock next grade.
- Export: CSV of answers and a full database backup download.

---

## 6. Deployment on TrueNAS SCALE 25.10

### 6.1 Configuration

| Variable      | Example                                                     | Purpose                                          |
| ------------- | ----------------------------------------------------------- | ------------------------------------------------ |
| `ORIGIN`      | `https://vocab.home.example` or `http://192.168.1.10:30080` | CSRF origin check, cookie flags, HSTS            |
| `DATA_DIR`    | `/data`                                                     | SQLite file and backups                          |
| `TZ`          | `America/Chicago`                                           | Day boundaries for streaks and charts            |
| `SETUP_TOKEN` | long random string                                          | One-time first-run setup                         |
| `TRUST_PROXY` | `true` / `false`                                            | Whether to read client IP from `X-Forwarded-For` |
| `PORT`        | `3000`                                                      | Listen port inside the container                 |

### 6.2 Storage

- Create a dataset, for example `tank/apps/vocab`, owned by `apps:apps` (568:568), and mount it at `/data`.
- Local ZFS dataset only. Do not put the SQLite file on an SMB or NFS share.
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
    image: ghcr.io/OWNER/vocabwebapp:1.0.0
    user: '568:568'
    restart: unless-stopped
    ports:
      - '30080:3000'
    environment:
      ORIGIN: 'http://NAS_IP:30080'
      DATA_DIR: /data
      TZ: America/Chicago
      SETUP_TOKEN: 'CHANGE_ME'
      TRUST_PROXY: 'false'
    volumes:
      - /mnt/tank/apps/vocab:/data
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

**Accepts when:** CI is green; the image scan has no high or critical findings; a restore from a backup file is performed and documented; the app is installed on the NAS from the compose file and a full child session and parent login succeed from another device.

### Phase 8 — Optional extras

Pick individually after a few weeks of real use:

- Passkey login for the parent (needs HTTPS).
- Service worker for app-shell caching and home-screen install polish.
- Placement quiz to pick a starting grade.
- Weekly summary page ("this week he learned 14 words").
- Extra question types: synonym/antonym matching, picture prompts.
- Printable review sheet of trouble words.

---

## 8. Decisions to confirm before Phase 1

Defaults are in place for each; change any of them now and the plan adjusts.

| Decision                    | Default in this plan                       | Alternative                                                                         |
| --------------------------- | ------------------------------------------ | ----------------------------------------------------------------------------------- |
| Unknown name typed by child | Rejected; parent creates profiles          | Auto-create a profile for any new name                                              |
| Image delivery              | GitHub Actions to GHCR                     | Build locally and `docker load` on the NAS                                          |
| HTTPS                       | Plain HTTP port, reverse proxy recommended | Require HTTPS from day one and enable passkeys and service worker in the base build |
| Next-grade unlock           | Parent approves suggestion                 | Automatic at 80%                                                                    |
| Spelling questions          | On, parent can turn off                    | Off until parent turns on                                                           |
| Words per grade in v1       | 120                                        | More at launch, at the cost of review time for the parent                           |
