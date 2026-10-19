import type { Command } from "@/lib/types";
import { runMemberAction } from "@/lib/group";

export const promoteCommand: Command = {
  name: "promote",
  description: "Promote members to group admin",
  groupOnly: true,
  adminOnly: true,
  botAdminOnly: true,
  run: async ({ sock, msg, reply }) => {
    await reply(await runMemberAction(sock, msg, "promote"));
  },
};

export default promoteCommand;
