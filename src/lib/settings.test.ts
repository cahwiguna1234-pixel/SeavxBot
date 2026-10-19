import { afterEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { SETTINGS_TABLE_SQL, createSettingsStore } from "@/lib/settings";

const DEFAULTS = {
  welcome_text: "Welcome {mention} to {group}!",
  goodbye_text: "Bye {name}.",
};

const GROUP = "120363@g.us";
const OTHER = "999999@g.us";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true });
});

/** A fresh store on a throwaway file; the schema comes from the module under test. */
function open() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "seavxbot-settings-"));
  tempDirs.push(dir);

  const file = path.join(dir, "test.db");
  const db = new Database(file);
  db.exec(SETTINGS_TABLE_SQL);

  return { db, file, store: createSettingsStore(db, DEFAULTS) };
}

/** Writes a row the store would never produce, bypassing its guards. */
function writeRaw(db: Database, jid: string, key: string, value: string): void {
  db.query("INSERT INTO group_settings (jid, key, value) VALUES (?, ?, ?)").run(
    jid,
    key,
    value,
  );
}

describe("createSettingsStore", () => {
  test("returns the documented defaults for a group with no rows", () => {
    const { store } = open();

    expect(store.get(GROUP)).toEqual({
      welcome: false,
      welcome_text: DEFAULTS.welcome_text,
      goodbye: false,
      goodbye_text: DEFAULTS.goodbye_text,
      antilink: "off",
    });
  });

  test("round-trips a boolean, a string, and the antilink enum", () => {
    const { store } = open();

    store.set(GROUP, "welcome", true);
    store.set(GROUP, "goodbye_text", "See you, {name}");
    store.set(GROUP, "antilink", "delete");

    const settings = store.get(GROUP);
    expect(settings.welcome).toBe(true);
    expect(settings.goodbye_text).toBe("See you, {name}");
    expect(settings.antilink).toBe("delete");
    expect(settings.goodbye).toBe(false); // untouched field keeps its default
  });

  test("keeps values across a close and reopen of the same file", () => {
    const { db, file, store } = open();
    store.set(GROUP, "welcome", true);
    store.set(GROUP, "welcome_text", "Hi {name}");
    db.close();

    const reopened = new Database(file);
    const store2 = createSettingsStore(reopened, DEFAULTS);

    expect(store2.get(GROUP).welcome).toBe(true);
    expect(store2.get(GROUP).welcome_text).toBe("Hi {name}");
    reopened.close();
  });

  test("shows a write immediately, even for a key never read before", () => {
    const { store } = open();

    store.get(GROUP);
    store.set(GROUP, "antilink", "warn");
    expect(store.get(GROUP).antilink).toBe("warn");

    // A key nobody read yet must not be lost to the cache either.
    store.set(GROUP, "goodbye", true);
    expect(store.get(GROUP).goodbye).toBe(true);
  });

  test("a write on one key preserves the rows already stored", () => {
    const { db, store } = open();
    store.set(GROUP, "antilink", "warn");
    db.close();

    const reopened = new Database(db.filename);
    const store2 = createSettingsStore(reopened, DEFAULTS);
    store2.set(GROUP, "welcome", true);

    expect(store2.get(GROUP).antilink).toBe("warn");
    expect(store2.get(GROUP).welcome).toBe(true);
    reopened.close();
  });

  test("falls back to the default for malformed and wrong-typed rows", () => {
    const { db, store } = open();
    writeRaw(db, GROUP, "welcome", "{not json");
    writeRaw(db, GROUP, "welcome_text", "42");
    writeRaw(db, GROUP, "antilink", '"ban"');
    writeRaw(db, GROUP, "goodbye", '"yes"');

    expect(store.get(GROUP)).toEqual({
      welcome: false,
      welcome_text: DEFAULTS.welcome_text,
      goodbye: false,
      goodbye_text: DEFAULTS.goodbye_text,
      antilink: "off",
    });
  });

  test("ignores a key this version does not know", () => {
    const { db, store } = open();
    writeRaw(db, GROUP, "antispam", "true");

    expect(store.get(GROUP)).not.toHaveProperty("antispam");
    expect(store.get(GROUP).welcome).toBe(false);
  });

  test("keeps groups apart", () => {
    const { store } = open();
    store.set(GROUP, "welcome", true);
    store.set(OTHER, "antilink", "delete");

    expect(store.get(GROUP).welcome).toBe(true);
    expect(store.get(GROUP).antilink).toBe("off");
    expect(store.get(OTHER).antilink).toBe("delete");
    expect(store.get(OTHER).welcome).toBe(false);
  });

  test("a returned object is a copy, not the cached entry", () => {
    const { store } = open();
    store.set(GROUP, "welcome", true);

    const first = store.get(GROUP);
    first.welcome = false;

    expect(store.get(GROUP).welcome).toBe(true);
  });
});
