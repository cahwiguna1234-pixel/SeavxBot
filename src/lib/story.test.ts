import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { WASocket } from "@whiskeysockets/baileys";
import {
  STATUS_HEIGHT,
  STATUS_JID,
  STATUS_WIDTH,
  StoryError,
  argsFor,
  collectStatusRecipients,
  imageArgsFor,
  publishStatus,
} from "@/lib/story";

describe("argsFor", () => {
  test("targets the 1080x1920 story canvas", () => {
    const filter = argsFor("in.mp4", "out.mp4")[argsFor("in.mp4", "out.mp4").indexOf("-vf") + 1]!;
    expect(filter).toContain(`scale=${STATUS_WIDTH}:${STATUS_HEIGHT}`);
    expect(filter).toContain(`pad=${STATUS_WIDTH}:${STATUS_HEIGHT}`);
  });

  test("forces a square sample aspect ratio", () => {
    const args = argsFor("in.mp4", "out.mp4");
    expect(args[args.indexOf("-vf") + 1]).toContain("setsar=1");
  });

  test("encodes H.264 with AAC audio", () => {
    const args = argsFor("in.mp4", "out.mp4");
    expect(args[args.indexOf("-c:v") + 1]).toBe("libx264");
    expect(args[args.indexOf("-c:a") + 1]).toBe("aac");
    // The video pixel format comes from the filter chain, not a separate flag.
    expect(args).not.toContain("-pix_fmt");
    expect(args[args.indexOf("-vf") + 1]).toContain("format=yuv420p");
  });

  test("asks for a fast-start mp4", () => {
    expect(argsFor("in.mp4", "out.mp4")).toContain("+faststart");
  });

  test("overwrites and stays quiet on the console", () => {
    const args = argsFor("in.mp4", "out.mp4");
    expect(args).toContain("-y");
    expect(args[args.indexOf("-loglevel") + 1]).toBe("error");
  });
});

describe("imageArgsFor", () => {
  test("scales and pads to the same canvas", () => {
    const args = imageArgsFor("in.jpg", "out.jpg");
    const filter = args[args.indexOf("-vf") + 1]!;
    expect(filter).toContain(`scale=${STATUS_WIDTH}:${STATUS_HEIGHT}`);
    expect(filter).toContain("setsar=1");
  });

  test("writes a 4:2:0 JPEG, which WhatsApp accepts", () => {
    const args = imageArgsFor("in.jpg", "out.jpg");
    expect(args[args.indexOf("-pix_fmt") + 1]).toBe("yuvj420p");
  });

  test("keeps a single frame", () => {
    const args = imageArgsFor("in.jpg", "out.jpg");
    expect(args[args.indexOf("-frames:v") + 1]).toBe("1");
  });
});

describe("collectStatusRecipients", () => {
  test("dedupes participants across groups", () => {
    const groups = {
      "1@g.us": {
        participants: [
          { id: "628111@s.whatsapp.net" },
          { id: "628222@s.whatsapp.net" },
        ],
      },
      "2@g.us": {
        participants: [
          { id: "628222@s.whatsapp.net" },
          { id: "628333@s.whatsapp.net" },
        ],
      },
    };

    expect(collectStatusRecipients(groups).sort()).toEqual([
      "628111@s.whatsapp.net",
      "628222@s.whatsapp.net",
      "628333@s.whatsapp.net",
    ]);
  });

  test("keeps LID identities, since that is how they are addressed", () => {
    const groups = {
      "1@g.us": {
        participants: [{ id: "17699593830485@lid" }],
      },
    };

    expect(collectStatusRecipients(groups)).toEqual(["17699593830485@lid"]);
  });

  test("returns an empty list when the bot shares no groups", () => {
    expect(collectStatusRecipients({})).toEqual([]);
  });

  test("tolerates a group without a participant array", () => {
    expect(collectStatusRecipients({ "1@g.us": {} as never })).toEqual([]);
  });
});

/** The socket is 170+ methods deep; only two of them matter here. */
const asSocket = (sock: unknown): Pick<
  WASocket,
  "sendMessage" | "groupFetchAllParticipating"
> => sock as Pick<WASocket, "sendMessage" | "groupFetchAllParticipating">;

describe("publishStatus", () => {
  test("posts to status@broadcast with the recipient list", async () => {
    const calls: { jid: string; content: unknown; options: unknown }[] = [];

    const sock = {
      groupFetchAllParticipating: async () => ({
        "1@g.us": { participants: [{ id: "628111@s.whatsapp.net" }] },
      }),
      sendMessage: async (jid: string, content: unknown, options: unknown) => {
        calls.push({ jid, content, options });
        return undefined;
      },
    };

    const reached = await publishStatus(asSocket(sock), {
      image: Buffer.alloc(1),
    });

    expect(reached).toBe(1);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.jid).toBe(STATUS_JID);
    expect(calls[0]!.options).toEqual({
      statusJidList: ["628111@s.whatsapp.net"],
    });
  });

  test("still posts when the group list cannot be fetched", async () => {
    const calls: unknown[] = [];

    const sock = {
      groupFetchAllParticipating: async () => {
        throw new Error("socket busy");
      },
      sendMessage: async (_jid: string, _content: unknown, options: unknown) => {
        calls.push(options);
        return undefined;
      },
    };

    const reached = await publishStatus(asSocket(sock), {
      image: Buffer.alloc(1),
    });

    expect(reached).toBe(0);
    expect(calls).toEqual([{ statusJidList: [] }]);
  });
});

describe("StoryError", () => {
  test("is a plain Error subclass", () => {
    expect(new StoryError("x")).toBeInstanceOf(Error);
  });
});

describe("transcode helpers", () => {
  test("ffmpeg failures surface as StoryError", async () => {
    const { transcodeForStory } = await import("@/lib/story");
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "seavxbot-bad-"));

    try {
      await expect(
        transcodeForStory(path.join(dir, "does-not-exist.mp4"), {
          workDir: dir,
          timeoutMs: 10_000,
        }),
      ).rejects.toThrow(StoryError);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
