import { describe, expect, test } from "bun:test";
import { parseMessage } from "@/lib/parseMessage";

const GROUP = "120363@g.us";
const LID = "17699593830485@lid";
const PN = "628123456789@s.whatsapp.net";

const sock = {
  user: { id: "628111@s.whatsapp.net", lid: "999@lid" },
  groupMetadata: async () => ({
    id: GROUP,
    subject: "G",
    owner: undefined,
    participants: [],
  }),
} as never;

function parse(key: Record<string, unknown>) {
  const raw = {
    key: { remoteJid: GROUP, ...key },
    message: { conversation: "hi" },
    pushName: "t",
    messageTimestamp: 0,
  } as never;

  return parseMessage(sock, raw, { prefixes: ["!"], ownerNumbers: [] });
}

describe("parseMessage sender resolution", () => {
  test("prefers the phone number when the group is addressed by LID", async () => {
    const msg = await parse({ participant: LID, participantAlt: PN });
    expect(msg?.senderPn).toBe(PN);
    expect(msg?.senderJid).toBe(PN);
  });

  test("prefers the phone number when the group is addressed by PN", async () => {
    const msg = await parse({ participant: PN, participantAlt: LID });
    expect(msg?.senderPn).toBe(PN);
    expect(msg?.senderJid).toBe(PN);
  });

  test("keeps a LID sender out of the chat JID", async () => {
    const msg = await parse({ participant: LID });
    expect(msg?.senderPn).toBe("");
    expect(msg?.senderJid).toBe(LID);
  });

  // Hosted accounts are the same two identities under `@hosted` / `@hosted.lid`.
  // Unrecognised, the sender fell through to the chat JID, making every sender
  // in the chat look identical.
  test("recognises hosted identities instead of falling back to the chat JID", async () => {
    const msg = await parse({
      participant: "111@hosted.lid",
      participantAlt: "222@hosted",
    });
    expect(msg?.senderPn).toBe("222@hosted");
    expect(msg?.senderJid).not.toBe(GROUP);
  });
});
