import { describe, expect, test } from "bun:test";
import { durationUntil, formatExpiry, splitDuration } from "@/lib/premium";

const DAY = 24 * 60 * 60 * 1000;
const NOW = 1_700_000_000_000;

describe("durationUntil", () => {
  test("7d and 30d are relative to now", () => {
    expect(durationUntil("7d", NOW)).toBe(NOW + 7 * DAY);
    expect(durationUntil("30D", NOW)).toBe(NOW + 30 * DAY);
  });

  test("permanent has no expiry", () => {
    expect(durationUntil("permanent", NOW)).toBeNull();
  });

  test("anything else is rejected", () => {
    expect(durationUntil("1y", NOW)).toBeUndefined();
    expect(durationUntil("", NOW)).toBeUndefined();
  });
});

describe("splitDuration", () => {
  test("removes the duration and keeps the targets", () => {
    expect(splitDuration(["628123", "7d"])).toEqual({
      until: expect.any(Number),
      rest: ["628123"],
    });
  });

  test("without a duration there is nothing to grant", () => {
    expect(splitDuration(["628123"])).toEqual({
      until: undefined,
      rest: ["628123"],
    });
  });
});

describe("formatExpiry", () => {
  test("names permanence instead of a date", () => {
    expect(formatExpiry(null)).toBe("permanent");
    expect(formatExpiry(NOW)).toBe("until 2023-11-14 22:13");
  });
});
