import type { Command } from "@/lib/types";
import { botConfig } from "@/lib/config";
import { getDb, getGroupSettings } from "@/lib/db";
import { disableSchedule, enableSchedule } from "@/lib/schedule";
import {
  ANTILINK_MODES,
  CLOCK_RE,
  type AntilinkMode,
  type GroupSettings,
} from "@/lib/settings";

const MAX_TEXT = 500;

const FALLBACK_WELCOME = "Welcome {mention} to *{group}*!";
const FALLBACK_GOODBYE = "Goodbye {name}.";

const usage = (prefix: string): string =>
  [
    "🚩 Usage:",
    `• ${prefix}settings`,
    `• ${prefix}settings welcome on|off`,
    `• ${prefix}settings welcometext <text>`,
    `• ${prefix}settings goodbye on|off`,
    `• ${prefix}settings goodbyetext <text>`,
    `• ${prefix}settings antilink off|warn|delete`,
    `• ${prefix}settings autoclose on|off`,
    `• ${prefix}settings autoclose 23:00`,
    `• ${prefix}settings autoopen on|off`,
    `• ${prefix}settings autoopen 06:00`,
    "",
    "Use `default` as the text to restore the bot default.",
  ].join("\n");

const onOff = (value: boolean): string => (value ? "on" : "off");

function panel(settings: GroupSettings, subject: string, prefix: string) {
  return [
    `*Settings — ${subject}*`,
    "",
    `Welcome: ${onOff(settings.welcome)}`,
    `  ${settings.welcome_text}`,
    `Goodbye: ${onOff(settings.goodbye)}`,
    `  ${settings.goodbye_text}`,
    `Antilink: ${settings.antilink}`,
    `Auto-close: ${settings.auto_close ? settings.auto_close_time : "off"}`,
    `Auto-open: ${settings.auto_open ? settings.auto_open_time : "off"}`,
    "",
    "Placeholders: {mention} {name} {group} {count}",
    "",
    "Change with:",
    `• ${prefix}settings welcome on|off`,
    `• ${prefix}settings welcometext <text>`,
    `• ${prefix}settings antilink off|warn|delete`,
    `• ${prefix}settings autoclose on|off|<HH:MM>`,
    `• ${prefix}settings autoopen on|off|<HH:MM>`,
  ].join("\n");
}

/** The action a settings sub-command controls, or undefined for the others. */
const SCHEDULE_SUBS = {
  autoclose: { flag: "auto_close", time: "auto_close_time", label: "Close" },
  autoopen: { flag: "auto_open", time: "auto_open_time", label: "Open" },
} as const;

type ScheduleSub = keyof typeof SCHEDULE_SUBS;

const DEFAULT_TIMES = { autoclose: "23:00", autoopen: "06:00" } as const;

/** Accepts only on/off, so a typo never silently disables a setting. */
function parseToggle(value: string): boolean | undefined {
  if (value === "on") return true;
  if (value === "off") return false;
  return undefined;
}

export const settingsCommand: Command = {
  name: "settings",
  description: "View or change this group's settings",
  aliases: ["set"],
  groupOnly: true,
  adminOnly: true,
  run: async ({ msg, reply }) => {
    const store = getGroupSettings();
    const subject = msg.groupMetadata?.subject || "this group";
    const [sub = "", ...rest] = msg.args;
    const value = rest.join(" ").trim();

    if (!sub) {
      await reply(panel(store.get(msg.chatJid), subject, msg.prefix));
      return;
    }

    switch (sub) {
      case "welcome":
      case "goodbye": {
        const next = parseToggle(value);
        if (next === undefined) {
          await reply(`🚩 Use: ${msg.prefix}settings ${sub} on|off`);
          return;
        }
        store.set(msg.chatJid, sub, next);
        const label = sub === "welcome" ? "Welcome" : "Goodbye";
        await reply(`✅ ${label} ${onOff(next)}.`);
        return;
      }

      case "welcometext":
      case "goodbyetext": {
        const key = sub === "welcometext" ? "welcome_text" : "goodbye_text";
        const fallback =
          sub === "welcometext" ? FALLBACK_WELCOME : FALLBACK_GOODBYE;
        const configured =
          (sub === "welcometext"
            ? botConfig.messages?.welcome_text
            : botConfig.messages?.goodbye_text) || fallback;

        if (!value) {
          await reply(`🚩 Use: ${msg.prefix}settings ${sub} <text>|default`);
          return;
        }
        if (value.length > MAX_TEXT) {
          await reply(`🚩 Text is too long (${value.length}/${MAX_TEXT}).`);
          return;
        }

        const text = value === "default" ? configured : value;
        store.set(msg.chatJid, key, text);
        await reply(`✅ Saved:\n\n${text}`);
        return;
      }

      case "antilink": {
        if (!ANTILINK_MODES.includes(value as AntilinkMode)) {
          await reply(`🚩 Use: ${msg.prefix}settings antilink off|warn|delete`);
          return;
        }
        store.set(msg.chatJid, "antilink", value as AntilinkMode);
        await reply(`✅ Antilink ${value}.`);
        return;
      }

      case "autoclose":
      case "autoopen": {
        const { flag, time: timeKey, label } = SCHEDULE_SUBS[sub];
        const configured =
          sub === "autoclose"
            ? botConfig.schedule?.auto_close_time || DEFAULT_TIMES.autoclose
            : botConfig.schedule?.auto_open_time || DEFAULT_TIMES.autoopen;

        if (value === "on" || value === "off") {
          const enabled = value === "on";
          store.set(msg.chatJid, flag, enabled);
          const current = store.get(msg.chatJid);
          // The table row scopes the scheduler's scan; the flags pick which
          // halves fire, so either half staying on must keep the row.
          if (current.auto_close || current.auto_open) {
            enableSchedule(getDb(), msg.chatJid);
          } else {
            disableSchedule(getDb(), msg.chatJid);
          }

          await reply(
            enabled
              ? `✅ Auto-${sub.slice(4)} at ${current[timeKey]} (local time).`
              : `✅ ${label} schedule off.`,
          );
          return;
        }

        // Setting a time is the whole intent behind the sub-command, so it arms
        // the schedule too instead of leaving a time that never fires.
        const at = value === "default" ? configured : value;
        if (!CLOCK_RE.test(at)) {
          await reply(`🚩 Use: ${msg.prefix}settings ${sub} on|off|<HH:MM>`);
          return;
        }

        store.set(msg.chatJid, timeKey, at);
        store.set(msg.chatJid, flag, true);
        enableSchedule(getDb(), msg.chatJid);
        await reply(`✅ Auto-${sub.slice(4)} at ${at} (local time).`);
        return;
      }

      default:
        await reply(usage(msg.prefix));
    }
  },
};

export default settingsCommand;
