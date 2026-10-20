import type { Command } from "@/lib/types";
import { FfmpegError } from "@/lib/ffmpeg";
import { bratSticker } from "@/lib/sticker";

export const bratCommand: Command = {
  name: "brat",
  description: "Make a brat-style sticker from text",
  aliases: ["bratsticker"],
  run: async ({ reply, msg }) => {
    const text = msg.text.trim();
    if (!text) {
      await reply("🚩 Send the text to put on the sticker: .brat <text>");
      return;
    }

    await reply("⏳ Making your sticker…");

    let sticker;
    try {
      sticker = await bratSticker(text);
    } catch (err) {
      await reply(`🚩 ${err instanceof FfmpegError ? err.message : String(err)}`);
      return;
    }

    try {
      await reply({ sticker: sticker.buffer });
    } finally {
      sticker.cleanup();
    }
  },
};

export default bratCommand;
