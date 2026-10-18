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

export function extractMessageBody(content: proto.IMessage | undefined): string {
  if (!content) return "";
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
