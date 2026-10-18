import {
  makeWASocket,
  useMultiFileAuthState,
  makeCacheableSignalKeyStore,
  DisconnectReason,
  fetchLatestBaileysVersion,
  type WASocket,
  type CacheStore,
} from "@whiskeysockets/baileys";
import { Boom } from "@hapi/boom";
import NodeCache from "@cacheable/node-cache";
import pino from "pino";
import QRCode from "qrcode";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { parseMessage } from "@/lib/parseMessage";
import { logToFile } from "@/lib/logger";
import { botConfig } from "@/lib/config";
import { loadCommands, getCommand } from "@/lib/commandLoader";
import type {
  AnyMessageContent,
  MiscMessageGenerationOptions,
} from "@whiskeysockets/baileys";

const logger = pino({ level: botConfig.logging.level || "warn" });
const msgRetryCounterCache = new NodeCache({
  stdTTL: 5 * 60,
  useClones: false,
}) as unknown as CacheStore;

async function startBot(): Promise<void> {
  await loadCommands();

  const { state, saveCreds } = await useMultiFileAuthState(
    botConfig.auth.dir || "auth_info",
  );
  const { version, isLatest } = await fetchLatestBaileysVersion();
  console.log(`Using WA v${version.join(".")}, isLatest: ${isLatest}`);

  const isRegistered = Boolean(state.creds.registered || state.creds.me?.id);
  let authChoice =
    botConfig.auth.default_method === "pairing"
      ? "1"
      : botConfig.auth.default_method === "qr"
        ? "2"
        : "";
  let phoneNumber = botConfig.auth.phone_number?.replace(/\D/g, "") || "";

  if (!isRegistered && !authChoice) {
    const rl = readline.createInterface({ input, output });
    try {
      console.log("\nChoose authentication method:");
      console.log("1. Pairing Code");
      console.log("2. QR Code");
      authChoice = (await rl.question("Select (1 or 2): ")).trim();

      if (authChoice === "1" && !phoneNumber) {
        const raw = await rl.question("Phone number (e.g. 628xxx): ");
        phoneNumber = raw.replace(/\D/g, "");
      }
    } finally {
      rl.close();
    }
  } else if (!isRegistered && authChoice === "1" && !phoneNumber) {
    const rl = readline.createInterface({ input, output });
    try {
      const raw = await rl.question("Phone number (e.g. 628xxx): ");
      phoneNumber = raw.replace(/\D/g, "");
    } finally {
      rl.close();
    }
  }

  const sock: WASocket = makeWASocket({
    version,
    logger,
    auth: {
      creds: state.creds,
      keys: makeCacheableSignalKeyStore(state.keys, logger),
    },
    msgRetryCounterCache,
    generateHighQualityLinkPreview: true,
  });

  if (!isRegistered && authChoice === "1" && phoneNumber) {
    setTimeout(async () => {
      try {
        const code = await sock.requestPairingCode(phoneNumber);
        console.log(`\nYour Pairing Code: ${code}\n`);
      } catch (err) {
        console.error("Failed to request pairing code:", err);
      }
    }, 3000);
  }

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on(
    "connection.update",
    async ({ connection, lastDisconnect, qr: QR }) => {
      if (QR && !isRegistered && authChoice !== "1") {
        console.log("\nScan this QR code with WhatsApp:\n");
        try {
          const QRString = await QRCode.toString(QR, {
            type: "terminal",
            small: true,
            margin: 0,
            errorCorrectionLevel: "L",
          });
          console.log(QRString);
        } catch (err) {
          console.error("Failed to render terminal QR:", err);
        }
      }

      if (connection === "close") {
        const statusCode = (lastDisconnect?.error as Boom)?.output?.statusCode;
        const shouldReconnect =
          statusCode !== DisconnectReason.loggedOut &&
          statusCode !== DisconnectReason.forbidden;

        console.log(
          `Connection closed (${statusCode}). Reconnecting: ${shouldReconnect}`,
        );

        if (shouldReconnect) {
          startBot();
        } else {
          console.log(
            "Session terminated. Remove auth_info to re-authenticate.",
          );
        }
      } else if (connection === "open") {
        console.log("Connected to WhatsApp successfully!");
      }
    },
  );

  sock.ev.on("messages.upsert", async ({ messages, type }) => {
    if (type !== "notify") return;

    for (const raw of messages) {
      logToFile("RAW_UPSERT", raw);

      const msg = await parseMessage(sock, raw, {
        prefixes: botConfig.prefixes,
        ownerNumbers: botConfig.owners,
      });
      if (!msg) continue;

      logToFile("PARSED_MSG", msg);

      if (msg.fromMe) continue;

      if (botConfig.features?.read_message) {
        await sock.readMessages([msg.key]);
      }

      const line = `[${msg.chatJid}] ${msg.pushName} (${msg.type}) [Cmd: ${msg.isCmd ? msg.command : "-"}] [Owner: ${msg.isOwner}, Admin: ${msg.isAdmin}, BotAdmin: ${msg.isBotAdmin}]: ${msg.body}`;
      console.log(line);

      if (msg.isCmd) {
        const cmd = getCommand(msg.command);
        if (cmd) {
          const msgs = botConfig.messages;

          if (cmd.ownerOnly && !msg.isOwner) {
            await sock.sendMessage(
              msg.chatJid,
              { text: msgs?.owner_only || "🚩 Owner access required." },
              { quoted: msg.raw },
            );
            continue;
          }
          if (cmd.groupOnly && !msg.isGroup) {
            await sock.sendMessage(
              msg.chatJid,
              { text: msgs?.group_only || "🚩 Group chat required." },
              { quoted: msg.raw },
            );
            continue;
          }
          if (cmd.adminOnly && !msg.isAdmin && !msg.isOwner) {
            await sock.sendMessage(
              msg.chatJid,
              { text: msgs?.admin_only || "🚩 Group admin required." },
              { quoted: msg.raw },
            );
            continue;
          }
          if (cmd.botAdminOnly && !msg.isBotAdmin) {
            await sock.sendMessage(
              msg.chatJid,
              {
                text: msgs?.bot_admin_only || "🚩 Bot admin privileges required.",
              },
              { quoted: msg.raw },
            );
            continue;
          }

          const reply = async (
            content: string | AnyMessageContent,
            opts?: MiscMessageGenerationOptions,
          ) => {
            const payload =
              typeof content === "string" ? { text: content } : content;
            const res = await sock.sendMessage(msg.chatJid, payload, {
              quoted: msg.raw,
              ...opts,
            });
            logToFile("SENT_REPLY", res);
            return res;
          };

          try {
            await cmd.run({ sock, msg, reply });
          } catch (err) {
            console.error(`Error executing command [${cmd.name}]:`, err);
            logToFile("CMD_ERROR", { cmd: cmd.name, error: String(err) });
            await reply(msgs?.error || "🚩 Command execution failed.");
          }
        }
      }
    }
  });
}

startBot();
