import type { Actor } from "@/lib/auth";

export const ownerActor: Actor = {
  role: "owner",
  name: "서비스 오너",
  memberId: null,
  credentialId: null,
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
};
