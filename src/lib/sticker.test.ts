import { describe, expect, test } from "bun:test";
import {
  STICKER_SIZE,
  bratArgsFor,
  fontSizeFor,
  photoArgsFor,
  wrapText,
} from "@/lib/sticker";

describe("wrapText", () => {
  test("keeps short text on one line", () => {
    expect(wrapText("aku ganteng", 16)).toEqual(["aku ganteng"]);
  });

  test("wraps at word boundaries", () => {
    expect(wrapText("aku ganteng sekali beneran deh", 12)).toEqual([
      "aku ganteng",
      "sekali",
      "beneran deh",
    ]);
  });

  test("splits a word longer than the line", () => {
    expect(wrapText("abcdefghij", 4)).toEqual(["abcd", "efgh", "ij"]);
  });

  test("caps the line count so the text stays legible", () => {
    expect(wrapText("satu dua tiga empat lima enam tujuh delapan", 5)).toHaveLength(6);
  });

  test("collapses whitespace", () => {
    expect(wrapText("  aku   ganteng  ", 16)).toEqual(["aku ganteng"]);
  });
});

describe("fontSizeFor", () => {
  test("shrinks as the text grows", () => {
    const short = fontSizeFor(["hai"]);
    const long = fontSizeFor(["hai", "hai", "hai", "hai", "hai"]);
    expect(short).toBeGreaterThan(long);
  });

  test("never drops below a readable size", () => {
    expect(fontSizeFor(["x".repeat(200)])).toBeGreaterThanOrEqual(24);
  });
});

describe("bratArgsFor", () => {
  const args = bratArgsFor(
    "C:/Windows/Fonts/ARIALN.TTF",
    "C:/tmp/text.txt",
    64,
    "out.webp",
  );
  const filter = args[args.indexOf("-vf") + 1]!;

  test("renders a white square canvas", () => {
    expect(args[args.indexOf("-i") + 1]).toBe(
      `color=c=white:s=${STICKER_SIZE}x${STICKER_SIZE}`,
    );
  });

  test("draws black centered text from the text file", () => {
    expect(filter).toContain("fontcolor=black");
    expect(filter).toContain("textfile='C\\:/tmp/text.txt'");
    expect(filter).toContain("x=(w-text_w)/2");
    expect(filter).toContain("y=(h-text_h)/2");
  });

  test("blurs the text after drawing it, without blurring the canvas away", () => {
    const [draw, blur] = filter.split(",");
    expect(draw).toStartWith("drawtext=");
    expect(blur).toBe("gblur=sigma=3.8"); // 64 * 0.06, rounded to one decimal
  });

  test("caps the blur on a huge font", () => {
    const big = bratArgsFor("f.ttf", "t.txt", 400, "out.webp");
    expect(big[big.indexOf("-vf") + 1]).toContain("gblur=sigma=8.0");
  });

  test("escapes the drive colon in the font path", () => {
    expect(filter).toContain("fontfile='C\\:/Windows/Fonts/ARIALN.TTF'");
  });

  test("encodes a still webp", () => {
    expect(args[args.indexOf("-c:v") + 1]).toBe("libwebp");
    expect(args[args.indexOf("-frames:v") + 1]).toBe("1");
  });
});

describe("photoArgsFor", () => {
  test("crops to a square instead of letterboxing", () => {
    const args = photoArgsFor("in.jpg", "out.webp");
    const filter = args[args.indexOf("-vf") + 1]!;
    expect(filter).toContain("force_original_aspect_ratio=increase");
    expect(filter).toContain(`crop=${STICKER_SIZE}:${STICKER_SIZE}`);
    expect(filter).not.toContain("pad=");
  });
});
