import { describe, expect, test } from "bun:test";
import {
  handleParticipantsUpdate,
  renderGreeting,
  type ParticipantsUpdate,
} from "@/lib/greeting";
import type { GroupSettings, SettingsStore } from "@/lib/settings";

const GROUP = "120363@g.us";
const BOT_PN = "628111@s.whatsapp.net";
const BOT_LID = "999@lid";

const BOT = { id: BOT_PN, lid: BOT_LID };

const PARTICIPANTS: GroupSettings = {
  welcome: true,
  welcome_text: "Welcome {mention} to *{group}*! Member #{count}.",
  goodbye: true,
  goodbye_text: "Goodbye {name}.",
  antilink: "off",
};

function store(overrides: Partial<GroupSettings> = {}): SettingsStore {
  return {
    get: () => ({ ...PARTICIPANTS, ...overrides }),
    set: () => {},
  };
}

interface SentMessage {
  jid: string;
  text: string;
  mentions: string[];
}

function sock(options: { fail?: boolean } = {}) {
  const sent: SentMessage[] = [];

  const socket = {
    user: BOT,
    groupMetadata: async () => ({
      id: GROUP,
      subject: "Test Group",
      participants: [{ id: BOT_LID }],
    }),
    sendMessage: async (
      jid: string,
      content: { text: string; mentions?: string[] },
    ) => {
      if (options.fail) throw new Error("socket down");
      sent.push({ jid, text: content.text, mentions: content.mentions ?? [] });
    },
  };

  return { socket: socket as never, sent };
}

function update(overrides: Partial<ParticipantsUpdate> = {}): ParticipantsUpdate {
  return {
    id: GROUP,
    action: "add",
    participants: [{ id: "628222@s.whatsapp.net", notify: "Budi" }],
    ...overrides,
  } as ParticipantsUpdate;
}

describe("renderGreeting", () => {
  const members = [
    { jid: "628222@s.whatsapp.net", name: "Budi" },
    { jid: "628333@s.whatsapp.net", name: "Siti" },
  ];

  test("fills every supported placeholder", () => {
    expect(
      renderGreeting("{mention} {name} {group} {count}", {
        group: "G",
        count: 7,
        members,
      }),
    ).toBe("@628222 @628333 Budi, Siti G 7");
  });

  test("mentions by the id WhatsApp addressed, LID included", () => {
    expect(
      renderGreeting("{mention}", {
        group: "G",
        count: 1,
        members: [{ jid: "17699593830485@lid", name: "Budi" }],
      }),
    ).toBe("@17699593830485");
  });

  test("leaves an unknown placeholder untouched", () => {
    expect(
      renderGreeting("Hi {nickname}", { group: "G", count: 1, members }),
    ).toBe("Hi {nickname}");
  });

  test("renders a single member without a trailing separator", () => {
    expect(
      renderGreeting("{name}", {
        group: "G",
        count: 2,
        members: [members[0]!],
      }),
    ).toBe("Budi");
  });
});

describe("handleParticipantsUpdate", () => {
  test("welcomes an added member with a mention", async () => {
    const { socket, sent } = sock();

    await handleParticipantsUpdate(socket, store(), update());

    expect(sent).toHaveLength(1);
    expect(sent[0]!.text).toBe(
      "Welcome @628222 to *Test Group*! Member #1.",
    );
    expect(sent[0]!.mentions).toEqual(["628222@s.whatsapp.net"]);
    expect(sent[0]!.jid).toBe(GROUP);
  });

  test("says goodbye to a removed member by name", async () => {
    const { socket, sent } = sock();

    await handleParticipantsUpdate(
      socket,
      store(),
      update({
        action: "remove",
        participants: [{ id: "628222@s.whatsapp.net", name: "Budi" }],
      }),
    );

    expect(sent[0]!.text).toBe("Goodbye Budi.");
  });

  test("sends one message for a batch of members", async () => {
    const { socket, sent } = sock();

    await handleParticipantsUpdate(
      socket,
      store(),
      update({
        participants: [
          { id: "628222@s.whatsapp.net", notify: "Budi" },
          { id: "628333@s.whatsapp.net", notify: "Siti" },
          { id: "628444@s.whatsapp.net", notify: "Tono" },
        ],
      }),
    );

    expect(sent).toHaveLength(1);
    expect(sent[0]!.mentions).toHaveLength(3);
  });

  test("stays quiet when the setting is off", async () => {
    const { socket, sent } = sock();

    await handleParticipantsUpdate(socket, store({ welcome: false }), update());
    await handleParticipantsUpdate(
      socket,
      store({ goodbye: false }),
      update({ action: "remove" }),
    );

    expect(sent).toHaveLength(0);
  });

  test("ignores actions that are neither add nor remove", async () => {
    const { socket, sent } = sock();

    for (const action of ["promote", "demote", "modify"] as const) {
      await handleParticipantsUpdate(socket, store(), update({ action }));
    }

    expect(sent).toHaveLength(0);
  });

  test("never greets the bot itself", async () => {
    const { socket, sent } = sock();

    await handleParticipantsUpdate(
      socket,
      store(),
      update({ participants: [{ id: BOT_LID }] }),
    );

    expect(sent).toHaveLength(0);
  });

  test("greets the humans in a batch that also contains the bot", async () => {
    const { socket, sent } = sock();

    await handleParticipantsUpdate(
      socket,
      store(),
      update({ participants: [{ id: BOT_PN }, { id: "628222@s.whatsapp.net" }] }),
    );

    expect(sent).toHaveLength(1);
    expect(sent[0]!.mentions).toEqual(["628222@s.whatsapp.net"]);
  });

  test("swallows a send failure instead of throwing", async () => {
    const { socket } = sock({ fail: true });

    await expect(
      handleParticipantsUpdate(socket, store(), update()),
    ).resolves.toBeUndefined();
  });

  test("falls back to the number when WhatsApp sends no name", async () => {
    const { socket, sent } = sock();

    await handleParticipantsUpdate(
      socket,
      store(),
      update({
        action: "remove",
        participants: [{ id: "628222@s.whatsapp.net" }],
      }),
    );

    expect(sent[0]!.text).toBe("Goodbye +628222.");
  });

  test("keeps a LID an @id when it is the only identity available", async () => {
    const { socket, sent } = sock();

    await handleParticipantsUpdate(
      socket,
      store(),
      update({
        action: "remove",
        participants: [{ id: "17699593830485@lid" }],
      }),
    );

    expect(sent[0]!.text).toBe("Goodbye @17699593830485.");
  });
});
