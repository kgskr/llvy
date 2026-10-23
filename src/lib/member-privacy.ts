import "server-only";

import type { SessionRole } from "@/lib/auth";

/** Preserve member names for all roles; include birth years on member-read surfaces. */
export function projectMember<
  T extends { name: string; birthYear?: number | null },
>(
  member: T,
  role: SessionRole,
): Omit<T, "birthYear"> & { birthYear?: number | null } {
  const { birthYear, ...rest } = member;
  return ["viewer", "uploader", "admin", "owner"].includes(role)
    ? { ...rest, birthYear }
    : rest;
}
