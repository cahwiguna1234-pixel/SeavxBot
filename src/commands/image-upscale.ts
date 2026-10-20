import { downloadMediaMessage, type WAMessage } from "@whiskeysockets/baileys";
import type { Command } from "@/lib/types";
import { extractFirstUrl } from "@/lib/extractUrl";
import { unwrapMessageContent } from "@/lib/messageContent";
import { upscale } from "@/scrapers/upscale";

/** WhatsApp media lives behind an encrypted URL, so hand the upscaler the bytes. */
async function toDataUrl(
  message: WAMessage,
  mimetype?: string | null,
): Promise<string> {
  const bytes = await downloadMediaMessage(message, "buffer", {});
  return `data:${mimetype ?? "image/jpeg"};base64,${bytes.toString("base64")}`;
}

export const upscaleCommand: Command = {
  name: "upscale",
  description: "Upscale an image 2x (reply to it, caption it, or send a URL)",
  aliases: ["hd", "remini"],
  run: async ({ msg, reply, react }) => {
    const fail = async (text: string) => {
      await react("❌");
      await reply(text);
    };

    const own = unwrapMessageContent(msg.raw.message)?.imageMessage;
    const quoted = msg.quoted?.content?.imageMessage;
    const image = own ?? quoted;
    const download =
      own || !msg.quoted
        ? msg.raw
        : ({
            key: msg.quoted.key,
            message: msg.quoted.content,
          } as WAMessage);
    const url = image ? "" : (extractFirstUrl(msg.text) ?? "");

    if (!image && !url) return fail("🚩 Reply to an image or send its URL.");

    await react("⏳");
    try {
      const source = image ? await toDataUrl(download, image.mimetype) : url;

      const result = await upscale(source);
      if (!result) return fail("🚩 Upscale failed, try again.");

      await reply({
        image: Buffer.from(await result.arrayBuffer()),
        mimetype: result.type,
      });
      await react("✅");
    } catch {
      await fail("🚩 Could not read the image.");
    }
  },
};

export default upscaleCommand;
