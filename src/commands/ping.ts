import type { Command } from "@/lib/types";

export const pingCommand: Command = {
  name: "ping",
  description: "Check bot response time",
  aliases: ["p"],
  run: async ({ reply }) => {
    await reply("pong!");
  },
};

export default pingCommand;
