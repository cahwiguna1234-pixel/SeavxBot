import type { Command } from "@/lib/types";
import {
  downloadTikTokMedia,
  extractTikTokUrl,
  resolveTikTok,
} from "@/lib/tiktok";

/** Slideshows can run to a dozen photos; cap the burst so the chat stays usable. */
const MAX_IMAGES = 10;

export const tiktokCommand: Command = {
  name: "tiktok",
  description: "Download a TikTok video or photo slideshow (no watermark)",
  aliases: ["tt", "ttdl"],
  run: async ({ msg, reply }) => {
    // A bare link is the common case: the URL arrives as the whole message or
    // as a reply to the post, so both are checked before giving up.
    const url =
      extractTikTokUrl(msg.body) ??
      extractTikTokUrl(msg.text) ??
      (msg.quoted ? extractTikTokUrl(msg.quoted.body) : null);

    if (!url) {
      await reply(
        "🚩 Send a TikTok link with the command, or reply to a message containing one.",
      );
      return;
    }

    await reply("⏳ Fetching TikTok media…");

    try {
      const media = await resolveTikTok(url);
      const author = media.author.username ? `@${media.author.username}` : "";
      const caption = [media.title, author].filter(Boolean).join("\n");

      if (media.video) {
        const buffer = await downloadTikTokMedia(media.video);
        await reply({ video: buffer, caption });
        return;
      }

      const images = media.images.slice(0, MAX_IMAGES);
      for (const [index, image] of images.entries()) {
        const buffer = await downloadTikTokMedia(image);
        // The caption belongs to the first photo only; repeating it on every
        // image would spam the chat with the same text.
        await reply(index === 0 ? { image: buffer, caption } : { image: buffer });
      }

      if (media.images.length > images.length) {
        await reply(
          `ℹ️ Showing ${images.length} of ${media.images.length} photos.`,
        );
      }
    } catch (err) {
      await reply(`🚩 ${err instanceof Error ? err.message : String(err)}`);
    }
  },
};

export default tiktokCommand;
