import { beforeEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import {
  USERS_TABLE_SQL,
  createUserStore,
  isPremium,
  type UserStore,
} from "@/lib/users";

const PN = "628111@s.whatsapp.net";
const LID = "111222@lid";

let db: Database;
let users: UserStore;

beforeEach(() => {
  db = new Database(":memory:");
  db.exec(USERS_TABLE_SQL);
  users = createUserStore(db);
});

describe("touch", () => {
  test("inserts a free row with both counters and one first_seen_at", () => {
    users.touch({ jid: PN, name: "Budi" }, false);

    const user = users.get(PN)!;
    expect(user.role).toBe("free");
    expect(user.messageCount).toBe(1);
    expect(user.commandCount).toBe(0);
    expect(user.name).toBe("Budi");
    expect(user.firstSeenAt).toBe(user.lastSeenAt);
  });

  test("a second touch increments without moving first_seen_at", async () => {
    users.touch({ jid: PN }, false);
    const first = users.get(PN)!.firstSeenAt;
    await Bun.sleep(2);
    users.touch({ jid: PN }, false);

    const user = users.get(PN)!;
    expect(user.messageCount).toBe(2);
    expect(user.firstSeenAt).toBe(first);
    expect(user.lastSeenAt).toBeGreaterThanOrEqual(first);
  });

  test("counts group and DM traffic in the same total", () => {
    users.touch({ jid: PN }, false);
    users.touch({ jid: PN }, false);

    expect(users.get(PN)!.messageCount).toBe(2);
  });

  test("recordUpscale increments the free-tier allowance usage", () => {
    users.touch({ jid: PN }, false);
    users.recordUpscale(PN);
    users.recordUpscale(PN);

    expect(users.get(PN)!.upscale2Count).toBe(2);
  });

  test("isCommand increments command_count as well", () => {
    users.touch({ jid: PN }, true);

    const user = users.get(PN)!;
    expect(user.messageCount).toBe(1);
    expect(user.commandCount).toBe(1);
  });

  test("a LID-first row adopts the phone number and keeps its counters", () => {
    users.touch({ jid: LID }, true);
    users.touch({ jid: PN, lid: LID }, false);

    const user = users.get(PN)!;
    expect(user.jid).toBe(PN);
    expect(user.lid).toBe(LID);
    expect(user.messageCount).toBe(2);
    expect(users.get(LID)).toBeNull();
    expect(db.query("SELECT COUNT(*) AS n FROM users").get()).toEqual({ n: 1 });
  });
});

describe("isPremium", () => {
  test("a temporary grant ends at its timestamp", () => {
    const until = Date.now() + 60_000;
    users.grantPremium(PN, until, "owner@s.whatsapp.net");

    const user = users.get(PN)!;
    expect(isPremium(user)).toBe(true);
    expect(isPremium(user, until + 1)).toBe(false);
  });

  test("a null expiry is permanent", () => {
    users.grantPremium(PN, null, "owner@s.whatsapp.net");

    expect(isPremium(users.get(PN)!, Date.now() + 1e12)).toBe(true);
  });

  test("granting an unknown jid creates a zero-count row", () => {
    const user = users.grantPremium(PN, null, "owner@s.whatsapp.net");

    expect(user.messageCount).toBe(0);
    expect(user.premiumGrantedBy).toBe("owner@s.whatsapp.net");
  });

  test("revokePremium returns the user to free", () => {
    users.grantPremium(PN, null, "owner@s.whatsapp.net");

    const user = users.revokePremium(PN)!;
    expect(user.role).toBe("free");
    expect(user.premiumUntil).toBeNull();
    expect(isPremium(user)).toBe(false);
  });

  test("a missing row is not premium", () => {
    expect(users.get(PN)).toBeNull();
  });
});

describe("get", () => {
  test("demotes an expired row lazily", () => {
    users.grantPremium(PN, Date.now() - 1, "owner@s.whatsapp.net");

    const user = users.get(PN)!;
    expect(user.role).toBe("free");
    expect(user.premiumUntil).toBeNull();
  });

  test("startup sweep demotes only expired temporary grants", () => {
    users.grantPremium(PN, Date.now() - 1, "owner@s.whatsapp.net");
    users.grantPremium("628222@s.whatsapp.net", null, "owner@s.whatsapp.net");
    users.grantPremium(
      "628333@s.whatsapp.net",
      Date.now() + 60_000,
      "owner@s.whatsapp.net",
    );

    expect(users.demoteExpired()).toBe(1);
    expect(users.get(PN)!.role).toBe("free");
    expect(users.get("628222@s.whatsapp.net")!.role).toBe("premium");
    expect(users.get("628333@s.whatsapp.net")!.role).toBe("premium");
  });
});
