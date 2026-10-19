import type { proto } from "@whiskeysockets/baileys";

export function unwrapMessageContent(
  msgContent: proto.IMessage | null | undefined,
): proto.IMessage | undefined {
  if (!msgContent) return undefined;
  let content: proto.IMessage | undefined = msgContent;

  if (content.ephemeralMessage?.message) {
    content = content.ephemeralMessage.message;
  }
  if (content.viewOnceMessage?.message) {
    content = content.viewOnceMessage.message;
  }
  if (content.viewOnceMessageV2?.message) {
    content = content.viewOnceMessageV2.message;
  }

  return content;
}

export function extractMessageBody(
  content: proto.IMessage | undefined,
): string {
  if (!content) return "";

  // A tapped native-flow button arrives as paramsJson; the "id" field carries
  // whatever the button declared, usually the command it should trigger.
  const flowParams =
    content.interactiveResponseMessage?.nativeFlowResponseMessage?.paramsJson;
  if (flowParams) {
    try {
      const parsed = JSON.parse(flowParams) as { id?: unknown };
      if (typeof parsed.id === "string") return parsed.id;
    } catch {
      // Malformed payloads fall through to the regular body extraction.
    }
  }

  return (
    content.conversation ||
    content.extendedTextMessage?.text ||
    content.imageMessage?.caption ||
    content.videoMessage?.caption ||
    content.documentMessage?.caption ||
    content.templateButtonReplyMessage?.selectedId ||
    content.buttonsResponseMessage?.selectedButtonId ||
    content.listResponseMessage?.singleSelectReply?.selectedRowId ||
    ""
  );
}

export interface ExtractedCommand {
  prefix: string;
  command: string;
  args: string[];
  text: string;
  isCmd: boolean;
}

export function extractCommand(
  body: string,
  prefixes: string[] = ["!", ".", "#", "/"],
): ExtractedCommand {
  const trimmed = body.trim();
  const prefix = prefixes.find((p) => trimmed.startsWith(p)) || "";
  const isCmd = Boolean(prefix);

  const rawCmd = isCmd ? trimmed.slice(prefix.length).trim() : "";
  const [command = "", ...args] = rawCmd ? rawCmd.split(/\s+/) : [];

  return {
    prefix,
    command: command.toLowerCase(),
    args,
    text: args.join(" "),
    isCmd,
  };
}
