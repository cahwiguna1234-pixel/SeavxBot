import { describe, expect, test } from "bun:test";
import { RemoveBgError, removeBackground } from "@/lib/rembg";

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);
const CUTOUT = Buffer.from("cutout");

function fetcher(
  handler: (url: string, body: FormData) => Response | null,
): { run: typeof fetch; calls: string[] } {
  const calls: string[] = [];
  const run = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    calls.push(url);
    const res = handler(url, init?.body as FormData);
    if (!res) throw new Error("offline");
    return res;
  }) as typeof fetch;
  return { run, calls };
}

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status });

const ok = (body: Buffer): Response => new Response(body, { status: 200 });

describe("removeBackground", () => {
  test("uploads, removes, and returns the cut-out PNG", async () => {
    const { run, calls } = fetcher((url) =>
      url.endsWith("/upload")
        ? json({ server_filename: "server.png" })
        : ok(CUTOUT),
    );

    const result = await removeBackground(PNG, {
      fetcher: run,
      hosts: ["api4g"],
    });

    expect(result.toString()).toBe("cutout");
    expect(calls).toEqual([
      "https://api4g.iloveimg.com/v1/upload",
      "https://api4g.iloveimg.com/v1/removebackground",
    ]);
  });

  test("falls through to the next worker when one fails", async () => {
    const { run, calls } = fetcher((url) => {
      if (url.includes("api4g")) return json({ error: "ServerError" }, 500);
      return url.endsWith("/upload")
        ? json({ server_filename: "server.png" })
        : ok(CUTOUT);
    });

    const result = await removeBackground(PNG, {
      fetcher: run,
      hosts: ["api4g", "api5g"],
    });

    expect(result.toString()).toBe("cutout");
    expect(calls).toHaveLength(3);
    expect(calls[1]).toContain("api5g");
  });

  test("reports a user-facing error when every worker fails", async () => {
    const { run } = fetcher(() => null);

    const err = await removeBackground(PNG, {
      fetcher: run,
      hosts: ["api4g"],
    }).catch((e) => e);

    expect(err).toBeInstanceOf(RemoveBgError);
    expect(err.message).toBe(
      "The background remover could not process that photo. Try again later.",
    );
  });
});
