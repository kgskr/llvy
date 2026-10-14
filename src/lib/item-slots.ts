/** Final inventory order; 0 is empty, null is unavailable or malformed. */
export function readItemSlots(raw: unknown): (number | null)[] {
  const stats =
    raw && typeof raw === "object" && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : {};
  return Array.from({ length: 7 }, (_, slot) => {
    const value = stats[`ITEM${slot}`];
    if (typeof value !== "number" && typeof value !== "string") return null;
    if (typeof value === "string" && !/^\d+$/.test(value.trim())) return null;
    const id = Number(value);
    return Number.isInteger(id) && id >= 0 && id <= 2_147_483_647 ? id : null;
  });
}
