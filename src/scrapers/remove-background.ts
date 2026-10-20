import { runTool } from "@/scrapers/iloveimg";

/** Removes the background and returns a transparent PNG, or null on failure.
 *  The tool only exists on api4g–api6g; api20g answers 500. */
export function removeBackground(imageUrl: string): Promise<Blob | null> {
  return runTool("api4g", "removebackground", imageUrl);
}
