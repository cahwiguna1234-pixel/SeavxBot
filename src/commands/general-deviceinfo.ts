import type { Command } from "@/lib/types";
import { botConfig } from "@/lib/config";
import { getUsers } from "@/lib/db";
import { createDeviceLink } from "@/lib/deviceInfo";
import { lanUrl } from "@/lib/deviceServer";

export const deviceInfoCommand: Command = {
  name: "deviceinfo",
  description: "Have a user report the phone and OS they use",
  aliases: ["mydevice"],
  run: async ({ msg, reply }) => {
    const port = botConfig.device_info?.port ?? 3000;
    const base = botConfig.device_info?.public_url || lanUrl(port);
    const link = createDeviceLink(msg.senderJid, base);

    await reply(
      `📱 Open this link on the phone you use WhatsApp with, within 15 minutes:\n${link}\n\nOnce saved, .userinfo will show your device.`,
    );
  },
};

export default deviceInfoCommand;
