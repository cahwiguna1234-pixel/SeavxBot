import type { ScrapedMedia, Scraper } from "@/scrapers/types";
import { getText, MOBILE_UA } from "@/scrapers/http";

export const instagramScraper: Scraper = {
  id: "instagram",
  pattern: /https?:\/\/(?:www\.)?instagram\.com\/(?:p|reel|reels|tv)\/[\w-]+/i,

  async scrape(url: string): Promise<ScrapedMedia | null> {
    const match = url.match(/instagram\.com\/(p|reel|reels|tv)\/([\w-]+)/i);
    if (!match) return null;

    const [, kind, shortcode] = match;
    const html = await getText(
      `https://www.instagram.com/${kind}/${shortcode}/embed/captioned/`,
      { "user-agent": MOBILE_UA },
    );
    if (!html) return null;

    // The payload is JSON nested in markup, escaped up to three times; dropping
    // every backslash survives Meta changing the escape depth.
    const raw = html.match(/video_url\\":\\"(.*?)\\"/)?.[1];
    if (!raw) return null;

    const videoUrl = raw.replace(/\\u0026/g, "&").replace(/\\/g, "");
    if (!videoUrl.startsWith("https://")) return null;

    const username = html.match(/"username\\":\\"([\w.]+)\\"/)?.[1];

    return {
      platform: this.id,
      items: [{ url: videoUrl, kind: "video", mimetype: "video/mp4" }],
      caption: username ? `@${username} — Instagram reel` : "Instagram reel",
    };
  },
};
