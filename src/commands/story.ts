import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Command, CommandContext } from "@/lib/types";
import { downloadSource, downloadHint, findMedia } from "@/lib/replyMedia";
import {
  StoryError,
  hasFfmpeg,
  publishStatus,
  transcodeForStory,
  transcodeImageForStory,
} from "@/lib/story";

const VIDEO_TYPES = new Set(["videoMessage"]);
const MEDIA_TYPES = new Set(["videoMessage", "imageMessage"]);

const findStoryMedia = (ctx: CommandContext) => findMedia(ctx, MEDIA_TYPES);

export const storyCommand: Command = {
  name: "story",
  description: "Post a replied video or photo to your WhatsApp status in HD",
  aliases: ["sw", "status"],
  ownerOnly: true,
  run: async (ctx) => {
    const { reply, sock } = ctx;

    if (!hasFfmpeg()) {
      await reply(
        "🚩 ffmpeg is not available, so media cannot be prepared for a status.",
      );
      return;
    }

    const source = findStoryMedia(ctx);
    if (!source) {
      await reply(
        "🚩 Reply to a video or photo with this command to post it as a status.",
      );
      return;
    }

    await reply("⏳ Preparing your status…");

    // Declared without an initializer so the catch below cannot read a stale
    // value from an earlier iteration; both are assigned before first use.
    let transcode: { path: string; cleanup: () => void } | undefined;
    let workDir: string | undefined;

    try {
      const buffer = await downloadSource(source);

      workDir = fs.mkdtempSync(path.join(os.tmpdir(), "seavxbot-status-"));
      const isVideo = VIDEO_TYPES.has(source.type);
      const input = path.join(workDir, `input.${isVideo ? "mp4" : "jpg"}`);
      fs.writeFileSync(input, buffer);

      transcode = isVideo
        ? await transcodeForStory(input, { workDir })
        : await transcodeImageForStory(input, { workDir });
    } catch (err) {
      const message =
        err instanceof StoryError ? err.message : downloadHint(err);

      await reply(`🚩 ${message}`);
      return;
    } finally {
      // Runs after the try above either succeeded or failed, so the scratch
      // directory never survives a failed download.
      if (!transcode && workDir) {
        fs.rmSync(workDir, { recursive: true, force: true });
      }
    }

    try {
      const media = fs.readFileSync(transcode.path);
      const reached = await publishStatus(
        sock,
        VIDEO_TYPES.has(source.type) ? { video: media } : { image: media },
      );

      if (reached === 0) {
        await reply(
          "⚠️ Status posted, but no recipients were found — the bot shares no groups, so nobody can see it yet.",
        );
        return;
      }

      await reply(`✅ Posted to your status (${reached} recipient device(s)).`);
    } catch (err) {
      await reply(
        `🚩 Posting the status failed: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    } finally {
      transcode.cleanup();
      if (workDir) fs.rmSync(workDir, { recursive: true, force: true });
    }
  },
};

export default storyCommand;
