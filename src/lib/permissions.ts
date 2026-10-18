import {
  type WASocket,
  type GroupMetadata,
  jidNormalizedUser,
  areJidsSameUser,
} from "@whiskeysockets/baileys";

export interface ResolvedPermissions {
  isOwner: boolean;
  isAdmin: boolean;
  isSuperAdmin: boolean;
  isBotAdmin: boolean;
  groupMetadata?: GroupMetadata;
}

export interface ResolvePermissionsParams {
  sock: WASocket;
  chatJid: string;
  senderJid: string;
  senderLid: string;
  senderPn: string;
  fromMe: boolean;
  isGroup: boolean;
  ownerNumbers?: string[];
}

export async function resolvePermissions({
  sock,
  chatJid,
  senderJid,
  senderLid,
  senderPn,
  fromMe,
  isGroup,
  ownerNumbers = [],
}: ResolvePermissionsParams): Promise<ResolvedPermissions> {
  const senderNumber = senderPn.split("@")[0]?.split(":")[0] || "";

  const botJid = sock.user?.id ? jidNormalizedUser(sock.user.id) : "";
  const botLid = sock.user?.lid ? jidNormalizedUser(sock.user.lid) : "";

  const ownerList = ownerNumbers.map((num) => num.replace(/\D/g, ""));
  const isOwner = Boolean(
    fromMe ||
      (senderNumber && ownerList.includes(senderNumber)) ||
      (botJid && areJidsSameUser(senderJid, botJid)),
  );

  let isAdmin = false;
  let isSuperAdmin = false;
  let isBotAdmin = false;
  let groupMetadata: GroupMetadata | undefined;

  if (isGroup) {
    try {
      groupMetadata = await sock.groupMetadata(chatJid);
      const participants = groupMetadata.participants || [];

      for (const p of participants) {
        const participantJid = p.id;
        const participantPn =
          (p as { pn?: string; jid?: string }).pn || participantJid;

        const isSenderMatch =
          areJidsSameUser(participantJid, senderJid) ||
          areJidsSameUser(participantJid, senderLid) ||
          areJidsSameUser(participantPn, senderPn);

        if (isSenderMatch) {
          if (p.admin === "admin") isAdmin = true;
          if (p.admin === "superadmin") {
            isAdmin = true;
            isSuperAdmin = true;
          }
        }

        const isBotMatch =
          (botJid &&
            (areJidsSameUser(participantJid, botJid) ||
              areJidsSameUser(participantPn, botJid))) ||
          (botLid &&
            (areJidsSameUser(participantJid, botLid) ||
              areJidsSameUser(participantPn, botLid)));

        if (isBotMatch && (p.admin === "admin" || p.admin === "superadmin")) {
          isBotAdmin = true;
        }
      }
    } catch {
      // Non-admin or metadata fetch failure
    }
  }

  return {
    isOwner,
    isAdmin,
    isSuperAdmin,
    isBotAdmin,
    groupMetadata,
  };
}
