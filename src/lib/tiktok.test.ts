import { describe, expect, test } from "bun:test";
import {
  TikTokError,
  downloadTikTokMedia,
  extractTikTokUrl,
  isTikTokUrl,
  parseTikTokPayload,
  resolveTikTok,
} from "@/lib/tiktok";
import { MAX_MEDIA_BYTES } from "@/lib/media";

const VIDEO_PAYLOAD = {
  code: 0,
  msg: "success",
  data: {
    id: "7311111111111111111",
    title: "cat tax",
    duration: 17,
    play: "https://cdn.example.com/play.mp4",
    hdplay: "https://cdn.example.com/hd.mp4",
    music: "https://cdn.example.com/music.mp3",
    author: { nickname: "Budi", unique_id: "budi" },
  },
};

const SLIDESHOW_PAYLOAD = {
  code: 0,
  data: {
    id: "7322222222222222222",
    title: "photos",
    duration: 0,
    play: "https://cdn.example.com/slide.mp4",
    images: ["https://cdn.example.com/1.jpg", "https://cdn.example.com/2.jpg"],
    author: { nickname: "Siti", unique_id: "siti" },
  },
};

function response(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
    ...init,
  });
}

describe("isTikTokUrl", () => {
  test("accepts every share host", () => {
    for (const url of [
      "https://www.tiktok.com/@budi/video/7311111111111111111",
      "https://vm.tiktok.com/ZMabc123/",
      "https://vt.tiktok.com/ZSabc123/",
      "https://m.tiktok.com/v/7311111111111111111.html",
    ]) {
      expect(isTikTokUrl(url)).toBe(true);
    }
  });

  test("rejects lookalike hosts and non-URLs", () => {
    for (const url of [
      "https://tiktok.com.evil.example/video/1",
      "https://nottiktok.com/video/1",
      "https://instagram.com/reel/1",
      "not a url",
    ]) {
      expect(isTikTokUrl(url)).toBe(false);
    }
  });
});

describe("extractTikTokUrl", () => {
  test("finds the link inside surrounding chatter", () => {
    expect(
      extractTikTokUrl("look at this https://vm.tiktok.com/ZMabc123/ lol"),
    ).toBe("https://vm.tiktok.com/ZMabc123/");
  });

  test("skips a non-TikTok link that appears first", () => {
    expect(
      extractTikTokUrl(
        "https://youtube.com/watch?v=1 and https://vt.tiktok.com/ZS1/",
      ),
    ).toBe("https://vt.tiktok.com/ZS1/");
  });

  test("returns null when there is no link", () => {
    expect(extractTikTokUrl("no links here")).toBeNull();
  });
});

describe("parseTikTokPayload", () => {
  test("prefers the HD video and maps the author", () => {
    expect(parseTikTokPayload(VIDEO_PAYLOAD)).toEqual({
      id: "7311111111111111111",
      title: "cat tax",
      author: { nickname: "Budi", username: "budi" },
      duration: 17,
      video: "https://cdn.example.com/hd.mp4",
      images: [],
      music: "https://cdn.example.com/music.mp3",
    });
  });

  test("falls back to the standard-quality track", () => {
    const payload = {
      code: 0,
      data: { ...VIDEO_PAYLOAD.data, hdplay: undefined },
    };
    expect(parseTikTokPayload(payload).video).toBe(
      "https://cdn.example.com/play.mp4",
    );
  });

  test("keeps slideshow photos and drops the companion track", () => {
    const media = parseTikTokPayload(SLIDESHOW_PAYLOAD);
    expect(media.images).toHaveLength(2);
    expect(media.video).toBeUndefined();
  });

  test("surfaces the resolver's own error message", () => {
    expect(() =>
      parseTikTokPayload({ code: -1, msg: "Url parsing is failed" }),
    ).toThrow(new TikTokError("Url parsing is failed"));
  });

  test("explains a private or deleted post", () => {
    expect(() => parseTikTokPayload({ code: 0, msg: "success" })).toThrow(
      /private or deleted/,
    );
  });

  test("rejects a post with neither video nor photos", () => {
    expect(() =>
      parseTikTokPayload({ code: 0, data: { id: "1", title: "" } }),
    ).toThrow(/no downloadable/);
  });

  test("ignores non-string entries in the photo list", () => {
    const media = parseTikTokPayload({
      code: 0,
      data: { images: ["https://cdn.example.com/1.jpg", null, 42] },
    });
    expect(media.images).toEqual(["https://cdn.example.com/1.jpg"]);
  });
});

describe("resolveTikTok", () => {
  test("requests the resolver with the encoded share link", async () => {
    let seen = "";
    const fetcher = (async (input: string | URL | Request) => {
      seen = String(input);
      return response(VIDEO_PAYLOAD);
    }) as unknown as typeof fetch;

    const media = await resolveTikTok("https://vm.tiktok.com/ZMabc123/", fetcher);

    expect(media.id).toBe("7311111111111111111");
    expect(seen).toContain(
      encodeURIComponent("https://vm.tiktok.com/ZMabc123/"),
    );
  });

  test("refuses a link that is not TikTok before any request", async () => {
    let called = false;
    const fetcher = (async () => {
      called = true;
      return response(VIDEO_PAYLOAD);
    }) as unknown as typeof fetch;

    await expect(
      resolveTikTok("https://instagram.com/reel/1", fetcher),
    ).rejects.toThrow(/not a TikTok link/);
    expect(called).toBe(false);
  });

  test("reports an HTTP failure from the resolver", async () => {
    const fetcher = (async () =>
      new Response("nope", { status: 503 })) as unknown as typeof fetch;

    await expect(
      resolveTikTok("https://vm.tiktok.com/ZMabc123/", fetcher),
    ).rejects.toThrow(/503/);
  });
});

describe("downloadTikTokMedia", () => {
  test("returns the media bytes", async () => {
    const fetcher = (async () =>
      new Response(new Uint8Array([1, 2, 3]))) as unknown as typeof fetch;

    const buffer = await downloadTikTokMedia(
      "https://cdn.example.com/hd.mp4",
      fetcher,
    );
    expect([...buffer]).toEqual([1, 2, 3]);
  });

  test("rejects a declared size above the limit without reading it", async () => {
    const fetcher = (async () =>
      new Response(new Uint8Array([1]), {
        headers: { "content-length": String(MAX_MEDIA_BYTES + 1) },
      })) as unknown as typeof fetch;

    await expect(
      downloadTikTokMedia("https://cdn.example.com/hd.mp4", fetcher),
    ).rejects.toThrow(/larger than WhatsApp allows/);
  });

  test("rejects an oversized body when the size was not declared", async () => {
    const fetcher = (async () =>
      new Response(new Uint8Array(64))) as unknown as typeof fetch;

    await expect(
      downloadTikTokMedia("https://cdn.example.com/hd.mp4", fetcher, 10),
    ).rejects.toThrow(/larger than WhatsApp allows/);
  });

  test("reports an HTTP failure from the CDN", async () => {
    const fetcher = (async () =>
      new Response("gone", { status: 404 })) as unknown as typeof fetch;

    await expect(
      downloadTikTokMedia("https://cdn.example.com/hd.mp4", fetcher),
    ).rejects.toThrow(/404/);
  });
});
