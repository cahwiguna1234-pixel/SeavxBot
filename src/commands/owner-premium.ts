import type { Command } from "@/lib/types";
import { getUsers } from "@/lib/db";
import { labelFor } from "@/lib/group";
import {
  NO_USER_TARGET,
  PREMIUM_USAGE,
  formatExpiry,
  resolveUserTargets,
  splitDuration,
} from "@/lib/premium";

export const premiumCommand: Command = {
  name: "premium",
  description: "Grant premium to a user (owner only)",
  aliases: ["upgrade"],
  ownerOnly: true,
  run: async ({ sock, msg, reply }) => {
    const { until, rest } = splitDuration(msg.args);
    if (until === undefined) {
      await reply(PREMIUM_USAGE);
      return;
    }

    const targets = await resolveUserTargets(sock, msg, rest);
    if (targets.length === 0) {
      await reply(NO_USER_TARGET);
      return;
    }

    const users = getUsers();
    const lines = targets.map((target) => {
      try {
        users.grantPremium(target.jid, until, msg.senderJid);
        return `✅ ${labelFor(target.jid)} is premium (${formatExpiry(until)}).`;
      } catch (err) {
        console.error("Failed to grant premium:", err);
        return `🚩 Could not upgrade ${target.label}.`;
      }
    });

    await reply(lines.join("\n"));
  },
};

export default premiumCommand;
