import { afterEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  SCHEDULE_TABLE_SQL,
  dueGroups,
  disableSchedule,
  enableSchedule,
  listScheduledGroups,
} from "@/lib/schedule";
import { type GroupSettings } from "@/lib/settings";

const at = (hour: number, minute = 0): number => hour * 60 + minute;

const settings = (over: Partial<GroupSettings>): GroupSettings => ({
  welcome: false,
  welcome_text: "",
  goodbye: false,
  goodbye_text: "",
  antilink: "off",
  auto_close: false,
  auto_close_time: "23:00",
  auto_open: false,
  auto_open_time: "06:00",
  ...over,
});

const group = (jid: string, over: Partial<GroupSettings> = {}) => ({
  jid,
  settings: settings(over),
});

const tempDirs: string[] = [];

afterEach(() => {
  // Windows keeps a closed handle briefly; a leftover temp dir is not a test failure.
  for (const dir of tempDirs.splice(0)) {
    try {
      fs.rmSync(dir, { recursive: true });
    } catch {}
  }
});

function open() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "seavxbot-schedule-"));
  tempDirs.push(dir);

  const db = new Database(path.join(dir, "test.db"));
  db.exec(SCHEDULE_TABLE_SQL);
  return db;
}

describe("dueGroups", () => {
  test("fires only the armed group, in the window that covers its time", () => {
    const groups = [
      group("a@g.us", { auto_close: true }),
      group("b@g.us", { auto_close: false }),
    ];

    expect(dueGroups(groups, "close", at(22, 59), at(23, 0))).toEqual(["a@g.us"]);
  });

  test("leaves an unarmed action alone even when the flag on the other is set", () => {
    const groups = [group("a@g.us", { auto_close: true, auto_open: true })];

    expect(dueGroups(groups, "open", at(5, 59), at(6, 0))).toEqual(["a@g.us"]);
    expect(dueGroups(groups, "close", at(5, 59), at(6, 0))).toEqual([]);
  });

  test("a window is half-open: the start is excluded, the end is not", () => {
    const groups = [group("a@g.us", { auto_close: true })];
    expect(dueGroups(groups, "close", at(23, 0), at(23, 1))).toEqual([]);
    expect(dueGroups(groups, "close", at(22, 59), at(23, 0))).toEqual(["a@g.us"]);
  });

  test("a time missed while the process was stopped is skipped, not replayed", () => {
    const groups = [group("a@g.us", { auto_close: true })];
    // 22:00 → 22:05 would be the window; the clock is now well past 23:00.
    expect(dueGroups(groups, "close", at(12, 0), at(16, 0))).toEqual([]);
  });

  test("reads the time each action owns", () => {
    const groups = [
      group("a@g.us", { auto_close: true, auto_close_time: "23:30" }),
      group("b@g.us", { auto_close: true, auto_close_time: "22:30" }),
    ];

    expect(dueGroups(groups, "close", at(23, 29), at(23, 30))).toEqual([
      "a@g.us",
    ]);
  });

  test("a window that crosses midnight still fires", () => {
    const groups = [group("a@g.us", { auto_close: true, auto_close_time: "23:59" })];

    expect(dueGroups(groups, "close", at(23, 58), at(0))).toEqual(["a@g.us"]);
    // And a time on the far side of midnight, with the window wrapping.
    expect(dueGroups(groups, "close", at(22, 0), at(1))).toEqual(["a@g.us"]);
    expect(dueGroups(groups, "close", at(0), at(5))).toEqual([]);
  });
});

describe("the scheduled-group list", () => {
  test("enables idempotently and disables", () => {
    const db = open();

    enableSchedule(db, "a@g.us");
    enableSchedule(db, "a@g.us");
    enableSchedule(db, "b@g.us");
    expect(listScheduledGroups(db).sort()).toEqual(["a@g.us", "b@g.us"]);

    disableSchedule(db, "a@g.us");
    expect(listScheduledGroups(db)).toEqual(["b@g.us"]);
  });

  test("disabling a group that is not listed is a no-op", () => {
    const db = open();
    disableSchedule(db, "a@g.us");
    expect(listScheduledGroups(db)).toEqual([]);
  });
});
