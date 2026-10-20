import type { Database } from "bun:sqlite";
import type { GroupSettings } from "@/lib/settings";

/**
 * Only groups that opted into the nightly close/open have a row here, so the
 * scheduler's list needs no filtering.
 */
export const SCHEDULE_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS scheduled_groups (
  jid TEXT PRIMARY KEY
) WITHOUT ROWID;
`;

export type OpenStateAction = "close" | "open";

export interface DueGroupInput {
  jid: string;
  settings: GroupSettings;
}

/** The time key an action reads, and the flag that arms it. */
const WIRING = {
  close: { flag: "auto_close", time: "auto_close_time" },
  open: { flag: "auto_open", time: "auto_open_time" },
} as const;

/**
 * Groups whose schedule should run in the window `(since, now]` — `since` was
 * already handled by the previous tick.
 *
 * A time that already passed without being run is skipped rather than replayed:
 * after a restart, closing a group at noon because it was off at 23:00 would be
 * worse than missing a night. `since > now` means the window crossed midnight.
 */
export function dueGroups(
  groups: DueGroupInput[],
  action: OpenStateAction,
  since: number,
  now: number,
): string[] {
  const { flag, time } = WIRING[action];
  const inWindow = (at: number): boolean =>
    since <= now ? at > since && at <= now : at > since || at <= now;

  return groups
    .filter(({ settings }) => {
      if (!settings[flag]) return false;
      const [hour = 0, minute = 0] = settings[time].split(":").map(Number);
      return inWindow(hour * 60 + minute);
    })
    .map(({ jid }) => jid);
}

export function listScheduledGroups(db: Database): string[] {
  return db
    .query<{ jid: string }, []>("SELECT jid FROM scheduled_groups")
    .all()
    .map((row) => row.jid);
}

/** Turns the schedule on for a group — the first time fires on the next window. */
export function enableSchedule(db: Database, jid: string): void {
  db.query("INSERT OR IGNORE INTO scheduled_groups (jid) VALUES (?)").run(jid);
}

export function disableSchedule(db: Database, jid: string): void {
  db.query("DELETE FROM scheduled_groups WHERE jid = ?").run(jid);
}
