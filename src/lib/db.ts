import { Database } from "bun:sqlite";
import fs from "node:fs";
import path from "node:path";
import { botConfig } from "@/lib/config";
import {
  SETTINGS_TABLE_SQL,
  createSettingsStore,
  type SettingsStore,
} from "@/lib/settings";
import { SCHEDULE_TABLE_SQL } from "@/lib/schedule";
import { USERS_TABLE_SQL, createUserStore, type UserStore } from "@/lib/users";

const SCHEMA_VERSION = 4;
const DEFAULT_PATH = "data/seavxbot.db";

/**
 * The env override keeps tests and one-off scripts off the live database
 * without teaching every caller to thread a path through.
 */
const configuredPath = (): string =>
  process.env.SEAVXBOT_DB_PATH || botConfig.storage?.path || DEFAULT_PATH;

const FALLBACK_WELCOME = "Welcome {mention} to *{group}*!";
const FALLBACK_GOODBYE = "Goodbye {name}.";
const FALLBACK_CLOSE_TIME = "23:00";
const FALLBACK_OPEN_TIME = "06:00";

/**
 * SQLite's own `user_version` doubles as the migration cursor, so there is no
 * bookkeeping table to keep in sync with the schema it describes.
 */
function migrate(db: Database): void {
  const row = db
    .query<{ user_version: number }, []>("PRAGMA user_version")
    .get();
  const version = row?.user_version ?? 0;
  if (version >= SCHEMA_VERSION) return;

  db.transaction(() => {
    db.exec(SETTINGS_TABLE_SQL);
    db.exec(SCHEDULE_TABLE_SQL);
    db.exec(USERS_TABLE_SQL);
    // Step per version: a database that already has `users` only gains the
    // column added in v4.
    if (version < 4) {
      db.exec(
        "ALTER TABLE users ADD COLUMN upscale2_count INTEGER NOT NULL DEFAULT 0",
      );
    }
    // A literal: PRAGMA does not accept bound parameters.
    db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`);
  })();
}

export function openDatabase(file: string): Database {
  fs.mkdirSync(path.dirname(file), { recursive: true });

  const db = new Database(file);
  // WAL keeps a slow reader from blocking the write that a command just made.
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA foreign_keys = ON");
  db.exec("PRAGMA busy_timeout = 5000");

  migrate(db);
  return db;
}

let handle: Database | undefined;
let store: SettingsStore | undefined;
let users: UserStore | undefined;

/** Opened on first use so importing this module never touches the disk. */
export function getDb(): Database {
  handle ??= openDatabase(configuredPath());
  return handle;
}

export function getGroupSettings(): SettingsStore {
  store ??= createSettingsStore(getDb(), {
    welcome_text: botConfig.messages?.welcome_text || FALLBACK_WELCOME,
    goodbye_text: botConfig.messages?.goodbye_text || FALLBACK_GOODBYE,
    auto_close_time:
      botConfig.schedule?.auto_close_time || FALLBACK_CLOSE_TIME,
    auto_open_time: botConfig.schedule?.auto_open_time || FALLBACK_OPEN_TIME,
  });
  return store;
}

export function getUsers(): UserStore {
  users ??= createUserStore(getDb());
  return users;
}
