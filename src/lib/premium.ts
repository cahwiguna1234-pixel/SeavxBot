import type { WASocket } from "@whiskeysockets/baileys";
import { labelFor, resolveTargets, type Target } from "@/lib/group";
import type { ParsedMessage } from "@/lib/parseMessage";
import type { User } from "@/lib/users";

export const PREMIUM_USAGE =
  "🚩 Usage: !premium <7d|30d|permanent> [mention, reply, or number]";

const DAY_MS = 24 * 60 * 60 * 1000;
const DURATIONS: Record<string, number | null> = {
  "7d": 7 * DAY_MS,
  "30d": 30 * DAY_MS,
  permanent: null,
};

/** `null` for permanent, `undefined` when the token is invalid. */
export function durationUntil(
  token: string,
  now: number = Date.now(),
): number | null | undefined {
  const key = token.toLowerCase();
  if (!Object.hasOwn(DURATIONS, key)) return undefined;

  const duration = DURATIONS[key]!;
  return duration === null ? null : now + duration;
}

/** Splits a duration token out of the arguments and keeps the rest targets. */
export function splitDuration(args: string[]): {
  until: number | null | undefined;
  rest: string[];
} {
  const index = args.findIndex((arg) => Object.hasOwn(DURATIONS, arg.toLowerCase()));
  if (index === -1) return { until: undefined, rest: args };

  return {
    until: durationUntil(args[index]!),
    rest: args.filter((_, i) => i !== index),
  };
}

/**
 * Who the owner acts on. With nothing to act on the owner targets themselves,
 * but an unresolvable mention or number is an error: a typo must not silently
 * upgrade the caller (or create a ghost row).
 */
export async function resolveUserTargets(
  sock: WASocket,
  msg: ParsedMessage,
  args: string[],
): Promise<Target[]> {
  const targets = await resolveTargets(sock, msg, args);
  if (targets.length > 0) return targets;

  const asked =
    msg.mentions.length > 0 ||
    Boolean(msg.quoted?.senderJid) ||
    args.some((arg) => arg.replace(/\D/g, "").length >= 6);

  return asked
    ? []
    : [{ jid: msg.senderJid, label: labelFor(msg.senderJid) }];
}

const when = (ms: number): string =>
  new Date(ms).toISOString().slice(0, 16).replace("T", " ");

/** `2026-10-27 10:00`, or `permanent`. */
export const formatExpiry = (until: number | null): string =>
  until === null ? "permanent" : `until ${when(until)}`;

/** Shared wording so the three owner commands never disagree. */
export function describeUser(user: User, now: number = Date.now()): string {
  const expiry =
    user.role !== "premium"
      ? "—"
      : user.premiumUntil === null
        ? "permanent"
        : `${when(user.premiumUntil)}${user.premiumUntil <= now ? " (expired)" : ""}`;

  return [
    `👤 ${labelFor(user.jid)}`,
    `Role: ${user.role}${user.role === "premium" ? ` (until: ${expiry})` : ""}`,
    `Messages: ${user.messageCount}`,
    `Commands: ${user.commandCount}`,
    `First seen: ${when(user.firstSeenAt)}`,
    `Last seen: ${when(user.lastSeenAt)}`,
  ].join("\n");
}

export const NO_USER_TARGET =
  "🚩 Mention someone, reply to their message, or pass a phone number.";
