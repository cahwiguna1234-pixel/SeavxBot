import type { Command } from "@/lib/types";
import { userPart } from "@/lib/group";

export const tagAllCommand: Command = {
  name: "tagall",
  description: "Mention every group member",
  aliases: ["everyone"],
  groupOnly: true,
  adminOnly: true,
  run: async ({ msg, reply }) => {
    const meta = msg.groupMetadata;
    if (!meta) {
      await reply("🚩 Group metadata is unavailable right now.");
      return;
    }

    const mentions = meta.participants.map((participant) => participant.id);
    const list = meta.participants
      .map((participant, index) => `${index + 1}. @${userPart(participant.id)}`)
      .join("\n");

    const header = msg.text.trim() || "Attention:";
    await reply({ text: `${header}\n\n${list}`, mentions });
  },
};

export default tagAllCommand;
