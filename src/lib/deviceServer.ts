import os from "node:os";
import type { ClientHints } from "@/lib/deviceInfo";

/** Best guess at an address a phone on the same Wi-Fi can open. */
export function lanUrl(port: number): string {
  const address = Object.values(os.networkInterfaces())
    .flat()
    .find((iface) => iface && iface.family === "IPv4" && !iface.internal);

  return `http://${address?.address ?? "127.0.0.1"}:${port}`;
}

const PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Device info</title>
<style>
  body { font: 16px system-ui, sans-serif; margin: 0; display: grid; place-items: center;
         min-height: 100vh; background: #f5f5f5; color: #111; }
  main { background: #fff; padding: 24px; border-radius: 12px; max-width: 22rem; text-align: center; }
</style>
</head>
<body>
<main id="status">Reading your device…</main>
<script>
const status = document.getElementById("status");
const uaData = navigator.userAgentData;
fetch(location.pathname, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    ua: navigator.userAgent,
    platform: uaData?.platform ?? navigator.platform,
    brands: uaData?.brands?.map((b) => JSON.stringify(b.brand)).join(",") ?? "",
  }),
})
  .then((res) => res.json())
  .then((data) => {
    status.textContent = data.ok
      ? "Thanks! Open WhatsApp again — .userinfo will show this device."
      : "This link has expired or was already used.";
  })
  .catch(() => { status.textContent = "Could not reach the bot."; });
</script>
</body>
</html>`;

export interface DeviceServer {
  stop(): void;
}

/**
 * Tiny HTTP server for the one-time device link. Only the token routes do
 * anything; everything else is a 404.
 */
export function startDeviceServer(
  port: number,
  onClaim: (token: string, hints: ClientHints) => string | null,
): DeviceServer {
  const server = Bun.serve({
    port,
    hostname: "0.0.0.0",
    async fetch(req) {
      const { pathname } = new URL(req.url);
      const match = pathname.match(/^\/device\/([A-Za-z0-9]+)$/);
      if (!match) return new Response("Not found", { status: 404 });

      const token = match[1]!;
      if (req.method === "GET") {
        return new Response(PAGE, {
          headers: { "content-type": "text/html; charset=utf-8" },
        });
      }
      if (req.method !== "POST") return new Response("Not found", { status: 404 });

      const hints = (await req.json().catch(() => ({}))) as ClientHints;
      const jid = onClaim(token, hints);
      return Response.json({ ok: Boolean(jid) }, { status: jid ? 200 : 410 });
    },
  });

  return { stop: () => server.stop(true) };
}
