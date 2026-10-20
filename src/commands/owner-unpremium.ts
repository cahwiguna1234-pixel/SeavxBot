import type { Command } from "@/lib/types";
import { getUsers } from "@/lib/db";
import { labelFor } from "@/lib/group";
import { NO_USER_TARGET, resolveUserTargets } from "@/lib/premium";

export const unpremiumCommand: Command = {
  name: "unpremium",
  description: "Revoke premium from a user (owner only)",
  aliases: ["downgrade"],
  ownerOnly: true,
  run: async ({ sock, msg, reply }) => {
    const targets = await resolveUserTargets(sock, msg, msg.args);
    if (targets.length === 0) {
      await reply(NO_USER_TARGET);
      return;
    }

    const users = getUsers();
    const lines = targets.map((target) => {
      const user = users.revokePremium(target.jid);
      return user
        ? `✅ ${labelFor(user.jid)} is free again.`
        : `🚩 ${target.label} has never talked to the bot.`;
    });

    await reply(lines.join("\n"));
  },
};

export default unpremiumCommand;
