import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  DownloadError,
  downloadWithYtDlp,
  isInstagramUrl,
  isYouTubeUrl,
  parseProbe,
  type YtDlpResult,
  type YtDlpRunner,
} from "@/lib/ytdlp";
import { MAX_MEDIA_BYTES, mediaKind } from "@/lib/media";

const INFO = {
  _type: "video",
  title: "cat tax",
  uploader: "Budi",
  duration: 42,
};

const VIDEO_URL = "https://www.youtube.com/watch?v=dQw4w9WgXcQ";

/** Records every invocation and answers from a queue of canned results. */
function runner(
  responses: YtDlpResult[],
  onCall?: (args: string[]) => void,
): { run: YtDlpRunner; calls: string[][] } {
  const calls: string[][] = [];

  const run: YtDlpRunner = async (args) => {
    calls.push(args);
    onCall?.(args);
    const next = responses.shift();
    if (!next) throw new Error(`unexpected call: ${args.join(" ")}`);
    return next;
  };

  return { run, calls };
}

const ok = (stdout = ""): YtDlpResult => ({ stdout, stderr: "", exitCode: 0 });
const fail = (stderr: string, exitCode = 1): YtDlpResult => ({
  stdout: "",
  stderr,
  exitCode,
});

function workDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "seavxbot-test-"));
}

/** Pretends yt-dlp wrote a file, since the runner is what actually would. */
function writes(name: string, bytes = 8) {
  return (args: string[]): void => {
    const outIndex = args.indexOf("-o");
    const template = outIndex >= 0 ? args[outIndex + 1]! : "";
    if (!template) return;
    fs.writeFileSync(path.join(path.dirname(template), name), Buffer.alloc(bytes));
  };
}

describe("isYouTubeUrl", () => {
  test("accepts the usual YouTube hosts", () => {
    for (const url of [
      "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      "https://youtu.be/dQw4w9WgXcQ",
      "https://m.youtube.com/watch?v=dQw4w9WgXcQ",
      "https://music.youtube.com/watch?v=dQw4w9WgXcQ",
      "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ",
    ]) {
      expect(isYouTubeUrl(url)).toBe(true);
    }
  });

  test("rejects lookalikes and other sites", () => {
    for (const url of [
      "https://youtube.com.evil.example/watch?v=1",
      "https://notyoutube.com/watch?v=1",
      "https://instagram.com/reel/1",
      "nonsense",
    ]) {
      expect(isYouTubeUrl(url)).toBe(false);
    }
  });
});

describe("isInstagramUrl", () => {
  test("accepts posts, reels, and short links", () => {
    for (const url of [
      "https://www.instagram.com/reel/Cabc123/",
      "https://instagram.com/p/Cabc123/",
      "https://instagr.am/p/Cabc123/",
    ]) {
      expect(isInstagramUrl(url)).toBe(true);
    }
  });

  test("rejects lookalikes", () => {
    expect(isInstagramUrl("https://instagram.com.evil.example/p/1")).toBe(false);
    expect(isInstagramUrl("https://youtu.be/dQw4w9WgXcQ")).toBe(false);
  });
});

describe("mediaKind", () => {
  test("classifies by extension", () => {
    expect(mediaKind("clip.mp4")).toBe("video");
    expect(mediaKind("clip.WEBM")).toBe("video");
    expect(mediaKind("photo.jpg")).toBe("image");
    expect(mediaKind("photo.webp")).toBe("image");
    expect(mediaKind("audio.mp3")).toBe("audio");
    expect(mediaKind("clip.m4a")).toBe("audio");
    expect(mediaKind("noext")).toBe("document");
  });
});

describe("parseProbe", () => {
  test("maps the metadata fields", () => {
    expect(parseProbe(JSON.stringify(INFO))).toEqual({
      title: "cat tax",
      author: "Budi",
      duration: 42,
    });
  });

  test("falls back to the channel name", () => {
    const parsed = parseProbe(
      JSON.stringify({ title: "x", channel: "Siti", duration: 3 }),
    );
    expect(parsed.author).toBe("Siti");
  });

  test("survives missing fields", () => {
    expect(parseProbe(JSON.stringify({}))).toEqual({
      title: "",
      author: "",
      duration: 0,
    });
  });

  test("refuses a playlist", () => {
    expect(() => parseProbe(JSON.stringify({ _type: "playlist" }))).toThrow(
      /Playlists are not supported/,
    );
  });

  test("reports unreadable output", () => {
    expect(() => parseProbe("not json")).toThrow(/Could not read/);
  });
});

