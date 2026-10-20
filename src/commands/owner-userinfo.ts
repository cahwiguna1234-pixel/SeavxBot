import type { Command } from "@/lib/types";
import { getUsers } from "@/lib/db";
import { NO_USER_TARGET, describeUser, resolveUserTargets } from "@/lib/premium";

export const userInfoCommand: Command = {
  name: "userinfo",
  description: "Show a user's role and activity (owner only)",
  aliases: ["profile"],
  ownerOnly: true,
  run: async ({ sock, msg, reply }) => {
    const targets = await resolveUserTargets(sock, msg, msg.args);
    if (targets.length === 0) {
      await reply(NO_USER_TARGET);
      return;
    }

    const users = getUsers();
    const lines = targets.map((target) => {
      const user = users.get(target.jid);
      return user
        ? describeUser(user)
        : `👤 ${target.label}\nDevice: unknown (they can send .deviceinfo)\nOS: unknown\nNo other record — this user has never talked to the bot.`;
    });

    await reply(lines.join("\n\n"));
  },
};

export default userInfoCommand;
