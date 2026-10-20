import { createDownloaderCommand } from "@/lib/downloadCommand";
import { isInstagramUrl } from "@/lib/ytdlp";

export const instagramCommand = createDownloaderCommand({
  name: "instagram",
  description: "Download an Instagram reel, video, or photo post",
  aliases: ["ig", "igdl"],
  label: "Instagram",
  isSupported: isInstagramUrl,
});

export default instagramCommand;
