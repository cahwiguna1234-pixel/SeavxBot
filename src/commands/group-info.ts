import type { Command } from "@/lib/types";
import { describeGroup } from "@/lib/group";

export const groupInfoCommand: Command = {
  name: "groupinfo",
  description: "Show group details",
  aliases: ["ginfo", "gc"],
  groupOnly: true,
  run: async ({ msg, reply }) => {
    const meta = msg.groupMetadata;
    if (!meta) {
      await reply("🚩 Group metadata is unavailable right now.");
      return;
    }

    await reply(describeGroup(meta));
  },
};

export default groupInfoCommand;
