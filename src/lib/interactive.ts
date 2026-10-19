import { randomBytes } from "node:crypto";
import {
  generateMessageID,
  prepareWAMessageMedia,
  proto,
  type BinaryNode,
  type WAMediaUpload,
  type WASocket,
} from "@whiskeysockets/baileys";

/**
 * Native-flow button payloads. WhatsApp renders these inside an
 * `interactiveMessage`; the `params` object is serialised to `buttonParamsJson`.
 */
export type InteractiveButton =
  | { name: "quick_reply"; params: { display_text: string; id: string } }
  | { name: "cta_url"; params: { display_text: string; url: string } }
  | {
      name: "single_select";
      params: {
        title: string;
        sections: {
          title: string;
          rows: { title: string; id: string; description?: string }[];
        }[];
      };
    };

export interface InteractiveOptions {
  body: string;
  footer?: string;
  header?: {
    title?: string;
    subtitle?: string;
    image?: WAMediaUpload;
    video?: WAMediaUpload;
    jpegThumbnail?: Uint8Array;
  };
  buttons: InteractiveButton[];
  mentions?: string[];
}

/** Wraps the header media into the shape `interactiveMessage.header` expects. */
async function buildHeader(
  sock: WASocket,
  header: NonNullable<InteractiveOptions["header"]>,
): Promise<proto.Message.InteractiveMessage.IHeader> {
  const built: proto.Message.InteractiveMessage.IHeader = {
    title: header.title,
    subtitle: header.subtitle,
  };

  if (header.image) {
    const media = await prepareWAMessageMedia(
      { image: header.image },
      { upload: sock.waUploadToServer },
    );
    if (media.imageMessage) built.imageMessage = media.imageMessage;
    built.hasMediaAttachment = true;
  } else if (header.video) {
    const media = await prepareWAMessageMedia(
      { video: header.video },
      { upload: sock.waUploadToServer },
    );
    if (media.videoMessage) built.videoMessage = media.videoMessage;
    built.hasMediaAttachment = true;
  } else if (header.jpegThumbnail) {
    built.jpegThumbnail = header.jpegThumbnail;
    built.hasMediaAttachment = true;
  }

  return built;
}

/**
 * Builds the `<biz>` stanza node that WhatsApp requires alongside a native-flow
 * message. The shape is not cosmetic: a bare `<biz><interactive/></biz>` is
 * answered with `<ack error="479">` and never delivered, and the legacy
 * `<biz><buttons/></biz>` shape is answered with `<ack error="405">`.
 *
 * The accepted shape carries attributes on `<biz>`, a `<native_flow>` child
 * naming the flow, and a `<quality_control>` sibling with a fresh decision id.
 * Values mirror observed official-client traffic; their individual semantics
 * are undocumented.
 */
function buildBizNode(): BinaryNode {
  return {
    tag: "biz",
    attrs: {
      actual_actors: "2",
      host_storage: "2",
      privacy_mode_ts: String(Math.floor(Date.now() / 1000)),
    },
    content: [
      {
        tag: "interactive",
        attrs: { type: "native_flow", v: "1" },
        content: [{ tag: "native_flow", attrs: { v: "9", name: "mixed" } }],
      },
      {
        tag: "quality_control",
        attrs: {
          decision_id: randomBytes(20).toString("hex"),
          source_type: "third_party",
        },
        content: [{ tag: "decision_source", attrs: { value: "df" } }],
      },
    ],
  };
}

/**
 * Sends an interactive (button) message.
 *
 * WhatsApp only renders native-flow buttons when the `interactiveMessage` is
 * nested in `viewOnceMessage` and the stanza carries the full `biz` node —
 * `sendMessage` has no interactive content type, so this goes straight through
 * `relayMessage`.
 */
export async function sendInteractive(
  sock: WASocket,
  jid: string,
  options: InteractiveOptions,
): Promise<string> {
  const interactive: proto.Message.IInteractiveMessage = {
    body: { text: options.body },
    nativeFlowMessage: {
      buttons: options.buttons.map((button) => ({
        name: button.name,
        buttonParamsJson: JSON.stringify(button.params),
      })),
    },
  };

  if (options.footer) interactive.footer = { text: options.footer };
  if (options.mentions?.length) {
    interactive.contextInfo = { mentionedJid: options.mentions };
  }
  if (options.header) {
    interactive.header = await buildHeader(sock, options.header);
  }

  return sock.relayMessage(
    jid,
    {
      viewOnceMessage: {
        message: {
          // A view-once carrier without a 32-byte secret makes clients show
          // "message could not be loaded" instead of the buttons.
          messageContextInfo: { messageSecret: randomBytes(32) },
          interactiveMessage:
            proto.Message.InteractiveMessage.create(interactive),
        },
      },
    },
    {
      messageId: generateMessageID(),
      additionalNodes: [buildBizNode()],
    },
  );
}
