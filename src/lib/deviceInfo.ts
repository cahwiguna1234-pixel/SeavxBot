export interface ClientHints {
  ua: string;
  /** `navigator.userAgentData.platform` or `navigator.platform`. */
  platform?: string;
  /** `navigator.userAgentData.brands`, already flattened to a string. */
  brands?: string;
}

export interface DeviceInfo {
  device: string;
  os: string;
}

const BROWSERS: [RegExp, string][] = [
  // In-app webviews advertise the host app after the engine, so they come first.
  [/WhatsApp\//i, "WhatsApp"],
  [/Instagram/i, "Instagram"],
  [/FBAN|FBAV|FB_IAB/i, "Facebook"],
  [/EdgA?\/|Edg\//i, "Edge"],
  [/SamsungBrowser\//i, "Samsung Internet"],
  [/OPR\/|Opera/i, "Opera"],
  [/Firefox\/|FxiOS/i, "Firefox"],
  [/Chrome\/|CriOS/i, "Chrome"],
  [/Safari\//i, "Safari"],
];

const SYSTEMS: [RegExp, (match: RegExpMatchArray) => string][] = [
  [/Android\s*([\d.]+)/i, (m) => `Android ${m[1]}`],
  [/iPhone.*?OS\s*([\d_]+)/i, (m) => `iOS ${m[1]!.replaceAll("_", ".")}`],
  [/iPad.*?OS\s*([\d_]+)/i, (m) => `iPadOS ${m[1]!.replaceAll("_", ".")}`],
  [/Windows NT 10\.0/i, () => "Windows 10/11"],
  [/Windows NT ([\d.]+)/i, (m) => `Windows NT ${m[1]}`],
  [/Mac OS X\s*([\d_.]+)/i, (m) => `macOS ${m[1]!.replaceAll("_", ".")}`],
  [/CrOS/i, () => "ChromeOS"],
  [/Linux/i, () => "Linux"],
];

/**
 * The page is asked to report both the user agent and the client hints, because
 * Chrome freezes the OS name inside the UA string and only hints reveal it.
 */
export function describeClient(client: ClientHints): DeviceInfo {
  const ua = client.ua || "";
  const hint = client.platform || "";

  const os =
    SYSTEMS.map(([pattern, label]) => {
      const match = ua.match(pattern);
      return match ? label(match) : "";
    }).find(Boolean) || hint || "unknown";

  const brand = client.brands || "";
  const device =
    (brand.match(/"(Google Chrome|Microsoft Edge|Opera|Samsung Internet|Firefox)"/)?.[1]) ||
    BROWSERS.find(([pattern]) => pattern.test(ua))?.[1] ||
    "unknown browser";

  return { device, os };
}

const LINK_TTL_MS = 15 * 60 * 1000;

interface PendingLink {
  jid: string;
  expiresAt: number;
}

// In memory on purpose: a link only has to survive the minutes between the
// command and the user opening it on their phone.
const pending = new Map<string, PendingLink>();

export function createDeviceLink(
  jid: string,
  baseUrl: string,
  now: number = Date.now(),
): string {
  const token = crypto.randomUUID().replaceAll("-", "");
  pending.set(token, { jid, expiresAt: now + LINK_TTL_MS });

  return `${baseUrl.replace(/\/+$/, "")}/device/${token}`;
}

/** Single use: the token is dropped as soon as it is claimed. */
export function claimDeviceLink(
  token: string,
  now: number = Date.now(),
): string | null {
  const link = pending.get(token);
  pending.delete(token);

  return link && link.expiresAt > now ? link.jid : null;
}
