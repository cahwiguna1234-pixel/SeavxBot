import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { botConfig } from "@/lib/config";
import {
  MAX_MEDIA_BYTES,
  TOO_LARGE_MESSAGE,
  mediaKind,
  type MediaKind,
} from "@/lib/media";

/** yt-dlp gives up on its own; this is the outer guard for a wedged process. */
const PROBE_TIMEOUT_MS = 60_000;
const DEFAULT_DOWNLOAD_TIMEOUT_MS = 180_000;

/** From best to last resort. Every rung keeps the clip inside WhatsApp's cap. */
const QUALITY_LADDER = [720, 480, 360, 240];

export class DownloadError extends Error {}

export interface YtDlpResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export type YtDlpRunner = (
  args: string[],
  timeoutMs: number,
) => Promise<YtDlpResult>;

export interface DownloadedFile {
  path: string;
  kind: MediaKind;
  name: string;
}

export interface DownloadResult {
  title: string;
  author: string;
  files: DownloadedFile[];
  /** Removes the scratch directory; call once the media has been sent. */
  cleanup: () => void;
}

export interface DownloadOptions {
  runner?: YtDlpRunner;
  /** Injected by tests so nothing touches the real temp directory layout. */
  workDir?: string;
  maxBytes?: number;
  maxHeight?: number;
  timeoutMs?: number;
  /** Extract audio to mp3 instead of video. */
  audioOnly?: boolean;
}

const YOUTUBE_HOSTS = [
  "youtube.com",
  "youtu.be",
  "youtube-nocookie.com",
  "music.youtube.com",
];
const INSTAGRAM_HOSTS = ["instagram.com", "instagr.am"];

const hostMatches = (value: string, hosts: string[]): boolean => {
  try {
    const host = new URL(value).hostname.toLowerCase();
    return hosts.some((known) => host === known || host.endsWith(`.${known}`));
  } catch {
    return false;
  }
};

export const isYouTubeUrl = (value: string): boolean =>
  hostMatches(value, YOUTUBE_HOSTS);

export const isInstagramUrl = (value: string): boolean =>
  hostMatches(value, INSTAGRAM_HOSTS);

/**
 * How yt-dlp is invoked. Most installs are a single `yt-dlp` binary, but a
 * policy-blocked pip launcher still works as `python -m yt_dlp`, so the prefix
 * is a full argv rather than one path.
 */
export function ytDlpCommand(): string[] {
  const configured = botConfig.download?.ytdlp_command;
  if (Array.isArray(configured) && configured.length > 0) return configured;

  return [botConfig.download?.ytdlp_path || "yt-dlp"];
}

/** yt-dlp is an external process, so a missing install must read as such. */
export function createYtDlpRunner(command: string[] = ["yt-dlp"]): YtDlpRunner {
  const [program, ...prefix] = command;

  return async (args, timeoutMs) => {
    // A missing program throws synchronously; surface it as a failed run so
    // every caller has one shape to reason about.
    let proc: Bun.Subprocess<"ignore", "pipe", "pipe">;
    try {
      proc = Bun.spawn([program!, ...prefix, ...args], {
        stdin: "ignore",
        stdout: "pipe",
        stderr: "pipe",
      });
    } catch (err) {
      return {
        stdout: "",
        stderr: `could not run ${command.join(" ")}: ${
          err instanceof Error ? err.message : String(err)
        }`,
        exitCode: 127,
      };
    }

    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      proc.kill();
    }, timeoutMs);

    try {
      const [stdout, stderr, exitCode] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
        proc.exited,
      ]);

      return {
        stdout,
        stderr: timedOut ? `${stderr}\nTimed out after ${timeoutMs}ms` : stderr,
        exitCode: timedOut ? 124 : exitCode,
      };
    } finally {
      clearTimeout(timer);
    }
  };
}

/** Resolved lazily so a bot without yt-dlp still starts and serves other commands. */
export function ytDlpRunner(): YtDlpRunner {
  return createYtDlpRunner(ytDlpCommand());
}

export function isYtDlpAvailable(): boolean {
  const [program] = ytDlpCommand();
  // Bun.which understands both a bare name and an absolute path.
  return program ? Bun.which(program) !== null : false;
}

interface ProbeInfo {
  title: string;
  author: string;
  duration: number;
}

/** Reads the metadata yt-dlp prints for a single video without downloading it. */
export function parseProbe(stdout: string): ProbeInfo {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    throw new DownloadError("Could not read the video information.");
  }

  const info = parsed as {
    title?: unknown;
    uploader?: unknown;
    channel?: unknown;
    duration?: unknown;
    _type?: unknown;
  };

  if (info?._type === "playlist") {
    throw new DownloadError("Playlists are not supported — send one link.");
  }

  return {
    title: typeof info.title === "string" ? info.title : "",
    author:
      typeof info.uploader === "string"
        ? info.uploader
        : typeof info.channel === "string"
          ? info.channel
          : "",
    duration:
      typeof info.duration === "number" && Number.isFinite(info.duration)
        ? info.duration
        : 0,
  };
}

