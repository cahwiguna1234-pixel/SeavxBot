import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Command } from "@/lib/types";
import { FfmpegError } from "@/lib/ffmpeg";
import { downloadSource, downloadHint, findImage } from "@/lib/replyMedia";
import { photoSticker } from "@/lib/sticker";

export const stickerCommand: Command = {
  name: "sticker",
  description: "Turn a photo into a sticker",
  aliases: ["s", "stiker"],
  run: async (ctx) => {
    const { reply } = ctx;

    const source = findImage(ctx);
    if (!source) {
      await reply(
        "🚩 Send a photo with this command as its caption, or reply to a photo with it.",
      );
      return;
    }

    await reply("⏳ Making your sticker…");

    const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "seavxbot-photo-"));
    let sticker: { buffer: Buffer; cleanup: () => void } | undefined;

    try {
      const buffer = await downloadSource(source);
      const input = path.join(workDir, "input.jpg");
      fs.writeFileSync(input, buffer);

      sticker = await photoSticker(input);
    } catch (err) {
      await reply(`🚩 ${err instanceof FfmpegError ? err.message : downloadHint(err)}`);
      return;
    } finally {
      // The sticker lives in its own scratch directory; this one is only the
      // downloaded source and is never needed once ffmpeg has read it.
      fs.rmSync(workDir, { recursive: true, force: true });
    }

    try {
      await reply({ sticker: sticker.buffer });
    } finally {
      sticker.cleanup();
    }
  },
};

export default stickerCommand;
