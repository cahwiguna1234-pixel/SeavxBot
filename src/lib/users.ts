import type { Database } from "bun:sqlite";

export type UserRole = "free" | "premium";

export interface User {
  id: number;
  jid: string;
  lid: string | null;
  name: string | null;
  role: UserRole;
  premiumUntil: number | null;
  premiumSince: number | null;
  premiumGrantedBy: string | null;
  messageCount: number;
  commandCount: number;
  firstSeenAt: number;
  lastSeenAt: number;
}

export interface UserIdentity {
  jid: string;
  lid?: string;
  name?: string;
}

export interface UserStore {
  touch(identity: UserIdentity, isCommand: boolean): void;
  get(jid: string): User | null;
  grantPremium(jid: string, until: number | null, grantedBy: string): User;
  revokePremium(jid: string): User | null;
  /** Demotes every expired grant once; returns how many rows changed. */
  demoteExpired(now?: number): number;
}

/** Lives here so the schema bootstrap in db.ts and the tests cannot drift. */
export const USERS_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS users (
  id                 INTEGER PRIMARY KEY,
  jid                TEXT NOT NULL UNIQUE,
  lid                TEXT UNIQUE,
  name               TEXT,
  role               TEXT NOT NULL DEFAULT 'free' CHECK (role IN ('free', 'premium')),
  premium_until      INTEGER,
  premium_since      INTEGER,
  premium_granted_by TEXT,
  message_count      INTEGER NOT NULL DEFAULT 0,
  command_count      INTEGER NOT NULL DEFAULT 0,
  first_seen_at      INTEGER NOT NULL,
  last_seen_at       INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS users_role ON users(role);
CREATE INDEX IF NOT EXISTS users_premium_until ON users(premium_until);
`;

interface UserRow {
  id: number;
  jid: string;
  lid: string | null;
  name: string | null;
  role: UserRole;
  premium_until: number | null;
  premium_since: number | null;
  premium_granted_by: string | null;
  message_count: number;
  command_count: number;
  first_seen_at: number;
  last_seen_at: number;
}

const toUser = (row: UserRow): User => ({
  id: row.id,
  jid: row.jid,
  lid: row.lid,
  name: row.name,
  role: row.role,
  premiumUntil: row.premium_until,
  premiumSince: row.premium_since,
  premiumGrantedBy: row.premium_granted_by,
  messageCount: row.message_count,
  commandCount: row.command_count,
  firstSeenAt: row.first_seen_at,
  lastSeenAt: row.last_seen_at,
});

/** A grant with no expiry is permanent; the role still has to be checked. */
export function isPremium(user: User, now: number = Date.now()): boolean {
  return (
    user.role === "premium" &&
    (user.premiumUntil === null || user.premiumUntil > now)
  );
}

export function createUserStore(db: Database): UserStore {
  const select = db.query<UserRow, [string]>(
    "SELECT * FROM users WHERE jid = ?",
  );
  const demoteOne = db.query(
    `UPDATE users
        SET role = 'free', premium_until = NULL, premium_since = NULL,
            premium_granted_by = NULL
      WHERE jid = ?`,
  );
  const demoteAll = db.query(
    `UPDATE users
        SET role = 'free', premium_until = NULL, premium_since = NULL,
            premium_granted_by = NULL
      WHERE role = 'premium' AND premium_until IS NOT NULL AND premium_until <= ?`,
  );
  // A LID-first row keeps its counters: the learned phone number rewrites
  // `jid` in place instead of inserting a duplicate.
  const adoptPn = db.query(
    "UPDATE users SET jid = ?, lid = ? WHERE jid = ? AND jid <> ?",
  );
  const upsert = db.query(
    `INSERT INTO users
       (jid, lid, name, message_count, command_count, first_seen_at, last_seen_at)
     VALUES (?, ?, ?, 1, ?, ?, ?)
     ON CONFLICT(jid) DO UPDATE SET
       lid = COALESCE(excluded.lid, users.lid),
       name = COALESCE(excluded.name, users.name),
       message_count = users.message_count + 1,
       command_count = users.command_count + excluded.command_count,
       last_seen_at = excluded.last_seen_at`,
  );
  const grant = db.query(
    `INSERT INTO users
       (jid, role, premium_until, premium_since, premium_granted_by,
        first_seen_at, last_seen_at)
     VALUES (?, 'premium', ?, ?, ?, ?, ?)
     ON CONFLICT(jid) DO UPDATE SET
       role = 'premium',
       premium_until = excluded.premium_until,
       premium_since = excluded.premium_since,
       premium_granted_by = excluded.premium_granted_by`,
  );
  const revoke = db.query(
    `UPDATE users
        SET role = 'free', premium_until = NULL, premium_since = NULL,
            premium_granted_by = NULL
      WHERE jid = ?`,
  );

  const get = (jid: string): User | null => {
    const row = select.get(jid);
    if (!row) return null;
    if (row.role === "premium" && row.premium_until !== null && row.premium_until <= Date.now()) {
      demoteOne.run(jid);
      return toUser(select.get(jid)!);
    }
    return toUser(row);
  };

  return {
    touch(identity, isCommand) {
      const now = Date.now();
      const lid = identity.lid || null;
      const name = identity.name || null;

      db.transaction(() => {
        if (lid) adoptPn.run(identity.jid, lid, lid, identity.jid);
        upsert.run(identity.jid, lid, name, isCommand ? 1 : 0, now, now);
      })();
    },

    get,

    grantPremium(jid, until, grantedBy) {
      const now = Date.now();
      grant.run(jid, until, now, grantedBy, now, now);
      return toUser(select.get(jid)!);
    },

    revokePremium(jid) {
      revoke.run(jid);
      return get(jid);
    },

    demoteExpired(now = Date.now()) {
      return demoteAll.run(now).changes;
    },
  };
}
