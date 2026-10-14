import { readItemSlots } from "./item-slots";

/** Only display validated scalar values; absent replay fields remain unknown. */
export function readParticipantLoadout(raw: unknown) {
  const value =
    raw && typeof raw === "object" && !Array.isArray(raw)
      ? (raw as Record<string, unknown>).LEVEL
      : undefined;
  const numeric =
    typeof value === "number" ||
    (typeof value === "string" && /^\d+$/.test(value.trim()))
      ? Number(value)
      : NaN;
  return {
    level:
      Number.isInteger(numeric) && numeric >= 1 && numeric <= 99
        ? numeric
        : null,
    items: readItemSlots(raw),
  };
}
