import { describe, expect, test } from "bun:test";
import {
  FREE_UPSCALE_EXHAUSTED,
  UPSCALE_4X_PREMIUM_ONLY,
  parseScale,
  upscaleDenial,
} from "@/lib/upscaleQuota";
import { localDay, type User } from "@/lib/users";

const NOW = new Date(2026, 9, 20, 12).getTime();
const TODAY = localDay(NOW);
const YESTERDAY = localDay(NOW - 24 * 60 * 60 * 1000);

describe("localDay", () => {
  test("rolls over at midnight WIB, not at the server's midnight", () => {
    expect(localDay(Date.UTC(2026, 9, 19, 16, 59))).toBe("2026-10-19");
    expect(localDay(Date.UTC(2026, 9, 19, 17, 0))).toBe("2026-10-20");
  });
});

const user = (over: Partial<User> = {}): User => ({
  id: 1,
  jid: "6281@s.whatsapp.net",
  lid: null,
  name: null,
  role: "free",
  premiumUntil: null,
  premiumSince: null,
  premiumGrantedBy: null,
  messageCount: 0,
  commandCount: 0,
  upscale2Count: 0,
  upscale2Day: null,
  firstSeenAt: 0,
  lastSeenAt: 0,
  ...over,
});

describe("parseScale", () => {
  test("defaults to 2x", () => {
    expect(parseScale([])).toBe(2);
    expect(parseScale(["photo.png"])).toBe(2);
    expect(parseScale(["3"])).toBe(2);
  });

  test("accepts 4 and 4x", () => {
    expect(parseScale(["4"])).toBe(4);
    expect(parseScale(["4x"])).toBe(4);
  });
});

describe("upscaleDenial", () => {
  test("free users cannot run 4x", () => {
    expect(upscaleDenial(user(), 4, false, NOW)).toBe(UPSCALE_4X_PREMIUM_ONLY);
  });

  test("premium users may run 4x", () => {
    expect(
      upscaleDenial(user({ role: "premium" }), 4, true, NOW),
    ).toBeUndefined();
  });

  test("free users get five 2x upscales a day", () => {
    const at4 = user({ upscale2Day: TODAY, upscale2Count: 4 });
    const at5 = user({ upscale2Day: TODAY, upscale2Count: 5 });

    expect(upscaleDenial(at4, 2, false, NOW)).toBeUndefined();
    expect(upscaleDenial(at5, 2, false, NOW)).toBe(FREE_UPSCALE_EXHAUSTED);
  });

  test("yesterday's usage does not count against today", () => {
    const used5Yesterday = user({ upscale2Day: YESTERDAY, upscale2Count: 5 });

    expect(upscaleDenial(used5Yesterday, 2, false, NOW)).toBeUndefined();
  });

  test("a user with no row still gets the free allowance", () => {
    expect(upscaleDenial(null, 2, false, NOW)).toBeUndefined();
  });

  test("premium is unlimited", () => {
    expect(
      upscaleDenial(user({ upscale2Count: 999, upscale2Day: TODAY }), 2, true, NOW),
    ).toBeUndefined();
  });
});
