import { downloadMediaMessage, type WAMessage } from "@whiskeysockets/baileys";
import type { CommandContext } from "@/lib/types";
import { MAX_MEDIA_BYTES } from "@/lib/media";

/** The media is either the message itself or the one it replies to. */
export interface MediaSource {
  message: WAMessage;
  type: string;
}

const IMAGE_TYPES = new Set(["imageMessage"]);

/**
 * A media message carries a download reference only while its content is
 * intact, so the quoted payload is rebuilt into the shape the downloader wants.
 */
export function findMedia(
  ctx: CommandContext,
  types: ReadonlySet<string>,
): MediaSource | null {
  const { msg } = ctx;
  if (types.has(msg.type)) return { message: msg.raw, type: msg.type };

  if (msg.quoted?.content && msg.quoted.key.id) {
    const quotedType = msg.quoted.type;
    if (!types.has(quotedType)) return null;

    return {
      message: {
        key: msg.quoted.key,
        message: msg.quoted.content,
      } as WAMessage,
      type: quotedType,
    };
  }

  return null;
}

export const findImage = (ctx: CommandContext): MediaSource | null =>
  findMedia(ctx, IMAGE_TYPES);

/**
 * Baileys signals a dead reference as "media is not a media message" or a
 * missing reupload hook; both deserve a message the user can act on.
 */
export function downloadHint(err: unknown): string {
  const text = err instanceof Error ? err.message : String(err);

  if (/not a media message|No message present/i.test(text)) {
    return "That media can no longer be downloaded. Re-send it and reply to it.";
  }
  if (/reupload/i.test(text)) {
    return "That media has expired on WhatsApp's servers. Re-send it and try again.";
  }

  return text;
}

export class MediaTooLargeError extends Error {}

/** Pulls the media bytes and refuses anything WhatsApp itself would reject. */
export async function downloadSource(source: MediaSource): Promise<Buffer> {
  const buffer = await downloadMediaMessage(source.message, "buffer", {});
  if (buffer.byteLength > MAX_MEDIA_BYTES) {
    throw new MediaTooLargeError("That file is larger than WhatsApp allows (64 MB).");
  }

  return buffer;
}
