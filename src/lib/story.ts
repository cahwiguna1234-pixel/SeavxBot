import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { WASocket } from "@whiskeysockets/baileys";
import { FfmpegError, ffmpegPath, hasFfmpeg, runFfmpeg } from "@/lib/ffmpeg";

export { ffmpegPath, hasFfmpeg };
/** Kept as a local alias so this module's own throws and its callers agree. */
const StoryError = FfmpegError;
export { StoryError };

/**
 * Statuses are re-encoded harder than chat media, so a chat-sized upload looks
 * soft. Aiming at the 1080x1920 9:16 canvas with a generous bitrate leaves the
 * server enough quality to still land a sharp story after its own pass.
 */
export const STATUS_WIDTH = 1080;
export const STATUS_HEIGHT = 1920;

/** WhatsApp re-encodes anyway; below this the second pass is visible. */
const VIDEO_BITRATE = "6M";
const AUDIO_BITRATE = "128k";
const MAX_FPS = 30;

/**
 * Scales to the story canvas without distorting: the aspect ratio is preserved
 * and the remainder is padded, matching what WhatsApp itself does to a photo
 * that does not fill the frame. `setsar=1` is not optional — without it the pad
 * step leaves a non-square sample aspect ratio and the story comes out subtly
 * stretched.
 */
const SCALE_FILTER = [
  `scale=${STATUS_WIDTH}:${STATUS_HEIGHT}:force_original_aspect_ratio=decrease`,
  `pad=${STATUS_WIDTH}:${STATUS_HEIGHT}:(ow-iw)/2:(oh-ih)/2:color=black`,
  "setsar=1",
  `fps=${MAX_FPS}`,
  "format=yuv420p",
].join(",");

export const argsFor = (input: string, output: string): string[] => [
  "-hide_banner",
  "-loglevel",
  "error",
  "-y",
  "-i",
  input,
  "-vf",
  SCALE_FILTER,
  "-c:v",
  "libx264",
  "-profile:v",
  "high",
  "-preset",
  "medium",
  "-b:v",
  VIDEO_BITRATE,
  "-maxrate",
  VIDEO_BITRATE,
  "-bufsize",
  "12M",
  // Two-second keyframe interval keeps the story seekable after re-encode.
  "-g",
  String(MAX_FPS * 2),
  "-c:a",
  "aac",
  "-b:a",
  AUDIO_BITRATE,
  "-movflags",
  "+faststart",
  output,
];

export interface TranscodeResult {
  path: string;
  cleanup: () => void;
}

const IMAGE_FILTER = [
  `scale=${STATUS_WIDTH}:${STATUS_HEIGHT}:force_original_aspect_ratio=decrease`,
  `pad=${STATUS_WIDTH}:${STATUS_HEIGHT}:(ow-iw)/2:(oh-ih)/2:color=black`,
  "setsar=1",
].join(",");

export const imageArgsFor = (input: string, output: string): string[] => [
  "-hide_banner",
  "-loglevel",
  "error",
  "-y",
  "-i",
  input,
  "-vf",
  IMAGE_FILTER,
  "-frames:v",
  "1",
  // WhatsApp rejects 4:4:4 JPEGs; 4:2:0 is what a phone camera produces.
  "-pix_fmt",
  "yuvj420p",
  "-q:v",
  "2",
  output,
];

/**
 * Re-encodes `input` to the story canvas. The caller owns the scratch directory;
 * only the file this returns is this module's to clean up.
 */
export async function transcodeForStory(
  input: string,
  options: { workDir?: string; timeoutMs?: number } = {},
): Promise<TranscodeResult> {
  if (!hasFfmpeg()) {
    throw new StoryError(
      "ffmpeg is not available, so the video cannot be prepared for a story.",
    );
  }

  const dir = fs.mkdtempSync(
    path.join(options.workDir ?? os.tmpdir(), "seavxbot-story-"),
  );

  return runFfmpeg(
    argsFor(input, path.join(dir, "story.mp4")),
    path.join(dir, "story.mp4"),
    options.timeoutMs ?? 240_000,
  );
}

/** Fits a photo to the same canvas so it is not letterboxed by WhatsApp. */
export async function transcodeImageForStory(
  input: string,
  options: { workDir?: string; timeoutMs?: number } = {},
): Promise<TranscodeResult> {
  if (!hasFfmpeg()) {
    throw new StoryError(
      "ffmpeg is not available, so the photo cannot be prepared for a story.",
    );
  }

  const dir = fs.mkdtempSync(
    path.join(options.workDir ?? os.tmpdir(), "seavxbot-story-"),
  );

  return runFfmpeg(
    imageArgsFor(input, path.join(dir, "story.jpg")),
    path.join(dir, "story.jpg"),
    options.timeoutMs ?? 60_000,
  );
}

export const STATUS_JID = "status@broadcast";

/**
 * Everyone the status should reach. A status is fanned out to an explicit list
 * of devices rather than to all contacts, so the list has to be assembled by
 * hand: every participant of every group the bot is in. DMs to contacts that
 * share no group cannot be discovered through the socket.
 */
export function collectStatusRecipients(
  groups: Record<string, { participants: { id: string }[] }>,
): string[] {
  const seen = new Set<string>();

  for (const group of Object.values(groups)) {
    for (const participant of group.participants ?? []) {
      if (participant.id) seen.add(participant.id);
    }
  }

  return [...seen];
}

export async function publishStatus(
  sock: Pick<WASocket, "sendMessage" | "groupFetchAllParticipating">,
  content: Parameters<WASocket["sendMessage"]>[1],
): Promise<number> {
  let recipients: string[] = [];
  try {
    recipients = collectStatusRecipients(await sock.groupFetchAllParticipating());
  } catch (err) {
    // An empty list still posts the status; it just reaches nobody, which is
    // worth surfacing rather than failing outright.
    console.error("Could not list group participants for the status list:", err);
  }

  await sock.sendMessage(STATUS_JID, content, {
    statusJidList: recipients,
  });

  return recipients.length;
}
