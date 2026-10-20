import { runTool } from "@/scrapers/iloveimg";

/** Upscales the image 2x or 4x on api20g, or returns null on any failure. */
export function upscale(imageUrl: string, scale: 2 | 4 = 2): Promise<Blob | null> {
  return runTool("api20g", "upscale", imageUrl, { scale: String(scale) });
}
