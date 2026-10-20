import fs from "node:fs";
import path from "node:path";
import { botConfig } from "@/lib/config";
import { MAX_MEDIA_BYTES } from "@/lib/media";

export class FfmpegError extends Error {}

/** ffmpeg path from config, or a bare name for PATH lookup. */
export function ffmpegPath(): string {
  return botConfig.download?.ffmpeg_path || "ffmpeg";
}

export function hasFfmpeg(): boolean {
  return Bun.which(ffmpegPath()) !== null;
}

export interface FfmpegResult {
  path: string;
  cleanup: () => void;
}

/**
 * Runs ffmpeg on one scratch file and reports a user-facing failure. The scratch
 * directory is `path.dirname(output)`, and it is removed whenever the run fails.
 */
export async function runFfmpeg(
  args: string[],
  output: string,
  timeoutMs: number,
): Promise<FfmpegResult> {
  const dir = path.dirname(output);

  const proc = Bun.spawn([ffmpegPath(), ...args], {
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });

  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    proc.kill();
  }, timeoutMs);

  let stderr = "";
  try {
    [, stderr] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
  } finally {
    clearTimeout(timer);
  }

  if (timedOut) {
    fs.rmSync(dir, { recursive: true, force: true });
    throw new FfmpegError("Preparing the media took too long and was stopped.");
  }

  if (!fs.existsSync(output)) {
    fs.rmSync(dir, { recursive: true, force: true });
    const reason = stderr
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .pop();
    throw new FfmpegError(
      reason ? `Could not prepare the media: ${reason}` : "Could not prepare the media.",
    );
  }

  const size = fs.statSync(output).size;
  if (size > MAX_MEDIA_BYTES) {
    fs.rmSync(dir, { recursive: true, force: true });
    throw new FfmpegError(
      "The prepared media is larger than WhatsApp allows (64 MB).",
    );
  }

  return {
    path: output,
    cleanup: () => fs.rmSync(dir, { recursive: true, force: true }),
  };
}
