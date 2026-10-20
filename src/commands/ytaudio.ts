import { createDownloaderCommand } from "@/lib/downloadCommand";
import { isYouTubeUrl } from "@/lib/ytdlp";

export const youtubeAudioCommand = createDownloaderCommand({
  name: "ytmp3",
  description: "Download a YouTube video as an mp3",
  aliases: ["mp3", "yta"],
  label: "YouTube",
  isSupported: isYouTubeUrl,
  audio: true,
});

export default youtubeAudioCommand;
