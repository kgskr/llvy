import type { Actor } from "@/lib/auth";

export const ownerActor: Actor = {
  role: "owner",
  name: "서비스 오너",
  accountId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  discordUserId: "111111111111111111",
  sessionId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  adminGrantId: null,
};
export const ownerSession = {
  ...ownerActor,
  token: "session-token",
  issuedAt: Date.now(),
};
export const ownerUploadFields = {
  actorRole: "owner",
  actorName: "서비스 오너",
  actorMemberId: null,
  actorCredentialId: null,
  actorAccountId: ownerActor.accountId,
  actorDiscordUserId: ownerActor.discordUserId,
  actorAdminGrantId: null,
};