describe("downloadWithYtDlp", () => {
  test("probes first, then downloads at the configured height", async () => {
    const dir = workDir();
    const { run, calls } = runner([ok(JSON.stringify(INFO)), ok()], writes("clip.mp4"));

    const result = await downloadWithYtDlp(VIDEO_URL, {
      runner: run,
      workDir: dir,
      maxHeight: 720,
    });

    expect(calls[0]![0]).toBe("-J");
    expect(calls[0]).toContain(VIDEO_URL);

    const download = calls[1]!;
    expect(download[download.indexOf("-f") + 1]).toContain("height<=720");
    expect(download).toContain("--max-filesize");
    expect(download).toContain("--no-playlist");

    expect(result.title).toBe("cat tax");
    expect(result.author).toBe("Budi");
    expect(result.files).toHaveLength(1);
    expect(result.files[0]!.kind).toBe("video");

    result.cleanup();
    // The scratch directory yt-dlp wrote into is gone; the injected workDir
    // itself belongs to the test and is not the downloader's to remove.
    expect(fs.readdirSync(dir)).toEqual([]);
  });

  test("walks down the quality ladder when a rung is too large", async () => {
    const dir = workDir();
    const { run, calls } = runner(
      [
        ok(JSON.stringify(INFO)),
        fail("ERROR: File is larger than max-filesize"),
        ok(),
      ],
      (args) => {
        // Only the second download attempt produces a file.
        if (calls.filter((call) => call[0] === "-f").length === 2) {
          writes("clip.mp4")(args);
        }
      },
    );

    const result = await downloadWithYtDlp(VIDEO_URL, {
      runner: run,
      workDir: dir,
      maxHeight: 720,
    });

    const downloadCalls = calls.filter((call) => call[0] === "-f");
    expect(downloadCalls).toHaveLength(2);
    expect(downloadCalls[0]![1]).toContain("height<=720");
    expect(downloadCalls[1]![1]).toContain("height<=480");
    expect(result.files).toHaveLength(1);

    result.cleanup();
  });

  test("gives up after the whole ladder fails", async () => {
    const dir = workDir();
    const { run, calls } = runner([
      ok(JSON.stringify(INFO)),
      fail("ERROR: File is larger than max-filesize"),
      fail("ERROR: File is larger than max-filesize"),
      fail("ERROR: File is larger than max-filesize"),
      fail("ERROR: File is larger than max-filesize"),
    ]);

    await expect(
      downloadWithYtDlp(VIDEO_URL, { runner: run, workDir: dir, maxHeight: 720 }),
    ).rejects.toThrow(/larger than WhatsApp allows/);

    // 720, 480, 360, 240 — four rungs, no more.
    expect(calls.filter((call) => call[0] === "-f")).toHaveLength(4);
  });

  test("does not retry a failure that is not about size", async () => {
    const dir = workDir();
    const { run, calls } = runner([
      ok(JSON.stringify(INFO)),
      fail("ERROR: Private video. Sign in if you've been granted access"),
    ]);

    await expect(
      downloadWithYtDlp(VIDEO_URL, { runner: run, workDir: dir }),
    ).rejects.toThrow(/private, age-restricted, or requires login/);

    expect(calls.filter((call) => call[0] === "-f")).toHaveLength(1);
  });

  test("reports a failed probe", async () => {
    const dir = workDir();
    const { run } = runner([fail("ERROR: Unsupported URL: https://x.test")]);

    await expect(
      downloadWithYtDlp(VIDEO_URL, { runner: run, workDir: dir }),
    ).rejects.toThrow(/Unsupported URL/);
  });

  test("rejects a file that exceeds the cap despite max-filesize", async () => {
    const dir = workDir();
    const { run } = runner(
      [ok(JSON.stringify(INFO)), ok()],
      writes("clip.mp4", 32),
    );

    await expect(
      downloadWithYtDlp(VIDEO_URL, {
        runner: run,
        workDir: dir,
        maxBytes: 16,
      }),
    ).rejects.toThrow(/larger than WhatsApp allows/);
  });

  test("ignores partial downloads left behind", async () => {
    const dir = workDir();
    const { run } = runner([ok(JSON.stringify(INFO)), ok()], (args) => {
      writes("clip.mp4.part")(args);
      writes("clip.mp4")(args);
    });

    const result = await downloadWithYtDlp(VIDEO_URL, {
      runner: run,
      workDir: dir,
    });

    expect(result.files.map((file) => file.name)).toEqual(["clip.mp4"]);
    result.cleanup();
  });

  test("keeps every file of a carousel", async () => {
    const dir = workDir();
    const { run } = runner([ok(JSON.stringify(INFO)), ok()], (args) => {
      writes("1.jpg")(args);
      writes("2.jpg")(args);
    });

    const result = await downloadWithYtDlp("https://instagram.com/p/Cabc123/", {
      runner: run,
      workDir: dir,
    });

    expect(result.files.map((file) => file.kind)).toEqual(["image", "image"]);
    result.cleanup();
  });

  test("retries lower when the requested format is unavailable", async () => {
    const dir = workDir();
    const { run, calls } = runner(
      [
        ok(JSON.stringify(INFO)),
        fail("ERROR: Requested format is not available"),
        ok(),
      ],
      (args) => {
        if (calls.filter((call) => call[0] === "-f").length === 2) {
          writes("clip.mp4")(args);
        }
      },
    );

    const result = await downloadWithYtDlp(VIDEO_URL, { runner: run, workDir: dir });

    expect(calls.filter((call) => call[0] === "-f")).toHaveLength(2);
    expect(result.files).toHaveLength(1);
    result.cleanup();
  });

  test("reports a timeout in user terms", async () => {
    const dir = workDir();
    const { run } = runner([
      ok(JSON.stringify(INFO)),
      fail("Timed out after 180000ms", 124),
    ]);

    await expect(
      downloadWithYtDlp(VIDEO_URL, { runner: run, workDir: dir }),
    ).rejects.toThrow(/took too long/);
  });

  test("extracts mp3 in one pass when asked for audio", async () => {
    const dir = workDir();
    const { run, calls } = runner([ok(JSON.stringify(INFO)), ok()], writes("song.mp3"));

    const result = await downloadWithYtDlp(VIDEO_URL, {
      runner: run,
      workDir: dir,
      audioOnly: true,
    });

    expect(calls).toHaveLength(2);
    const download = calls[1]!;
    expect(download).toContain("-x");
    expect(download[download.indexOf("--audio-format") + 1]).toBe("mp3");
    expect(download).not.toContain("-f");
    expect(result.files[0]!.kind).toBe("audio");

    result.cleanup();
  });

  test("defaults the cap to WhatsApp's limit", async () => {
    const dir = workDir();
    const { run, calls } = runner([ok(JSON.stringify(INFO)), ok()], writes("clip.mp4"));

    const result = await downloadWithYtDlp(VIDEO_URL, { runner: run, workDir: dir });
    const download = calls[1]!;
    expect(download[download.indexOf("--max-filesize") + 1]).toBe(
      String(MAX_MEDIA_BYTES),
    );

    result.cleanup();
  });
});

