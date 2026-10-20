import fs from "node:fs";
import type { Command, CommandContext } from "@/lib/types";
import { extractUrls } from "@/lib/extractUrl";
import {
  downloadWithYtDlp,
  isYtDlpAvailable,
  type DownloadResult,
} from "@/lib/ytdlp";

export interface DownloaderSpec {
  name: string;
  description: string;
  aliases?: string[];
  /** Used in prompts and refusals, e.g. "YouTube". */
  label: string;
  isSupported: (url: string) => boolean;
  /** Extract audio (mp3) instead of video. */
  audio?: boolean;
}

/** Seam for tests: the real binary and the network are both side effects. */
export interface DownloaderDeps {
  isAvailable: () => boolean;
  download: (url: string, audio?: boolean) => Promise<DownloadResult>;
}

const DEFAULT_DEPS: DownloaderDeps = {
  isAvailable: isYtDlpAvailable,
  download: (url, audio) => downloadWithYtDlp(url, { audioOnly: audio }),
};

/** A command whose whole job is "find a link, hand it to yt-dlp, send files". */
export type DownloaderCommand = Omit<Command, "run"> & {
  run: (ctx: CommandContext) => Promise<void>;
};

const MISSING_BINARY =
  "🚩 yt-dlp is not installed on this server. Install it (and ffmpeg) to enable this downloader.";

/**
 * The link can arrive as the argument, inside the body, or in the message being
 * replied to — the reply case is what makes a bare link in chat work.
 */
function findLink(ctx: CommandContext, spec: DownloaderSpec): string | null {
  const sources = [ctx.msg.body, ctx.msg.text, ctx.msg.quoted?.body ?? ""];

  for (const source of sources) {
    const found = extractUrls(source).find(spec.isSupported);
    if (found) return found;
  }

  return null;
}

function toContent(
  file: DownloadResult["files"][number],
  caption: string | undefined,
): Parameters<CommandContext["reply"]>[0] {
  const buffer = fs.readFileSync(file.path);

  if (file.kind === "video") return { video: buffer, caption };
  if (file.kind === "image") return { image: buffer, caption };
  if (file.kind === "audio") {
    return { audio: buffer, mimetype: "audio/mpeg", fileName: file.name };
  }
  // Anything WhatsApp will not show inline still gets delivered as a document.
  return {
    document: buffer,
    fileName: file.name,
    mimetype: "application/octet-stream",
  };
}

export function createDownloaderCommand(
  spec: DownloaderSpec,
  deps: DownloaderDeps = DEFAULT_DEPS,
): DownloaderCommand {
  return {
    name: spec.name,
    description: spec.description,
    aliases: spec.aliases,
    run: async (ctx) => {
      const { reply } = ctx;

      if (!deps.isAvailable()) {
        await reply(MISSING_BINARY);
        return;
      }

      const url = findLink(ctx, spec);
      if (!url) {
        await reply(
          `🚩 Send a ${spec.label} link with the command, or reply to a message containing one.`,
        );
        return;
      }

      await reply(`⏳ Downloading from ${spec.label}…`);

      let result: DownloadResult;
      try {
        result = await deps.download(url, spec.audio);
      } catch (err) {
        await reply(`🚩 ${err instanceof Error ? err.message : String(err)}`);
        return;
      }

      try {
        const credit = [result.title, result.author].filter(Boolean).join("\n");

        for (const [index, file] of result.files.entries()) {
          // Only the first file carries the caption; a carousel would otherwise
          // repeat the same text on every slide.
          await reply(toContent(file, index === 0 ? credit : undefined));
          // An audio message has no caption field, so its credit rides along
          // as a plain text message instead.
          if (file.kind === "audio" && index === 0 && credit) {
            await reply(credit);
          }
        }
      } finally {
        result.cleanup();
      }
    },
  };
}