function formatSelector(height: number): string {
  return `bv*[height<=${height}]+ba/b[height<=${height}]/bv*+ba/b`;
}

/** Files yt-dlp may leave behind that are not finished media. */
const INCOMPLETE = /\.(part|ytdl|temp|tmp)$/i;

function collectFiles(dir: string, maxBytes: number): DownloadedFile[] {
  const files = fs
    .readdirSync(dir)
    .filter((name) => !INCOMPLETE.test(name))
    .map((name) => path.join(dir, name))
    .filter((file) => fs.statSync(file).isFile());

  const oversized = files.some((file) => fs.statSync(file).size > maxBytes);
  if (oversized) throw new DownloadError(TOO_LARGE_MESSAGE);

  return files.map((file) => ({
    path: file,
    kind: mediaKind(file),
    name: path.basename(file),
  }));
}

/** Last non-empty stderr line is yt-dlp's actual reason, not its banner. */
function lastError(stderr: string): string {
  const line = stderr
    .split("\n")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .pop();
  return line ?? "";
}

function friendlyFailure(stderr: string): DownloadError {
  const reason = lastError(stderr);

  if (/max-filesize|larger than/i.test(stderr)) {
    return new DownloadError(TOO_LARGE_MESSAGE);
  }
  if (/private|login|cookies|rate-limit|confirm your age/i.test(stderr)) {
    return new DownloadError(
      "That post is private, age-restricted, or requires login.",
    );
  }
  if (/timed out/i.test(stderr)) {
    return new DownloadError("The download took too long and was stopped.");
  }

  return new DownloadError(
    reason ? `Download failed: ${reason}` : "Download failed.",
  );
}

/**
 * Downloads the best rendition that fits under WhatsApp's cap, walking down the
 * quality ladder when a rung is too large. Returns every file yt-dlp produced,
 * which is more than one for an Instagram carousel.
 */
export async function downloadWithYtDlp(
  url: string,
  options: DownloadOptions = {},
): Promise<DownloadResult> {
  const runner = options.runner ?? ytDlpRunner();
  const maxBytes = options.maxBytes ?? MAX_MEDIA_BYTES;
  const maxHeight = options.maxHeight ?? botConfig.download?.max_height ?? 720;
  const timeoutMs =
    options.timeoutMs ??
    (botConfig.download?.timeout_seconds ?? 180) * 1000;
  const invokedAs = ytDlpCommand().join(" ");

  const common = ["--no-playlist", "--no-warnings", "--no-progress"];
  const ffmpeg = botConfig.download?.ffmpeg_path;
  if (ffmpeg) common.push("--ffmpeg-location", ffmpeg);

  const probe = await runner(["-J", ...common, url], PROBE_TIMEOUT_MS);
  if (probe.exitCode !== 0) throw friendlyFailure(probe.stderr);
  const info = parseProbe(probe.stdout);

  const dir = fs.mkdtempSync(path.join(options.workDir ?? os.tmpdir(), "seavxbot-"));
  const cleanup = (): void => {
    fs.rmSync(dir, { recursive: true, force: true });
  };

  const output = path.join(dir, "%(title).80s [%(id)s].%(ext)s");

  // Audio has no quality ladder: one ffmpeg conversion either fits or does not.
  const heights = [maxHeight, ...QUALITY_LADDER]
    .filter((height, index, all) => height <= maxHeight && all.indexOf(height) === index)
    .sort((a, b) => b - a);

  const attempts = options.audioOnly
    ? [
        [
          "-x",
          "--audio-format",
          "mp3",
          "--audio-quality",
          "0",
          "-o",
          output,
          ...common,
          url,
        ],
      ]
    : heights.map((height) => [
        "-f",
        formatSelector(height),
        "--max-filesize",
        String(maxBytes),
        "--merge-output-format",
        "mp4",
        "-o",
        output,
        ...common,
        url,
      ]);

  let lastFailure = "";
  for (const args of attempts) {
    // A previous rung may have left a partial file behind; start clean.
    for (const name of fs.readdirSync(dir)) {
      fs.rmSync(path.join(dir, name), { force: true, recursive: true });
    }

    const result = await runner(args, timeoutMs);

    if (result.exitCode === 0) {
      let files: DownloadedFile[];
      try {
        files = collectFiles(dir, maxBytes);
      } catch (err) {
        cleanup();
        throw err;
      }

      if (files.length > 0) {
        return { title: info.title, author: info.author, files, cleanup };
      }
      lastFailure = "no output files";
      continue;
    }

    lastFailure = result.stderr;
    // A rung that failed because the file is too large is worth retrying lower.
    // Anything else (private post, bad URL) will fail identically on every rung.
    if (!/max-filesize|larger than|requested format/i.test(result.stderr)) {
      cleanup();
      throw friendlyFailure(result.stderr);
    }
  }

  cleanup();
  throw friendlyFailure(lastFailure || `could not download with ${invokedAs}`);
}
