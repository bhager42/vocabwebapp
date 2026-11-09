# Vocab

A self-hosted vocabulary practice app for kids, with a parent dashboard. It runs as a single
container with a SQLite database. See [PLAN.md](PLAN.md) for the full design and build phases.

Status: Phase 1 (scaffold and tooling) is complete. TrueNAS install instructions arrive in Phase 7.

## Develop

Requires Node 24 or newer (the container image uses Node 26 LTS).

```sh
npm install
npm run dev          # http://localhost:5173, database in ./data
```

| Command               | What it does                                                    |
| --------------------- | --------------------------------------------------------------- |
| `npm run check`       | Type-check TypeScript and Svelte                                |
| `npm run lint`        | Prettier and ESLint                                             |
| `npm run test:unit`   | Vitest unit tests (watch mode; add `-- --run` for a single run) |
| `npm run test:e2e`    | Build, start `server.js`, run Playwright tests against it       |
| `npm test`            | Unit tests, then end-to-end tests                               |
| `npm run db:generate` | Write a new SQL migration after editing the schema              |

Migrations in `drizzle/` are applied automatically when the app starts.

## Run the production image locally

```sh
docker compose -f compose.dev.yaml up --build   # or: podman compose ...
```

Then open <http://localhost:3000>. The container runs as UID 568 with a read-only root
filesystem; `/data` is the only writable path.

## Configuration

| Variable      | Required   | Purpose                                                              |
| ------------- | ---------- | -------------------------------------------------------------------- |
| `ORIGIN`      | production | Exact origin used to reach the app, e.g. `http://192.168.1.10:30080` |
| `DATA_DIR`    | no         | Directory for the database (default `./data`, `/data` in the image)  |
| `TZ`          | no         | Time zone for day boundaries, e.g. `America/Chicago`                 |
| `SETUP_TOKEN` | first run  | One-time token for creating the parent account (used from Phase 4)   |
| `TRUST_PROXY` | no         | `true` when behind a reverse proxy (used from Phase 4)               |
| `PORT`        | no         | Listen port (default `3000`)                                         |

`ORIGIN` must match what is in the browser's address bar exactly (scheme, host and port).
Form submissions from any other origin are rejected with a 403.
