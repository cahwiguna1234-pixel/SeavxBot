import { describe, expect, test } from "bun:test";
import {
  FREE_UPSCALE_EXHAUSTED,
  UPSCALE_4X_PREMIUM_ONLY,
  parseScale,
  upscaleDenial,
} from "@/lib/upscaleQuota";
import type { User } from "@/lib/users";

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
    expect(upscaleDenial(user(), 4, false)).toBe(UPSCALE_4X_PREMIUM_ONLY);
  });

  test("premium users may run 4x", () => {
    expect(upscaleDenial(user({ role: "premium" }), 4, true)).toBeUndefined();
  });

  test("free users get five 2x upscales", () => {
    expect(upscaleDenial(user({ upscale2Count: 4 }), 2, false)).toBeUndefined();
    expect(upscaleDenial(user({ upscale2Count: 5 }), 2, false)).toBe(
      FREE_UPSCALE_EXHAUSTED,
    );
  });

  test("a user with no row still gets the free allowance", () => {
    expect(upscaleDenial(null, 2, false)).toBeUndefined();
  });

  test("premium is unlimited", () => {
    expect(
      upscaleDenial(user({ upscale2Count: 999 }), 2, true),
    ).toBeUndefined();
  });
});
