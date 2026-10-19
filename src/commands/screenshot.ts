import type { Command } from "@/lib/types";
import { extractFirstUrl } from "@/lib/extractUrl";
import { captureScreenshot, normalizeSiteUrl } from "@/lib/screenshot";

export const screenshotCommand: Command = {
  name: "ss",
  description: "Screenshot a website",
  aliases: ["screenshot", "ssweb"],
  run: async ({ msg, reply }) => {
    // Users paste prose around links, and typing `example.com` without a
    // scheme is common, so accept either shape.
    const site = normalizeSiteUrl(extractFirstUrl(msg.text) ?? msg.text);

    if (!site) {
      await reply(`🚩 Usage: ${msg.prefix}ss <url>`);
      return;
    }

    const shot = await captureScreenshot(site);

    if (!shot) {
      await reply(
        "🚩 Could not screenshot that page. Check the URL and retry.",
      );
      return;
    }

    // Baileys defaults every image to image/jpeg, so pass the real type.
    await reply({
      image: shot.buffer,
      mimetype: shot.mimetype,
      caption: site,
    });
  },
};

export default screenshotCommand;
