export function canManage(role: string): boolean {
  return role === "admin" || role === "owner";
}

export function canUpload(role: string): boolean {
  return role === "uploader" || canManage(role);
}

export const ROLE_LABELS = {
  viewer: "일반 사용자",
  uploader: "업로더",
  admin: "관리자",
  owner: "서비스 오너",
} as const;
