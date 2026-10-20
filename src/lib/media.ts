/** WhatsApp's documented ceiling for a single media message. */
export const MAX_MEDIA_BYTES = 64 * 1024 * 1024;

/** CDNs in front of these platforms reject requests without a browser client. */
export const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

export const TOO_LARGE_MESSAGE =
  "That file is larger than WhatsApp allows (64 MB).";

/** A download failure whose text is meant for the user, not just the log. */
export class MediaError extends Error {}

export interface DownloadMediaOptions {
  fetcher?: typeof fetch;
  maxBytes?: number;
  /** Some CDNs gate media behind a same-site referer. */
  referer?: string;
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 60_000;

export async function downloadMedia(
  url: string,
  options: DownloadMediaOptions = {},
): Promise<Buffer> {
  const fetcher = options.fetcher ?? fetch;
  const maxBytes = options.maxBytes ?? MAX_MEDIA_BYTES;

  const res = await fetcher(url, {
    headers: {
      "User-Agent": BROWSER_UA,
      ...(options.referer ? { Referer: options.referer } : {}),
    },
    signal: AbortSignal.timeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS),
  });

  if (!res.ok) throw new MediaError(`Download failed with ${res.status}.`);

  // Refuse an oversized file before pulling it into memory when the CDN says
  // how big it is; the post-read check still covers chunked responses.
  if (Number(res.headers.get("content-length") ?? 0) > maxBytes) {
    throw new MediaError(TOO_LARGE_MESSAGE);
  }

  const buffer = Buffer.from(await res.arrayBuffer());
  if (buffer.byteLength > maxBytes) throw new MediaError(TOO_LARGE_MESSAGE);

  return buffer;
}

const VIDEO_EXTENSIONS = new Set(["mp4", "m4v", "mov", "webm", "mkv"]);
const IMAGE_EXTENSIONS = new Set(["jpg", "jpeg", "png", "webp"]);
const AUDIO_EXTENSIONS = new Set(["mp3", "m4a", "ogg", "opus", "wav"]);

export type MediaKind = "video" | "image" | "audio" | "document";

/**
 * How a downloaded file should be sent. Anything WhatsApp does not accept as
 * inline media goes out as a document, which always works.
 */
export function mediaKind(fileName: string): MediaKind {
  const extension = fileName.split(".").pop()?.toLowerCase() ?? "";
  if (VIDEO_EXTENSIONS.has(extension)) return "video";
  if (IMAGE_EXTENSIONS.has(extension)) return "image";
  if (AUDIO_EXTENSIONS.has(extension)) return "audio";
  return "document";
}
