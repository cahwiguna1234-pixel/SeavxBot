import { createDownloaderCommand } from "@/lib/downloadCommand";
import { isYouTubeUrl } from "@/lib/ytdlp";

export const youtubeCommand = createDownloaderCommand({
  name: "youtube",
  description: "Download a YouTube video (up to 720p)",
  aliases: ["yt", "ytmp4"],
  label: "YouTube",
  isSupported: isYouTubeUrl,
});

export default youtubeCommand;
