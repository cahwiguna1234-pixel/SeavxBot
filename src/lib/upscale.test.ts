import { describe, expect, test } from "bun:test";
import { upscaleBuffer } from "@/lib/upscale";

// A real data: URL is fetched by the global fetch, which is not stubbed here;
// only the input sniffing is exercised cheaply by checking the failure path.
describe("upscaleBuffer", () => {
  test("returns null instead of throwing when the service is unreachable", async () => {
    const saved = globalThis.fetch;
    globalThis.fetch = (() =>
      Promise.reject(new Error("offline"))) as unknown as typeof fetch;
    try {
      expect(await upscaleBuffer(Buffer.from("not an image"))).toBeNull();
    } finally {
      globalThis.fetch = saved;
    }
  });
});
