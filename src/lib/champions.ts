import "server-only";
import { measureCache } from "@/lib/cache-metrics";

// Resolve internal champion names (the .rofl `SKIN` field, e.g. "MonkeyKing")
// to localized display names ("오공") via Riot's DataDragon. Falls back to the
// internal name if the lookup is unavailable.

const DDRAGON = "https://ddragon.leagueoflegends.com";
const DAY_SECONDS = 60 * 60 * 24;
const LOOKUP_TIMEOUT_MS = 2_000;

type ChampionMap = Map<string, { name: string; iconUrl?: string }>;
let memo: { map: ChampionMap; expiresAt: number } | null = null;
let pending: Promise<ChampionMap> | null = null;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function fetchChampionMap(signal: AbortSignal): Promise<ChampionMap> {
  const versionsRes = await fetch(`${DDRAGON}/api/versions.json`, {
    next: { revalidate: DAY_SECONDS },
    signal,
  });
  if (!versionsRes.ok) return new Map();
  const versions: unknown = await versionsRes.json();
  const version = Array.isArray(versions) ? versions[0] : undefined;
  if (typeof version !== "string" || !/^\d+\.\d+\.\d+$/.test(version)) {
    return new Map();
  }

  const champRes = await fetch(
    `${DDRAGON}/cdn/${version}/data/ko_KR/champion.json`,
    { next: { revalidate: DAY_SECONDS }, signal },
  );
  if (!champRes.ok) return new Map();
  const data: unknown = await champRes.json();
  if (!isRecord(data) || !isRecord(data.data)) return new Map();

  const map: ChampionMap = new Map();
  for (const champion of Object.values(data.data)) {
    if (
      isRecord(champion) &&
      typeof champion.id === "string" &&
      typeof champion.name === "string" &&
      champion.name !== ""
    ) {
      const image = isRecord(champion.image) ? champion.image.full : undefined;
      map.set(champion.id, {
        name: champion.name,
        iconUrl:
          typeof image === "string" && /^[A-Za-z0-9_-]+\.png$/.test(image)
            ? `${DDRAGON}/cdn/${version}/img/champion/${image}`
            : undefined,
      });
    }
  }
  return map;
}

async function refreshChampionMap(): Promise<ChampionMap> {
  const controller = new AbortController();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    // Bound the entire lookup, including both requests and response bodies.
    // A late/aborted request cannot populate memo after the fallback returns.
    const map = await Promise.race([
      fetchChampionMap(controller.signal),
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(() => {
          controller.abort();
          reject(controller.signal.reason);
        }, LOOKUP_TIMEOUT_MS);
      }),
    ]);
    if (map.size > 0) {
      memo = { map, expiresAt: Date.now() + DAY_SECONDS * 1000 };
    }
    return map;
  } catch {
    // Offline / DataDragon down: callers fall back to internal names.
    return new Map();
  } finally {
    clearTimeout(timeout);
  }
}

async function loadChampionMap(): Promise<ChampionMap> {
  if (memo && memo.expiresAt > Date.now()) return memo.map;
  memo = null;
  if (!pending) {
    pending = refreshChampionMap().finally(() => {
      pending = null;
    });
  }
  return pending;
}

/** Map internal champion names to display names (best effort). */
export async function resolveChampionNames(
  internalNames: string[],
): Promise<Map<string, string>> {
  const map = await measureCache("asset_lookup_ms", loadChampionMap);
  const result = new Map<string, string>();
  for (const name of internalNames) {
    result.set(name, map.get(name)?.name ?? name);
  }
  return result;
}

/** Portrait URLs from the same cached catalog used for display names. */
export async function resolveChampionPortraits(
  internalNames: string[],
): Promise<Map<string, string>> {
  const map = await measureCache("asset_lookup_ms", loadChampionMap);
  const result = new Map<string, string>();
  for (const name of internalNames) {
    const iconUrl = map.get(name)?.iconUrl;
    if (iconUrl) result.set(name, iconUrl);
  }
  return result;
}
