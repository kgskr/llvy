import "server-only";

import type { SessionRole } from "@/lib/auth";

/** Preserve member names for all roles; omit birth years for viewers. */
export function projectMember<
  T extends { name: string; birthYear?: number | null },
>(
  member: T,
  role: SessionRole,
): Omit<T, "birthYear"> & { birthYear?: number | null } {
  const { birthYear, ...rest } = member;
  return role === "viewer" ? rest : { ...rest, birthYear };
}