describe("DownloadError", () => {
  test("is a plain Error subclass", () => {
    expect(new DownloadError("x")).toBeInstanceOf(Error);
  });
});

describe("createYtDlpRunner", () => {
  test("prepends the configured argv prefix", async () => {
    const { createYtDlpRunner } = await import("@/lib/ytdlp");
    let spawned: string[] = [];

    // Spawn is faked at the process boundary: a real run would need the binary.
    const original = Bun.spawn;
    Bun.spawn = ((argv: string[]) => {
      spawned = argv;
      return {
        exited: Promise.resolve(0),
        stdout: new Response("").body,
        stderr: new Response("").body,
        kill() {},
      };
    }) as unknown as typeof Bun.spawn;

    try {
      const runner = createYtDlpRunner(["python", "-m", "yt_dlp"]);
      const result = await runner(["--version"], 1000);

      expect(result.exitCode).toBe(0);
      expect(spawned.slice(0, 4)).toEqual([
        "python",
        "-m",
        "yt_dlp",
        "--version",
      ]);
    } finally {
      Bun.spawn = original;
    }
  });

  test("turns a missing program into a failed run, not a throw", async () => {
    const { createYtDlpRunner } = await import("@/lib/ytdlp");
    const runner = createYtDlpRunner(["definitely-not-a-real-binary-xyz"]);

    const result = await runner(["--version"], 1000);

    expect(result.exitCode).toBe(127);
    expect(result.stderr).toContain("could not run");
  });

  test("kills a process that outlives the timeout", async () => {
    const { createYtDlpRunner } = await import("@/lib/ytdlp");
    let killed = false;

    const original = Bun.spawn;
    Bun.spawn = (() => {
      let settle: (code: number) => void = () => {};
      const exited = new Promise<number>((resolve) => {
        settle = resolve;
      });
      return {
        exited,
        stdout: new Response("").body,
        stderr: new Response("").body,
        kill() {
          killed = true;
          settle(143);
        },
      };
    }) as unknown as typeof Bun.spawn;

    try {
      const runner = createYtDlpRunner(["python"]);
      const result = await runner([], 20);

      expect(killed).toBe(true);
      expect(result.exitCode).toBe(124);
      expect(result.stderr).toContain("Timed out");
    } finally {
      Bun.spawn = original;
    }
  });
});
