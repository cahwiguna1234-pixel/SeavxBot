import { describe, expect, test } from "bun:test";
import {
  claimDeviceLink,
  createDeviceLink,
  describeClient,
} from "@/lib/deviceInfo";

const IPHONE_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";
const ANDROID_UA =
  "Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36";
const WINDOWS_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 Edg/124.0.0.0";

describe("describeClient", () => {
  test("an iPhone in Safari", () => {
    expect(describeClient({ ua: IPHONE_UA })).toEqual({
      device: "Safari",
      os: "iOS 17.5",
    });
  });

  test("an Android phone in Chrome", () => {
    expect(describeClient({ ua: ANDROID_UA })).toEqual({
      device: "Chrome",
      os: "Android 14",
    });
  });

  test("the WhatsApp in-app browser wins over the engine", () => {
    expect(
      describeClient({ ua: `${ANDROID_UA} WhatsApp/2.24.10.79 A` }).device,
    ).toBe("WhatsApp");
  });

  test("client hints reveal a brand the UA does not carry", () => {
    expect(
      describeClient({
        ua: WINDOWS_UA,
        platform: "Windows",
        brands: '""Not=A;Brand"","Microsoft Edge"',
      }),
    ).toEqual({ device: "Microsoft Edge", os: "Windows 10/11" });
  });

  test("an empty client does not throw", () => {
    expect(describeClient({ ua: "" })).toEqual({
      device: "unknown browser",
      os: "unknown",
    });
  });
});

describe("device links", () => {
  test("a link is scoped to the sender and claimed once", () => {
    const url = createDeviceLink("6281@s.whatsapp.net", "http://1.2.3.4:3000/");
    const token = url.split("/").pop()!;

    expect(url.startsWith("http://1.2.3.4:3000/device/")).toBe(true);
    expect(claimDeviceLink(token)).toBe("6281@s.whatsapp.net");
    expect(claimDeviceLink(token)).toBeNull();
  });

  test("an expired link is refused", () => {
    const now = 1_700_000_000_000;
    const url = createDeviceLink("6281@s.whatsapp.net", "http://x", now);
    const token = url.split("/").pop()!;

    expect(claimDeviceLink(token, now + 16 * 60 * 1000)).toBeNull();
  });
});
