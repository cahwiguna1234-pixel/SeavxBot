import { extractUrls } from "@/lib/extractUrl";
import { BROWSER_UA, downloadMedia as fetchMedia } from "@/lib/media";

/** tikwm is a public resolver: it turns a share link into direct CDN URLs. */
const API_BASE = "https://www.tikwm.com/api/";
const API_TIMEOUT_MS = 20_000;
const TIKTOK_REFERER = "https://www.tiktok.com/";

export class TikTokError extends Error {}

export interface TikTokAuthor {
  nickname: string;
  username: string;
}

export interface TikTokMedia {
  id: string;
  title: string;
  author: TikTokAuthor;
  /** Seconds; 0 for photo slideshows. */
  duration: number;
  /** Direct no-watermark MP4. Absent for slideshows. */
  video?: string;
  /** Photo slideshow images, in post order. */
  images: string[];
  music?: string;
}

/** Host match rather than a URL regex: every share form is `*.tiktok.com`. */
export function isTikTokUrl(value: string): boolean {
  try {
    const host = new URL(value).hostname.toLowerCase();
    return host === "tiktok.com" || host.endsWith(".tiktok.com");
  } catch {
    return false;
  }
}

/** First TikTok link in a message, which may be a caption or a quoted reply. */
export function extractTikTokUrl(text: string): string | null {
  return extractUrls(text).find(isTikTokUrl) ?? null;
}

const asString = (value: unknown): string | undefined =>
  typeof value === "string" && value.length > 0 ? value : undefined;

const asNumber = (value: unknown): number =>
  typeof value === "number" && Number.isFinite(value) ? value : 0;

/**
 * Normalizes the resolver payload. Kept separate from the network call so the
 * shape assumptions can be tested against a literal response.
 */
export function parseTikTokPayload(payload: unknown): TikTokMedia {
  const root = payload as
    | { code?: unknown; msg?: unknown; data?: Record<string, unknown> }
    | undefined;

  if (root?.code !== 0 || !root.data) {
    const msg = asString(root?.msg);
    throw new TikTokError(
      msg && msg !== "success"
        ? msg
        : "TikTok returned no media for that link (it may be private or deleted).",
    );
  }

  const data = root.data;
  const author = data.author as Record<string, unknown> | undefined;
  const images = Array.isArray(data.images)
    ? data.images.filter(
        (url): url is string => typeof url === "string" && url.length > 0,
      )
    : [];

  // A slideshow still carries a `play` track, but sending it would drop the
  // photos the user actually asked for, so images take precedence.
  const video = images.length
    ? undefined
    : (asString(data.hdplay) ?? asString(data.play));

  if (!video && images.length === 0) {
    throw new TikTokError("That post has no downloadable video or photos.");
  }

  return {
    id: asString(data.id) ?? "",
    title: asString(data.title) ?? "",
    author: {
      nickname: asString(author?.nickname) ?? "TikTok",
      username: asString(author?.unique_id) ?? "",
    },
    duration: asNumber(data.duration),
    video,
    images,
    music: asString(data.music),
  };
}

export async function resolveTikTok(
  url: string,
  fetcher: typeof fetch = fetch,
): Promise<TikTokMedia> {
  if (!isTikTokUrl(url)) throw new TikTokError("That is not a TikTok link.");

  const endpoint = `${API_BASE}?url=${encodeURIComponent(url)}&hd=1`;
  const res = await fetcher(endpoint, {
    headers: {
      "User-Agent": BROWSER_UA,
      Referer: TIKTOK_REFERER,
      Accept: "application/json",
    },
    signal: AbortSignal.timeout(API_TIMEOUT_MS),
  });

  if (!res.ok) {
    throw new TikTokError(`TikTok resolver responded with ${res.status}.`);
  }

  return parseTikTokPayload(await res.json());
}

/** TikTok's CDN checks the referer, so the shared downloader is given one. */
export function downloadTikTokMedia(
  url: string,
  fetcher?: typeof fetch,
  maxBytes?: number,
): Promise<Buffer> {
  return fetchMedia(url, {
    fetcher,
    maxBytes,
    referer: TIKTOK_REFERER,
  });
}
