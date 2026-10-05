import "server-only";

import type { SessionRole } from "@/lib/auth";

export function maskMemberName(name: string): string {
  const letters = [
    ...new Intl.Segmenter("ko", { granularity: "grapheme" }).segment(
      name.normalize("NFC"),
    ),
  ].map((part) => part.segment);
  if (letters.length <= 1) return "*";
  if (letters.length === 2) return `${letters[0]}*`;
  return `${letters[0]}${"*".repeat(letters.length - 2)}${letters.at(-1)}`;
}

export function memberDisplayName(name: string, role: SessionRole): string {
  return role === "viewer" ? maskMemberName(name) : name;
}

/** Original values are removed before returning to the rendering layer. */
export function projectMember<
  T extends { name: string; birthYear?: number | null },
>(
  member: T,
  role: SessionRole,
): Omit<T, "birthYear"> & { birthYear?: number | null } {
  const { birthYear, ...rest } = member;
  return role === "viewer"
    ? { ...rest, name: maskMemberName(member.name) }
    : { ...rest, birthYear };
}
