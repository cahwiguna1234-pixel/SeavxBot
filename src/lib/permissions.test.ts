import { describe, expect, test } from "bun:test";
import { resolvePermissions } from "@/lib/permissions";
import { invalidateGroupMetadata } from "@/lib/groupCache";

const GROUP = "120363@g.us";
const BOT_PN = "628111@s.whatsapp.net";
const BOT_LID = "999@lid";
const SENDER_LID = "17699593830485@lid";
const SENDER_PN = "628123456789@s.whatsapp.net";

/** A LID-addressed group: members are listed by LID, PNs ride in `phoneNumber`. */
const meta = {
  id: GROUP,
  subject: "G",
  owner: undefined,
  participants: [
    { id: SENDER_LID, phoneNumber: SENDER_PN, admin: "admin" },
    { id: BOT_LID, phoneNumber: BOT_PN, admin: "admin" },
  ],
};

function sock(
  user: { id: string; lid?: string },
  group: unknown = meta,
): never {
  return { user, groupMetadata: async () => group } as never;
}

async function perms(
  user: { id: string; lid?: string },
  overrides: Partial<Parameters<typeof resolvePermissions>[0]> = {},
  group: unknown = meta,
) {
  invalidateGroupMetadata(GROUP);
  return resolvePermissions({
    sock: sock(user, group),
    chatJid: GROUP,
    senderJid: SENDER_PN,
    senderPn: SENDER_PN,
    senderLid: SENDER_LID,
    fromMe: false,
    isGroup: true,
    ownerNumbers: [],
    ...overrides,
  });
}

describe("resolvePermissions group roles", () => {
  test("matches the sender through the participant phone number", async () => {
    const withLid = await perms({ id: BOT_PN, lid: BOT_LID });
    expect(withLid.isAdmin).toBe(true);
    expect(withLid.isBotAdmin).toBe(true);

    // Not every message carries the alternate identity; the PN in the group
    // metadata has to be enough on its own.
    const withoutLid = await perms(
      { id: BOT_PN, lid: BOT_LID },
      { senderLid: "" },
    );
    expect(withoutLid.isAdmin).toBe(true);
    expect(withoutLid.isBotAdmin).toBe(true);
  });

  test("finds the bot when its credentials carry only a phone number", async () => {
    expect((await perms({ id: BOT_PN })).isBotAdmin).toBe(true);
  });

  test("does not match an unrelated sender", async () => {
    const stranger = await perms(
      { id: BOT_PN, lid: BOT_LID },
      {
        senderJid: "628777@s.whatsapp.net",
        senderPn: "628777@s.whatsapp.net",
        senderLid: "",
      },
    );
    expect(stranger.isAdmin).toBe(false);
    expect(stranger.isSuperAdmin).toBe(false);
  });

  test("does not read the bot as a regular group admin", async () => {
    const noBot = {
      ...meta,
      participants: [meta.participants[0]],
    };
    const stranger = await perms(
      { id: BOT_PN, lid: BOT_LID },
      {
        senderJid: "628777@s.whatsapp.net",
        senderPn: "628777@s.whatsapp.net",
        senderLid: "",
      },
      noBot,
    );
    expect(stranger.isAdmin).toBe(false);
    expect(stranger.isBotAdmin).toBe(false);
  });

  test("does not match when every sender identity is empty", async () => {
    // areJidsSameUser("", "") is true, so empty inputs must be rejected up front.
    const anonymous = await perms(
      { id: BOT_PN, lid: BOT_LID },
      {
        senderJid: "",
        senderPn: "",
        senderLid: "",
      },
    );
    expect(anonymous.isAdmin).toBe(false);
    expect(anonymous.isSuperAdmin).toBe(false);
  });
});
