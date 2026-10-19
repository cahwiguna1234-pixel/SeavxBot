import type { Command } from "@/lib/types";
import { runMemberAction } from "@/lib/group";

export const kickCommand: Command = {
  name: "kick",
  description: "Remove members from the group",
  aliases: ["remove"],
  groupOnly: true,
  adminOnly: true,
  botAdminOnly: true,
  run: async ({ sock, msg, reply }) => {
    await reply(await runMemberAction(sock, msg, "remove"));
  },
};

export default kickCommand;
