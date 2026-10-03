import "server-only";

// Resolve internal champion names (the .rofl `SKIN` field, e.g. "MonkeyKing")
// to localized display names ("오공") via Riot's DataDragon. Falls back to the
// internal name if the lookup is unavailable.

const DDRAGON = "https://ddragon.leagueoflegends.com";
const DAY_SECONDS = 60 * 60 * 24;
const LOOKUP_TIMEOUT_MS = 2_000;

type ChampionMap = Map<string, string>;
let memo: ChampionMap | null = null;

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
      map.set(champion.id, champion.name);
    }
  }
  return map;
}

async function loadChampionMap(): Promise<ChampionMap> {
  if (memo) return memo;
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
    if (map.size > 0) memo = map;
    return map;
  } catch {
    // Offline / DataDragon down: callers fall back to internal names.
    return new Map();
  } finally {
    clearTimeout(timeout);
  }
}

/** Map internal champion names to display names (best effort). */
export async function resolveChampionNames(
  internalNames: string[],
): Promise<Map<string, string>> {
  const map = await loadChampionMap();
  const result = new Map<string, string>();
  for (const name of internalNames) {
    result.set(name, map.get(name) ?? name);
  }
  return result;
}
