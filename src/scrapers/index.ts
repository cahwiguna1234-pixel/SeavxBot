import type { ScrapedMedia, Scraper } from "@/scrapers/types";
import { instagramScraper } from "@/scrapers/instagram";
import { tiktokScraper } from "@/scrapers/tiktok";

export type { ScrapedMedia, Scraper } from "@/scrapers/types";

/** Every supported platform. Add a scraper here to make it available bot-wide. */
export const scrapers: Scraper[] = [tiktokScraper, instagramScraper];

/** Finds the scraper owning a URL, or null when no platform matches. */
export function findScraper(
  text: string,
): { scraper: Scraper; url: string } | null {
  if (!text) return null;

  for (const scraper of scrapers) {
    const match = text.match(scraper.pattern);
    if (match) return { scraper, url: match[0] };
  }

  return null;
}

/** Resolves any supported URL to downloadable media, or null when unavailable. */
export async function scrape(url: string): Promise<ScrapedMedia | null> {
  const found = findScraper(url);
  if (!found) return null;

  try {
    return await found.scraper.scrape(found.url);
  } catch (err) {
    console.error(`Scraper [${found.scraper.id}] failed:`, err);
    return null;
  }
}
