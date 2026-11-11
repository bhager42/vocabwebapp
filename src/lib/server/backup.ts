// Copies of the database. See PLAN.md section 6.2.
//
// Three kinds, all written to <DATA_DIR>/backups:
// - pre-migrate-*.db  taken just before a new version changes the database's structure
// - nightly-*.db      taken once a day while the app runs; the newest 14 are kept
// - download-*.db     made when the parent asks for one, sent, and removed again
//
// Each is made with SQLite's VACUUM INTO, which writes a complete, consistent database to
// a new file while the app carries on working. This module has no SvelteKit imports so it
// can be used from unit tests.

import { existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync } from 'node:fs';
import path from 'node:path';
import type Database from 'better-sqlite3';

export type BackupKind = 'pre-migrate' | 'nightly' | 'download';

/** How many of each kind are kept; older ones are deleted. */
export const KEEP: Record<BackupKind, number> = { 'pre-migrate': 5, nightly: 14, download: 0 };

const DAY_MS = 24 * 60 * 60_000;
const HOUR_MS = 60 * 60_000;

/** `20261110-220000`: UTC, sorts by age, and has nothing a file system objects to. */
function stamp(now: Date): string {
	return now
		.toISOString()
		.replace(/\.\d+Z$/, '')
		.replace(/[-:]/g, '')
		.replace('T', '-');
}

const NAME = /^(pre-migrate|nightly|download)-(\d{8})-(\d{6})\.db$/;

export interface BackupFile {
	name: string;
	kind: BackupKind;
	createdAt: Date;
	bytes: number;
}

/** The backups in `dir`, newest first. Files that are not ours are ignored. */
export function listBackups(dir: string): BackupFile[] {
	if (!existsSync(dir)) return [];
	return readdirSync(dir)
		.flatMap((name) => {
			const match = NAME.exec(name);
			if (!match) return [];
			const [, kind, day, time] = match;
			const createdAt = new Date(
				`${day.slice(0, 4)}-${day.slice(4, 6)}-${day.slice(6)}T` +
					`${time.slice(0, 2)}:${time.slice(2, 4)}:${time.slice(4)}Z`
			);
			return [
				{ name, kind: kind as BackupKind, createdAt, bytes: statSync(path.join(dir, name)).size }
			];
		})
		.sort((a, b) => b.name.slice(-18).localeCompare(a.name.slice(-18)));
}

/**
 * Writes a backup of the open database and returns its path. The copy is written under
 * a temporary name and renamed when complete, so a half-written file is never mistaken
 * for a backup.
 */
export function writeBackup(
	client: Database.Database,
	dir: string,
	kind: BackupKind,
	now = new Date()
): string {
	mkdirSync(dir, { recursive: true });
	const file = path.join(dir, `${kind}-${stamp(now)}.db`);
	const partial = `${file}.partial`;
	rmSync(partial, { force: true });
	// The file name cannot be passed as a parameter here, so quote it as SQL text.
	client.exec(`VACUUM INTO '${partial.replaceAll("'", "''")}'`);
	renameSync(partial, file);
	return file;
}

/** Deletes all but the newest `KEEP[kind]` backups of a kind, and any half-written files. */
export function pruneBackups(dir: string, kind: BackupKind): string[] {
	if (!existsSync(dir)) return [];
	for (const name of readdirSync(dir)) {
		if (name.endsWith('.db.partial')) rmSync(path.join(dir, name), { force: true });
	}
	const old = listBackups(dir)
		.filter((backup) => backup.kind === kind)
		.slice(KEEP[kind]);
	for (const backup of old) rmSync(path.join(dir, backup.name), { force: true });
	return old.map((backup) => backup.name);
}

/** True when there is no nightly backup yet, or the newest is a day old. */
export function nightlyDue(dir: string, now = new Date()): boolean {
	const newest = listBackups(dir).find((backup) => backup.kind === 'nightly');
	// A little under a day, so an hourly check cannot drift a whole hour later each night.
	return !newest || now.getTime() - newest.createdAt.getTime() >= DAY_MS - HOUR_MS / 2;
}

/** Makes the nightly backup if one is due. Returns the new file's path, or null. */
export function runNightly(
	client: Database.Database,
	dir: string,
	now = new Date()
): string | null {
	if (!nightlyDue(dir, now)) return null;
	const file = writeBackup(client, dir, 'nightly', now);
	pruneBackups(dir, 'nightly');
	return file;
}

/**
 * Checks once an hour whether a nightly backup is due, starting a minute after the app
 * does. A failure is logged and tried again the next hour; it never stops the app.
 */
export function scheduleNightly(client: Database.Database, dir: string): () => void {
	const check = () => {
		try {
			const file = runNightly(client, dir);
			if (file) console.log(`Backup written: ${file}`);
		} catch (cause) {
			console.error('Backup failed:', cause);
		}
	};
	const first = setTimeout(check, 60_000);
	const hourly = setInterval(check, HOUR_MS);
	// Timers must not keep the process alive when it is asked to stop.
	first.unref();
	hourly.unref();
	return () => {
		clearTimeout(first);
		clearInterval(hourly);
	};
}
