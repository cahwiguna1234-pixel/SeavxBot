import { runTool } from "@/scrapers/iloveimg";

/** Upscales the image 4x on api20g, or returns null on any failure. */
export function upscale(imageUrl: string): Promise<Blob | null> {
  return runTool("api20g", "upscale", imageUrl, { scale: "4" });
}
