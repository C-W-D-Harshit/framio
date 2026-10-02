import { Database } from "bun:sqlite";
import { mkdirSync, realpathSync } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { join } from "node:path";
import { isAlive, processBirth } from "./process-liveness";

/** SQLite publishes state and claims together. A live owner has no expiry. */
export function openUpdateStorage(directory: string) {
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const db = new Database(join(directory, "updates.sqlite"), { create: true });
  db.exec(
    "PRAGMA busy_timeout=10000; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; CREATE TABLE IF NOT EXISTS state (key TEXT PRIMARY KEY, value TEXT NOT NULL); CREATE TABLE IF NOT EXISTS owners (key TEXT PRIMARY KEY, pid INTEGER NOT NULL, token TEXT NOT NULL, started TEXT)",
  );
  db.transaction(() => {
    const columns = db.query("PRAGMA table_info(owners)").all() as {
      name: string;
    }[];
    if (!columns.some((column) => column.name === "started"))
      db.exec("ALTER TABLE owners ADD COLUMN started TEXT");
  }).immediate();
  const started = processBirth(process.pid);
  const alive = (owner: { pid: number; started: string | null }) => {
    if (!isAlive(owner.pid)) return false;
    const actual = processBirth(owner.pid);
    return !owner.started || !actual || owner.started === actual;
  };
  return {
    close: () => db.close(),
    read: (key: string): unknown => {
      const row = db.query("SELECT value FROM state WHERE key=?").get(key) as {
        value: string;
      } | null;
      return row ? JSON.parse(row.value) : null;
    },
    write: (key: string, value: unknown) =>
      db
        .query(
          "INSERT INTO state VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
        )
        .run(key, JSON.stringify(value)),
    owned: (key: string) => {
      const row = db
        .query("SELECT pid, started FROM owners WHERE key=?")
        .get(key) as {
        pid: number;
        started: string | null;
      } | null;
      return !!row && alive(row);
    },
    claim: (key: string) =>
      db
        .transaction(() => {
          const row = db
            .query("SELECT pid, started FROM owners WHERE key=?")
            .get(key) as { pid: number; started: string | null } | null;
          if (row && alive(row)) return null;
          const token = randomUUID();
          db.query(
            "INSERT INTO owners VALUES (?,?,?,?) ON CONFLICT(key) DO UPDATE SET pid=excluded.pid, token=excluded.token, started=excluded.started",
          ).run(key, process.pid, token, started);
          return token;
        })
        .immediate(),
    release: (key: string, token: string) =>
      db.query("DELETE FROM owners WHERE key=? AND token=?").run(key, token),
  };
}
export function installationIdentity(executable: string) {
  const target = realpathSync(executable);
  return { target, id: createHash("sha256").update(target).digest("hex") };
}
