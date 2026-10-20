import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { botConfig } from "@/lib/config";
import { FfmpegError, hasFfmpeg, runFfmpeg } from "@/lib/ffmpeg";

/** WhatsApp rejects a sticker whose canvas is not exactly 512x512. */
export const STICKER_SIZE = 512;
/** Keeps text off the rounded corners WhatsApp draws over a sticker. */
const PADDING = 28;
const MAX_LINES = 6;
const MIN_FONT_SIZE = 24;
/**
 * Arial Narrow averages ~0.6em per glyph. Left deliberately generous: the wide
 * face is what would overflow, so the estimate stays on the safe side.
 */
const GLYPH_RATIO = 0.6;
/**
 * Blur spread relative to the text size. Measured on a 51px render: ~0.12
 * (sigma 6) left 0.09% of pixels dark, i.e. the text all but vanished; ~0.06
 * (sigma 3) keeps the strokes solid while visibly softening them.
 */
const BLUR_RATIO = 0.06;
const MAX_BLUR = 8;

const FONT_CANDIDATES = [
  "C:/Windows/Fonts/ARIALN.TTF",
  "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
  "/usr/share/fonts/TTF/DejaVuSans.ttf",
  "/System/Library/Fonts/Supplemental/Arial Narrow.ttf",
];

/** Arial Narrow for the sticker text: config first, then the usual system paths. */
export function stickerFontPath(): string | undefined {
  const configured = botConfig.download?.sticker_font;
  if (configured) return configured;

  return FONT_CANDIDATES.find((font) => fs.existsSync(font));
}

export const hasStickerFont = (): boolean => Boolean(stickerFontPath());

/**
 * A path used as an ffmpeg filter option. Backslashes and the drive colon both
 * end the option early otherwise, so the value is quoted with the colon escaped.
 */
const asFilterPath = (value: string): string =>
  `'${value.replace(/\\/g, "/").replace(/:/g, "\\:")}'`;

/**
 * Greedy word wrap. A word longer than the column budget is split rather than
 * allowed to run past the canvas, and the result is capped so the text stays
 * legible instead of shrinking to nothing.
 */
export function wrapText(text: string, columns: number): string[] {
  const lines: string[] = [];
  let line = "";

  const push = (): void => {
    if (line) lines.push(line);
    line = "";
  };

  for (const word of text.split(/\s+/).filter(Boolean)) {
    let rest = word;

    while (rest.length > columns) {
      push();
      lines.push(rest.slice(0, columns));
      rest = rest.slice(columns);
    }

    if (!line) line = rest;
    else if (line.length + 1 + rest.length <= columns) line += ` ${rest}`;
    else {
      push();
      line = rest;
    }
  }

  push();
  return lines.slice(0, MAX_LINES);
}

/** Largest size that keeps every line inside the canvas. */
export function fontSizeFor(lines: string[]): number {
  const usable = STICKER_SIZE - PADDING * 2;
  const longest = Math.max(...lines.map((line) => line.length), 1);
  const byWidth = usable / (longest * GLYPH_RATIO);
  const byHeight = usable / (lines.length * 1.05);

  return Math.max(MIN_FONT_SIZE, Math.round(Math.min(byWidth, byHeight)));
}

/** The brat cover look: blurred black lowercase text on a white square. */
export function bratArgsFor(
  font: string,
  textFile: string,
  fontSize: number,
  output: string,
): string[] {
  const drawtext = [
    `drawtext=fontfile=${asFilterPath(font)}`,
    `textfile=${asFilterPath(textFile)}`,
    "fontcolor=black",
    `fontsize=${fontSize}`,
    "x=(w-text_w)/2",
    "y=(h-text_h)/2",
  ].join(":");

  // Blurring the whole frame costs nothing extra here: the background is a flat
  // white, so only the glyph edges soften. A layer split would only add work.
  const sigma = Math.min(MAX_BLUR, fontSize * BLUR_RATIO).toFixed(1);
  const filter = `${drawtext},gblur=sigma=${sigma}`;

  return [
    "-hide_banner",
    "-loglevel",
    "error",
    "-y",
    "-f",
    "lavfi",
    "-i",
    `color=c=white:s=${STICKER_SIZE}x${STICKER_SIZE}`,
    "-vf",
    filter,
    "-frames:v",
    "1",
    "-c:v",
    "libwebp",
    "-q:v",
    "80",
    "-preset",
    "picture",
    output,
  ];
}

/**
 * Crops to the square canvas instead of letterboxing: a sticker keeps its whole
 * frame, and padding a portrait photo would just bury it in white bars.
 */
export function photoArgsFor(input: string, output: string): string[] {
  const filter = [
    `scale=${STICKER_SIZE}:${STICKER_SIZE}:force_original_aspect_ratio=increase`,
    `crop=${STICKER_SIZE}:${STICKER_SIZE}`,
    "setsar=1",
  ].join(",");

  return [
    "-hide_banner",
    "-loglevel",
    "error",
    "-y",
    "-i",
    input,
    "-vf",
    filter,
    "-frames:v",
    "1",
    "-c:v",
    "libwebp",
    "-q:v",
    "80",
    "-preset",
    "picture",
    output,
  ];
}

function scratchDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

export interface StickerResult {
  buffer: Buffer;
  cleanup: () => void;
}

/** Renders `text` as a brat sticker and hands back the finished webp. */
export async function bratSticker(text: string): Promise<StickerResult> {
  if (!hasFfmpeg()) {
    throw new FfmpegError("ffmpeg is not available, so stickers cannot be made.");
  }

  const font = stickerFontPath();
  if (!font) {
    throw new FfmpegError(
      "No font was found for the sticker text. Set download.sticker_font to a .ttf path.",
    );
  }

  const lines = wrapText(text.toLowerCase(), 16);
  const dir = scratchDir("seavxbot-brat-");
  const textFile = path.join(dir, "text.txt");
  const output = path.join(dir, "sticker.webp");
  fs.writeFileSync(textFile, lines.join("\n"));

  const result = await runFfmpeg(
    bratArgsFor(font, textFile, fontSizeFor(lines), output),
    output,
    60_000,
  );

  return { buffer: fs.readFileSync(result.path), cleanup: result.cleanup };
}

/** Crops an image file to a square sticker. */
export async function photoSticker(
  input: string,
  timeoutMs = 60_000,
): Promise<StickerResult> {
  if (!hasFfmpeg()) {
    throw new FfmpegError("ffmpeg is not available, so stickers cannot be made.");
  }

  const dir = scratchDir("seavxbot-sticker-");
  const output = path.join(dir, "sticker.webp");

  const result = await runFfmpeg(
    photoArgsFor(input, output),
    output,
    timeoutMs,
  );

  return { buffer: fs.readFileSync(result.path), cleanup: result.cleanup };
}
