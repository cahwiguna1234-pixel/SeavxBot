import { describe, expect, test } from "bun:test";
import { normalizeSiteUrl } from "@/lib/screenshot";

describe("normalizeSiteUrl", () => {
  test("adds a scheme to a bare domain", () => {
    expect(normalizeSiteUrl("example.com")).toBe("https://example.com/");
  });

  test("keeps an explicit scheme and its path", () => {
    expect(normalizeSiteUrl("https://example.com/a?b=1")).toBe(
      "https://example.com/a?b=1",
    );
  });

  test("trims surrounding whitespace", () => {
    expect(normalizeSiteUrl("  example.com  ")).toBe("https://example.com/");
  });

  test("rejects a word that is not a domain", () => {
    expect(normalizeSiteUrl("hello")).toBeNull();
  });

  test("rejects an empty string", () => {
    expect(normalizeSiteUrl("   ")).toBeNull();
  });

  test("rejects a non-HTTP scheme", () => {
    expect(normalizeSiteUrl("ftp://example.com/file")).toBeNull();
  });
});
