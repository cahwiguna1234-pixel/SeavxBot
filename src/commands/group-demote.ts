import type { Command } from "@/lib/types";
import { runMemberAction } from "@/lib/group";

export const demoteCommand: Command = {
  name: "demote",
  description: "Demote group admins to members",
  groupOnly: true,
  adminOnly: true,
  botAdminOnly: true,
  run: async ({ sock, msg, reply }) => {
    await reply(await runMemberAction(sock, msg, "demote"));
  },
};

export default demoteCommand;
