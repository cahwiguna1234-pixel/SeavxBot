/** A single downloadable file resolved from a post. */
export interface MediaItem {
  /** Direct CDN URL. */
  url: string;
  /** `video` sends as a playable clip, `image` as a photo. */
  kind: "video" | "image";
  mimetype: string;
}

/** Everything a post yields: a video, or the slides of a photo carousel. */
export interface ScrapedMedia {
  platform: string;
  /** Ordered items; a carousel has one entry per slide. */
  items: MediaItem[];
  caption: string;
}

/** One platform adapter. Every scraper is dependency-free: plain `fetch`, no
 *  Baileys, no WhatsApp types — so it can run from a CLI or a test as-is. */
export interface Scraper {
  /** Stable id, also used for log lines and filenames. */
  id: string;
  /** Matches a post URL for this platform. */
  pattern: RegExp;
  /** Resolves a post URL to downloadable media, or null when unavailable. */
  scrape(url: string): Promise<ScrapedMedia | null>;
}
