# Vocab

A self-hosted vocabulary practice app for kids, with a parent dashboard. It runs as a single
container with a SQLite database. See [PLAN.md](PLAN.md) for the full design and build phases.

It is built for one family on a home network: a child types their first name and practices,
and a parent signs in to see how it is going. To put it on a TrueNAS server, go to
[Install on TrueNAS SCALE](#install-on-truenas-scale-2510).

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
lists in `content/` (120 words each for grades 3 to 12) are loaded or updated at the same time.

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

## Parent dashboard

Each child has four tabs under **For parents**:

- **Progress**: accuracy, time practiced, days and streaks, sessions, where the words stand,
  trouble words, results by kind of question, retention, guessing and time of day, for the last
  7 days, the last 30 days or all time. Every chart has the same numbers in a table. The page
  also offers the move to the next grade, and a CSV download of every answer.
- **Sessions**: each session with its questions and answers. A session that should not count
  can be deleted.
- **Words**: every word the child has met, and every answer given for each.
- **Reading**: stories read, time reading, and how many answers were right, split into answers
  written in the story and answers that had to be worked out from it. Each story read can be
  opened to see every answer given. The page also offers the move to the next reading grade.
- **Settings**: name, word grade, reading grade and practice settings, and the placement quiz.

"Time practiced" is active time: gaps between actions count only up to one minute, so a tablet
left open does not add to it. Days and hours follow the `TZ` setting.

## Reading

Next to word practice, a child can press **Read a story**. They read a short story (three to five
paragraphs at grade 3), with a button by each paragraph that reads it aloud, and answer five
questions about it one at a time while the story stays on screen. Some answers are written in the
story; others have to be worked out from it. After each answer the child sees whether it was right
and a short explanation of where the answer comes from. A story can be stopped and picked up later.

- Each child has a **reading grade**, separate from their word grade (default 3), set on the
  Settings tab. Stories come in order; once all of a grade's stories are read, the one read
  longest ago comes back.
- After five stories at a grade averaging 80% or more, with at least 70% on the answers that must
  be worked out, the Reading tab offers the next reading grade (or the child moves up by
  themselves, if you tick that setting). For now only grade 3 has stories.
- Reading time counts toward the same daily limit as word practice.
- **Stories** in the parent menu lists every story. Open one to read it with its questions and
  answers, and switch off any you do not want used.

The stories are written and reviewed ahead of time, not generated while the app runs. They live in
`content/reading/grade-N.json`; `npm run reading:check` checks them, and
`content/reading/REVIEW.md` records the review of each one. PLAN.md Phase 12 has the rules.

## Placement quiz

To find the grade a child should start at, open their **Settings** tab and choose **Give them a
placement quiz**. The next time the child opens the app, they are offered a quick quiz before
practice. It asks five "what does this word mean?" questions from one grade's built-in words,
starting at the child's current grade, and moves up a grade after 4 or 5 right answers and down
a grade after fewer. It stops once it has found the highest grade the child passes, usually after
10 to 20 questions. An "I don't know this one" button keeps guessing down.

The quiz shows the child no right or wrong answers and no score, and it changes nothing on its
own: it does not move words between boxes or count toward the dashboard. Its result appears on
the Settings tab, with each grade's score and a button to move the child to the grade it
suggests. A quiz can be cancelled before it is finished, and one left alone for a week is closed.

## Weekly summary email

Every Monday at 7:00 in the morning (in `TZ`), the app can email you a summary of the week before:
for each child, days and minutes practiced, sessions finished, new and mastered words, accuracy
compared with the week before, the most-missed words, grade progress, and a note when a child
is ready for the next grade. **Account → See this week's summary** shows the same thing in the
app, whether or not email is set up.

It is off until you turn it on, and it is the only time the app connects to anything outside
your network. It is sent through Gmail, so you need a Gmail account and an app password for it:

1. Use a Gmail account just for this, rather than your own. Anyone who can read the app's YAML in
   TrueNAS can see its app password.
2. Turn on **2-Step Verification** for that account (Google Account → Security). App passwords
   need it.
3. Go to <https://myaccount.google.com/apppasswords>, make an app password named `Vocab`, and
   copy the 16 letters it shows.
4. In TrueNAS, edit the app's YAML: remove the `#` from the `GMAIL_USER` and
   `GMAIL_APP_PASSWORD` lines, fill in the address and the app password, and save.
5. In the app, open **Account**, tick **Send a weekly summary**, enter the address to send to
   (it can be any address, such as your own), and save. Press **Send a test email now** to check
   that it works.

The first summary arrives the Monday after you turn it on. If a send fails, the Account page
shows why, and the app tries again each hour, up to six times that week. To stop the emails,
untick the box. To stop the app from ever sending, take the two lines out of the YAML again.

The app password is only ever read from the environment. It is never stored in the database or
in backups, and it is never written to the logs.

## Word lists

**Word lists** in the parent menu shows the ten built-in lists (grades 3 to 12, 120 words each)
and any lists of your own.

- Any list, or any single word, can be switched off so it is no longer asked.
- **Make your own list** for a grade, then paste words (one per line or separated by commas) and
  fill in a kind of word, a short meaning and a sentence for each. The meaning must not use the
  word, and the sentence must use it exactly once.
- New words from your own lists are given before new words from the built-in lists.
- A word or list can be deleted until a child has been asked it. After that it can only be
  switched off, so the child's history stays whole.

## Design system

Colors, sizes and timings are defined once in `src/lib/styles/tokens.css`; the components are in
`src/lib/components`. Start the app and open `/styleguide` to see all of them together. The
light, dark and match-this-device themes are switched with the buttons at the top of every page.

## Run the production image locally

```sh
docker compose -f compose.dev.yaml up --build   # or: podman compose ...
```

Then open <http://localhost:3000> (the setup code is `dev-setup-token`). The container runs as
UID 568 with a read-only root filesystem; `/data` is the only writable path. The image has no
shell or package manager in it, only Node and the app.

## Configuration

| Variable             | Required   | Purpose                                                                           |
| -------------------- | ---------- | --------------------------------------------------------------------------------- |
| `ORIGIN`             | production | Exact origin used to reach the app, e.g. `http://192.168.1.10:30080`              |
| `DATA_DIR`           | no         | Directory for the database and backups (default `./data`, `/data` in the image)   |
| `TZ`                 | no         | Time zone for day boundaries, e.g. `America/New_York`                             |
| `SETUP_TOKEN`        | first run  | One-time code for creating the parent account at `/setup`                         |
| `TRUST_PROXY`        | no         | `true` only behind a reverse proxy: read visitor addresses from `X-Forwarded-For` |
| `PORT`               | no         | Listen port (default `3000`)                                                      |
| `GMAIL_USER`         | no         | Gmail address the weekly summary is sent from                                     |
| `GMAIL_APP_PASSWORD` | no         | That account's app password. Without both, email stays off                        |

`ORIGIN` must match what is in the browser's address bar exactly (scheme, host and port).
Form submissions from any other origin are rejected with a 403.

## Install on TrueNAS SCALE 25.10

TrueNAS runs a ready-made image; it does not build one. So the image is published first, then
installed from [compose.truenas.yaml](compose.truenas.yaml).

### 1. Publish the image

Pushing a version tag makes GitHub Actions test, scan and publish the image:

```sh
git tag v1.3.0
git push origin v1.3.0
```

When the **CI** run on GitHub is green, the image is at `ghcr.io/bhager42/vocabwebapp:1.3.0`
and also at `:latest`, which the YAML below uses. A GitHub release for the tag lists what
changed since the previous one. A new package on GitHub starts out private. Either make it
public (on GitHub: your profile → Packages → vocabwebapp → Package settings → Change
visibility), or give TrueNAS a sign-in for
`ghcr.io` (Apps → Configuration → Sign-in to a Docker registry) using a GitHub token that has
the `read:packages` permission.

Without a registry: build on this machine and copy the image across, then change
`pull_policy: always` to `pull_policy: never` in the compose file.

```sh
docker build -t ghcr.io/bhager42/vocabwebapp:latest .
docker save ghcr.io/bhager42/vocabwebapp:latest | ssh admin@NAS_ADDRESS sudo docker load
```

### 2. Install the app

This is the app's YAML, the same as [compose.truenas.yaml](compose.truenas.yaml):

```yaml
# Vocab on TrueNAS SCALE 25.10.
#
# Paste this into Apps > Discover Apps > (three dots) > Install via YAML, after changing
# the lines marked CHANGE. README.md walks through every step.
services:
  vocab:
    # Always the newest published version. To stay on one version, put its number in
    # place of latest, such as :1.3.0.
    image: ghcr.io/bhager42/vocabwebapp:latest
    # Fetch the newest image whenever the app is started or saved.
    pull_policy: always
    # The TrueNAS "apps" user.
    user: '568:568'
    restart: unless-stopped
    ports:
      - '30080:3000'
    environment:
      # CHANGE: exactly what you type in the browser to reach the app. No slash at the end.
      ORIGIN: 'http://192.168.1.10:30080'
      DATA_DIR: /data
      # CHANGE if you do not live in US Eastern time. Days and streaks follow this.
      TZ: America/New_York
      # CHANGE: a long random code. It is asked for once, when you create your account.
      SETUP_TOKEN: 'change-me-to-a-long-random-code'
      # Set to 'true' only if a reverse proxy sits in front of the app.
      TRUST_PROXY: 'false'
      # Optional: the weekly summary email. Remove the # from both lines and fill them in
      # to let the app send it through Gmail. README.md explains how to get an app password.
      # GMAIL_USER: 'your.vocab.account@gmail.com'
      # GMAIL_APP_PASSWORD: 'abcd efgh ijkl mnop'
    volumes:
      # A volume TrueNAS keeps with its other app data, under /mnt/.ix-apps. To keep the
      # data in a dataset of your own instead, put its path here, such as
      # /mnt/tank/apps/vocab:/data, and remove the volumes section at the end.
      - vocab-data:/data
    # Nothing in the container can be written to except /data and a scratch /tmp.
    read_only: true
    tmpfs:
      - /tmp
    cap_drop:
      - ALL
    security_opt:
      - no-new-privileges:true
    healthcheck:
      test:
        - CMD
        - /nodejs/bin/node
        - -e
        - "fetch('http://127.0.0.1:3000/healthz').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"
      interval: 30s
      timeout: 5s
      start_period: 15s
      retries: 3
    deploy:
      resources:
        limits:
          cpus: '1.0'
          memory: 512M

volumes:
  vocab-data:
```

1. Copy the YAML above and change the lines marked `CHANGE`:
   - `ORIGIN`: exactly what you will type in the browser, such as `http://192.168.1.10:30080`.
   - `SETUP_TOKEN`: a long random code of your own.
   - `TZ`, if you are not in US Eastern time.
2. In TrueNAS, go to **Apps → Discover Apps**, open the three-dot menu and choose
   **Install via YAML**. Name the app `vocab`, paste the YAML in, and save.
3. Wait for the app to show as running.

The data is kept in a volume named `vocab-data` that TrueNAS stores with its other app data,
in the hidden `ix-apps` dataset (`/mnt/.ix-apps`). Nothing needs to be set up for it. It is
kept when the app is stopped or updated, and removed if the app is deleted with its volumes.

To keep the data in a dataset of your own instead, add one with the **Apps** preset (so the
`apps` user, number 568, owns it), put its path in place of `vocab-data` in the `volumes:` line,
such as `/mnt/tank/apps/vocab:/data`, and remove the `volumes:` section at the end of the file.
Use a pool in the NAS itself, not an SMB or NFS share: the database does not work reliably over
a network share.

### 3. First run

1. On any device on your network, open `http://NAS_ADDRESS:30080/setup`.
2. Enter the setup code, then choose a username and a password of at least 12 characters.
3. Add your child under **Children** and set their grade.
4. On the device your child will use, open `http://NAS_ADDRESS:30080`, type their name and play
   a session. Then sign in as the parent from a different device and look at **Progress**.

Once your account exists the setup page is closed for good, and `SETUP_TOKEN` can be removed
from the app's YAML.

Two things to know:

- **Use the address in `ORIGIN`, always.** If the NAS is reached by another name or address,
  pages open but every form is refused with a page that names the address the app expects.
- **Wrong-password limits are per network address.** If, after one device types a wrong
  password five times, every device is told to wait, the app is seeing one address for the
  whole network. That is safe, only inconvenient: wait 15 minutes.

For HTTPS, put a reverse proxy in front of the app, set `ORIGIN` to the `https://` address and
set `TRUST_PROXY` to `'true'`.

### Update to a new version

1. Publish the new version (step 1, with the new number).
2. In TrueNAS, go to **Apps → vocab → Edit** and save without changing anything. Because the
   YAML uses `:latest` with `pull_policy: always`, the app fetches the newest image and
   restarts on it. The footer of every page shows the version now running.

The app also fetches the newest image whenever it starts, such as after the NAS reboots. To
stay on one version instead, put its number in place of `latest` in the `image:` line, such as
`ghcr.io/bhager42/vocabwebapp:1.3.0`.

Before a new version changes the structure of the database, the app saves a copy as
`backups/pre-migrate-<date>-<time>.db`. To go back, put the old version's number in place of
`latest` in the `image:` line and restore that file as described below.

## Backups

Everything the app knows is in one file, `vocab.db`, in the data folder. Copies are kept in
its `backups` folder:

| File                    | Made                                              | Kept      |
| ----------------------- | ------------------------------------------------- | --------- |
| `nightly-<time>.db`     | Once a day while the app runs                     | Newest 14 |
| `pre-migrate-<time>.db` | Before an update changes the database's structure | Newest 5  |

Times in the file names are UTC. You can also download a copy at any moment from **Account →
Backups** in the parent area. A backup holds your children's names and results and your
(hashed) password, so keep it somewhere private.

These copies sit on the same disks as the original. To guard against losing the pool, also add
a **Periodic Snapshot Task** (Data Protection in TrueNAS) for the `ix-apps` dataset on your
apps pool, or for your own dataset if you chose one, and, if you can, replicate it or copy a
downloaded backup elsewhere now and then.

### Restore from a backup

1. In TrueNAS, stop the app (**Apps → vocab → Stop**).
2. Open a shell on the NAS (**System → Shell**) and find the data folder. With the default
   volume, ask Docker where it is; with your own dataset, it is that dataset's path.

   ```sh
   sudo docker volume ls | grep vocab-data          # the full name, e.g. ix-vocab_vocab-data
   sudo docker volume inspect ix-vocab_vocab-data --format '{{ .Mountpoint }}'
   ```

3. Become root (`sudo -i`), go to that folder and put the backup in place of the database:

   ```sh
   cd /mnt/.ix-apps/docker/volumes/ix-vocab_vocab-data/_data    # the folder from step 2
   mv vocab.db vocab.db.before-restore
   rm -f vocab.db-wal vocab.db-shm
   cp backups/nightly-20261110-080000.db vocab.db    # the copy you want back
   chown apps:apps vocab.db
   ```

   To restore a file you downloaded, copy it to that folder first and use its name instead.

4. Start the app again and sign in.

The two `rm`'d files hold changes not yet written into the old `vocab.db`; left behind, they
would be applied to the restored file and damage it. Everything after the backup was made is
lost, which is why the old file is kept as `vocab.db.before-restore` until you are sure.

This procedure was carried out against the production image on 10 November 2026: an account and
a child were created, a backup was downloaded, the data volume was destroyed, the backup was
put back as `vocab.db`, and the same username and password signed in and showed the child.

## Continuous integration

[.github/workflows/ci.yml](.github/workflows/ci.yml) runs on every push and pull request:
formatting and lint, type check, word-list check, unit tests, end-to-end tests, then an image
build that is started with the TrueNAS restrictions, scanned with Trivy (any high or critical
finding fails the run) and listed in an SBOM. A `v*.*.*` tag also publishes the image to GHCR.

## License

Copyright (C) 2026 Brad Hager

This program is free software: you can redistribute it and/or modify it under the terms of the
GNU Affero General Public License as published by the Free Software Foundation, either version 3
of the License, or (at your option) any later version. It is distributed in the hope that it will
be useful, but WITHOUT ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or
FITNESS FOR A PARTICULAR PURPOSE. See [LICENSE](LICENSE) for the full text.

The bundled Atkinson Hyperlegible font keeps its own license, the SIL Open Font License.
