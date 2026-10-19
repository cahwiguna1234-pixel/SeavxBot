import { describe, expect, test } from "bun:test";
import { Boom } from "@hapi/boom";
import {
  describeError,
  describeGroup,
  resolveTargets,
  runMemberAction,
} from "@/lib/group";
import { getGroupMetadata, invalidateGroupMetadata } from "@/lib/groupCache";
import type { ParsedMessage } from "@/lib/parseMessage";

const LID = "17699593830485@lid";
const PN = "628123456789@s.whatsapp.net";
const GROUP = "120363@g.us";

const meta = {
  id: GROUP,
  subject: "G",
  owner: undefined,
  participants: [
    { id: LID, phoneNumber: PN, admin: "admin" },
    { id: "628888@s.whatsapp.net" },
  ],
} as unknown as Parameters<typeof describeGroup>[0];

function sock(overrides: Record<string, unknown> = {}) {
  return {
    user: { id: "628111@s.whatsapp.net", lid: "999@lid" },
    onWhatsApp: async (...numbers: string[]) =>
      numbers.map((n) => ({ jid: `${n}@s.whatsapp.net`, exists: true })),
    groupMetadata: async () => meta,
    groupParticipantsUpdate: async (_jid: string, jids: string[]) =>
      jids.map((jid) => ({ status: "200", jid, content: {} })),
    ...overrides,
  } as never;
}

function message(overrides: Partial<ParsedMessage> = {}): ParsedMessage {
  return {
    raw: {},
    key: {},
    id: "X",
    fromMe: false,
    chatJid: GROUP,
    senderJid: "628222@s.whatsapp.net",
    senderPn: "628222@s.whatsapp.net",
    isGroup: true,
    isOwner: false,
    isAdmin: true,
    isSuperAdmin: false,
    isBotAdmin: true,
    pushName: "t",
    timestamp: 0,
    type: "conversation",
    body: "",
    prefix: "!",
    command: "kick",
    args: [],
    text: "",
    isCmd: true,
    mentions: [],
    groupMetadata: meta,
    ...overrides,
  } as ParsedMessage;
}

describe("describeError", () => {
  // Baileys throws `new Boom(text, { data: code })` from assertNodeErrorFree,
  // so the code is on `.data` — reading output.statusCode always yields 500.
  test("maps the code carried in Boom.data", () => {
    expect(describeError(new Boom("not-authorized", { data: 403 }))).toContain(
      "need to be a group admin",
    );
    expect(describeError(new Boom("item-not-found", { data: 404 }))).toBe(
      "🚩 Group not found.",
    );
  });

  test("still honours a real statusCode", () => {
    const err = Object.assign(new Error("x"), {
      output: { statusCode: 403 },
    });
    expect(describeError(err)).toContain("need to be a group admin");
  });

  // Not every Boom carries a numeric `data`: messages.js throws
  // `new Boom(text, { statusCode, data: message })`. Reading only `data` would
  // report a generic 500 and lose the status.
  test("falls back to statusCode when data is not a code", () => {
    const err = new Boom("No message present", {
      statusCode: 403,
      data: { some: "node" },
    });
    expect(describeError(err)).toContain("need to be a group admin");

    const gone = new Boom("gone", { statusCode: 404, data: { node: 1 } });
    expect(describeError(gone)).toBe("🚩 Group not found.");
  });

  test("passes unknown failures through verbatim", () => {
    expect(describeError(new Boom("bad-request", { data: 400 }))).toBe(
      "🚩 bad-request",
    );
  });
});

describe("resolveTargets", () => {
  test("labels a LID mention with the phone number, not the internal id", async () => {
    const targets = await resolveTargets(
      sock(),
      message({ mentions: [LID] }),
      [],
    );
    expect(targets).toEqual([{ jid: PN, label: "+628123456789" }]);
  });

  test("keeps a LID that has no PN in metadata", async () => {
    const targets = await resolveTargets(
      sock(),
      message({ mentions: ["555@lid"] }),
      [],
    );
    expect(targets.map((t) => t.jid)).toEqual(["555@lid"]);
    // A LID is an internal id; presenting it as `+555` would dress it up as a
    // dialable number.
    expect(targets[0]?.label).toBe("@555");
  });

  test("merges mentions with explicit numbers without duplicating", async () => {
    const targets = await resolveTargets(
      sock(),
      message({ mentions: ["628888@s.whatsapp.net"] }),
      ["628888"],
    );
    expect(targets.map((t) => t.jid)).toEqual(["628888@s.whatsapp.net"]);
  });

  test("falls back to the quoted author", async () => {
    const quoted = {
      key: {},
      id: "Q",
      senderJid: "628777@s.whatsapp.net",
      body: "",
      type: "",
    };
    const targets = await resolveTargets(sock(), message({ quoted }), []);
    expect(targets.map((t) => t.jid)).toEqual(["628777@s.whatsapp.net"]);
  });
});

describe("runMemberAction", () => {
  test("refuses to remove the bot itself", async () => {
    expect(
      await runMemberAction(
        sock(),
        message({ mentions: ["999@lid"] }),
        "remove",
      ),
    ).toBe("🚩 I won't remove myself.");
  });

  test("reports per-member status", async () => {
    const partial = sock({
      groupParticipantsUpdate: async (_jid: string, jids: string[]) =>
        jids.map((jid) => ({
          status: jid.includes("628888") ? "408" : "200",
          jid,
          content: {},
        })),
    });

    const text = await runMemberAction(
      partial,
      message({ mentions: ["628888@s.whatsapp.net", "628999@s.whatsapp.net"] }),
      "remove",
    );

    expect(text).toBe(
      "Removed 2 member(s)\n" +
        "🚩 +628888 — not in this group\n" +
        "✅ +628999 — done",
    );
  });

  // A LID-addressed group answers with the LID even though the request named the
  // PN, so labeling the raw answer would print an internal id to the admin.
  test("labels a LID answer with the phone number", async () => {
    const echoed = sock({
      groupParticipantsUpdate: async () => [
        { status: "200", jid: LID, content: {} },
      ],
    });

    const text = await runMemberAction(
      echoed,
      message({ mentions: [LID] }),
      "promote",
    );

    expect(text).toBe("Promoted 1 member(s)\n✅ +628123456789 — done");
  });

  test("asks for a target when there is none", async () => {
    expect(await runMemberAction(sock(), message(), "remove")).toContain(
      "Mention someone",
    );
  });
});

describe("describeGroup", () => {
  test("renders the local calendar day, not UTC", () => {
    const creation = 1699977600 + 6 * 3600; // 2023-11-15 00:00 in WIB
    const line = describeGroup({ ...meta, creation } as typeof meta).split(
      "\n",
    )[2];
    const expected = new Date(creation * 1000).toLocaleDateString("en-CA");
    expect(line).toBe(`Created: ${expected}`);
  });
});

describe("groupCache", () => {
  test("serves a second read from cache and refetches after invalidation", async () => {
    let fetches = 0;
    const counting = sock({
      groupMetadata: async () => {
        fetches++;
        return meta;
      },
    });

    await getGroupMetadata(counting, "cache@g.us");
    await getGroupMetadata(counting, "cache@g.us");
    expect(fetches).toBe(1);

    invalidateGroupMetadata("cache@g.us");
    await getGroupMetadata(counting, "cache@g.us");
    expect(fetches).toBe(2);
  });

  test("never caches a failed fetch as success", async () => {
    const failing = sock({
      groupMetadata: async () => {
        throw new Boom("item-not-found", { data: 404 });
      },
    });

    expect(await getGroupMetadata(failing, "fail@g.us")).toBeUndefined();
  });
});
