import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  createDownloaderCommand,
  type DownloaderDeps,
} from "@/lib/downloadCommand";
import type { DownloadedFile } from "@/lib/ytdlp";

const state = {
  available: true,
  calls: [] as string[],
  audioFlags: [] as (boolean | undefined)[],
  error: undefined as Error | undefined,
  files: [] as { name: string; bytes: number }[],
  cleanupCalls: 0,
};

const dirs: string[] = [];

function scratchDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "seavxbot-dl-"));
  dirs.push(dir);
  return dir;
}

/** The binary and the network are side effects; both are faked here. */
const deps: DownloaderDeps = {
  isAvailable: () => state.available,
  download: async (url: string, audio?: boolean) => {
    state.calls.push(url);
    state.audioFlags.push(audio);
    if (state.error) throw state.error;

    const dir = scratchDir();
    const files: DownloadedFile[] = state.files.map(({ name, bytes }) => {
      const file = path.join(dir, name);
      fs.writeFileSync(file, Buffer.alloc(bytes));
      return {
        path: file,
        name,
        kind: name.endsWith(".mp4")
          ? "video"
          : name.endsWith(".jpg")
            ? "image"
            : name.endsWith(".mp3")
              ? "audio"
              : "document",
      };
    });

    return {
      title: "cat tax",
      author: "Budi",
      files,
      cleanup: () => {
        state.cleanupCalls += 1;
      },
    };
  },
};

const spec = {
  name: "youtube",
  description: "test",
  label: "YouTube",
  isSupported: (url: string) => url.includes("youtube.com") || url.includes("youtu.be"),
};

interface Reply {
  content: unknown;
  options: unknown;
}

function context(body: string, quotedBody = "") {
  const replies: Reply[] = [];

  const ctx = {
    sock: {} as never,
    msg: { body, text: "", quoted: quotedBody ? { body: quotedBody } : undefined },
    reply: async (content: unknown, options?: unknown) => {
      replies.push({ content, options });
    },
  };

  return { ctx: ctx as never, replies };
}

beforeEach(() => {
  state.available = true;
  state.calls = [];
  state.audioFlags = [];
  state.error = undefined;
  state.files = [];
  state.cleanupCalls = 0;
});

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("createDownloaderCommand", () => {
  test("copies the spec onto the command", () => {
    const cmd = createDownloaderCommand({ ...spec, aliases: ["yt"] }, deps);
    expect(cmd.name).toBe("youtube");
    expect(cmd.description).toBe("test");
    expect(cmd.aliases).toEqual(["yt"]);
  });

  test("refuses early when yt-dlp is missing", async () => {
    state.available = false;
    const { ctx, replies } = context("https://www.youtube.com/watch?v=abc");

    await createDownloaderCommand(spec, deps).run(ctx);

    expect(replies).toHaveLength(1);
    expect(replies[0]!.content).toContain("yt-dlp is not installed");
    expect(state.calls).toHaveLength(0);
  });

  test("asks for a link when the message has none", async () => {
    const { ctx, replies } = context("no link here");

    await createDownloaderCommand(spec, deps).run(ctx);

    expect(replies[0]!.content).toContain("Send a YouTube link");
    expect(state.calls).toHaveLength(0);
  });

  test("finds the link in the message body", async () => {
    state.files = [{ name: "clip.mp4", bytes: 4 }];
    const { ctx, replies } = context("check https://youtu.be/abc123 thanks");

    await createDownloaderCommand(spec, deps).run(ctx);

    expect(state.calls).toEqual(["https://youtu.be/abc123"]);
    // One progress message plus the media itself.
    expect(replies).toHaveLength(2);
    expect(replies[1]!.content).toMatchObject({ caption: "cat tax\nBudi" });
  });

  test("finds the link in the quoted message", async () => {
    state.files = [{ name: "clip.mp4", bytes: 4 }];
    const { ctx } = context("", "https://www.youtube.com/watch?v=abc");

    await createDownloaderCommand(spec, deps).run(ctx);

    expect(state.calls).toEqual(["https://www.youtube.com/watch?v=abc"]);
  });

  test("skips a link belonging to another platform", async () => {
    const { ctx, replies } = context(
      "https://instagram.com/reel/1 https://youtu.be/abc",
    );
    state.files = [{ name: "clip.mp4", bytes: 4 }];

    await createDownloaderCommand(spec, deps).run(ctx);

    expect(state.calls).toEqual(["https://youtu.be/abc"]);
    expect(replies).toHaveLength(2);
  });

  test("sends a video with a caption and cleans up", async () => {
    state.files = [{ name: "clip.mp4", bytes: 4 }];
    const { ctx, replies } = context("https://youtu.be/abc");

    await createDownloaderCommand(spec, deps).run(ctx);

    const media = replies[1]!.content as { video: Buffer; caption: string };
    expect(media.video).toBeInstanceOf(Buffer);
    expect(media.video.byteLength).toBe(4);
    expect(media.caption).toBe("cat tax\nBudi");
    expect(state.cleanupCalls).toBe(1);
  });

  test("captions only the first slide of a carousel", async () => {
    state.files = [
      { name: "1.jpg", bytes: 2 },
      { name: "2.jpg", bytes: 3 },
    ];
    const { ctx, replies } = context("https://youtu.be/abc");

    await createDownloaderCommand(spec, deps).run(ctx);

    expect(replies).toHaveLength(3);
    expect(replies[1]!.content).toMatchObject({ caption: "cat tax\nBudi" });
    expect(replies[2]!.content).toEqual({ image: expect.any(Buffer) });
    expect(state.cleanupCalls).toBe(1);
  });

  test("sends an unsupported file type as a document", async () => {
    state.files = [{ name: "notes.txt", bytes: 5 }];
    const { ctx, replies } = context("https://youtu.be/abc");

    await createDownloaderCommand(spec, deps).run(ctx);

    expect(replies[1]!.content).toMatchObject({
      fileName: "notes.txt",
      mimetype: "application/octet-stream",
    });
  });

  test("sends audio inline and the credit as its own message", async () => {
    state.files = [{ name: "song.mp3", bytes: 5 }];
    const { ctx, replies } = context("https://youtu.be/abc");

    await createDownloaderCommand({ ...spec, audio: true }, deps).run(ctx);

    expect(state.audioFlags).toEqual([true]);
    expect(replies).toHaveLength(3);
    expect(replies[1]!.content).toMatchObject({
      mimetype: "audio/mpeg",
      fileName: "song.mp3",
    });
    expect(replies[2]!.content).toBe("cat tax\nBudi");
  });

  test("reports a download failure without crashing", async () => {
    state.error = new Error("🚩 That post is private.");
    const { ctx, replies } = context("https://youtu.be/abc");

    await createDownloaderCommand(spec, deps).run(ctx);

    expect(replies).toHaveLength(2);
    expect(replies[1]!.content).toBe("🚩 🚩 That post is private.");
    expect(state.cleanupCalls).toBe(0);
  });

  test("cleans up even when sending the media throws", async () => {
    state.files = [{ name: "clip.mp4", bytes: 4 }];
    const { ctx, replies } = context("https://youtu.be/abc");
    let sends = 0;
    (ctx as unknown as { reply: (content: unknown) => Promise<void> }).reply =
      async (content: unknown) => {
        sends += 1;
        // The progress notice goes through; the media upload fails.
        if (sends > 1) throw new Error("socket down");
        replies.push({ content, options: undefined });
      };

    await expect(createDownloaderCommand(spec, deps).run(ctx)).rejects.toThrow(
      "socket down",
    );
    expect(state.cleanupCalls).toBe(1);
  });
});
