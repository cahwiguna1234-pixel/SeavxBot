import type { WASocket } from "@whiskeysockets/baileys";
import { getDb, getGroupSettings } from "@/lib/db";
import { applyGroupOpenState } from "@/lib/group";
import { dueGroups, listScheduledGroups, type OpenStateAction } from "@/lib/schedule";

const TICK_MS = 30_000;
/** A longer gap means the process was suspended; replaying it is not wanted. */
const MAX_LATE_MINUTES = 5;

const ACTIONS: readonly OpenStateAction[] = ["close", "open"];

/** Local minutes since midnight. */
const minutesOf = (date: Date): number =>
  date.getHours() * 60 + date.getMinutes();

let running = false;

/**
 * Runs the per-group close/open schedule off the socket's clock. Started once,
 * on the first successful connection: a reconnect must not stack a second timer.
 */
export function startGroupScheduler(sock: WASocket, intervalMs = TICK_MS): void {
  if (running) return;
  running = true;

  let last = minutesOf(new Date());

  setInterval(() => {
    const now = minutesOf(new Date());
    // Wraps at midnight; a larger jump means the timer was suspended.
    const elapsed = (now - last + 1440) % 1440;
    if (elapsed === 0 || elapsed > MAX_LATE_MINUTES) {
      last = now;
      return;
    }

    const store = getGroupSettings();
    const groups = listScheduledGroups(getDb()).map((jid) => ({
      jid,
      settings: store.get(jid),
    }));

    for (const action of ACTIONS) {
      for (const jid of dueGroups(groups, action, last, now)) {
        void applyGroupOpenState(sock, jid, action);
      }
    }

    last = now;
  }, intervalMs);
}
