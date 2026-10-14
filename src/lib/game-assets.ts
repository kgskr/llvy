import "server-only";

const CDN = "https://ddragon.leagueoflegends.com";
const DAY_SECONDS = 86_400;
const MAX_CATALOGS = 8;

export type GameAsset = { name: string; iconUrl: string };
type Catalog = {
  champions: Map<string, GameAsset>;
  items: Map<number, GameAsset>;
};
type CacheEntry = {
  value?: Catalog;
  pending?: Promise<Catalog>;
  expiresAt: number;
};
const catalogs = new Map<string, CacheEntry>();
const emptyCatalog = (): Catalog => ({
  champions: new Map(),
  items: new Map(),
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

async function fetchJson(path: string, signal: AbortSignal): Promise<unknown> {
  const response = await fetch(`${CDN}${path}`, {
    next: { revalidate: DAY_SECONDS },
    signal,
  });
  if (!response.ok) throw new Error("DataDragon unavailable");
  return response.json();
}

function asset(
  value: unknown,
  version: string,
  kind: "champion" | "item",
): GameAsset | null {
  if (
    !isRecord(value) ||
    typeof value.name !== "string" ||
    !value.name.trim() ||
    !isRecord(value.image) ||
    typeof value.image.full !== "string" ||
    !/^[A-Za-z0-9_-]+\.png$/.test(value.image.full)
  )
    return null;
  return {
    name: value.name,
    iconUrl: `${CDN}/cdn/${version}/img/${kind}/${value.image.full}`,
  };
}

async function fetchCatalog(
  patch: string,
  signal: AbortSignal,
): Promise<Catalog> {
  const versions = await fetchJson("/api/versions.json", signal);
  if (!Array.isArray(versions)) return emptyCatalog();
  const version = versions.find(
    (v): v is string =>
      typeof v === "string" &&
      /^\d+\.\d+\.\d+$/.test(v) &&
      (patch === "latest" || v.startsWith(`${patch}.`)),
  );
  if (!version) return emptyCatalog();
  const [champions, items] = await Promise.all([
    fetchJson(`/cdn/${version}/data/ko_KR/champion.json`, signal),
    fetchJson(`/cdn/${version}/data/ko_KR/item.json`, signal),
  ]);
  const result = emptyCatalog();
  if (isRecord(champions) && isRecord(champions.data)) {
    for (const entry of Object.values(champions.data)) {
      const image = asset(entry, version, "champion");
      if (image && isRecord(entry) && typeof entry.id === "string") {
        result.champions.set(entry.id.toLowerCase(), image);
      }
    }
  }
  if (isRecord(items) && isRecord(items.data)) {
    for (const [id, entry] of Object.entries(items.data)) {
      const image = asset(entry, version, "item");
      if (/^[1-9]\d*$/.test(id) && Number.isSafeInteger(Number(id)) && image) {
        result.items.set(Number(id), image);
      }
    }
  }
  return result;
}

async function loadCatalog(patch: string): Promise<Catalog> {
  const cached = catalogs.get(patch);
  if (cached?.pending) return cached.pending;
  if (cached?.value && cached.expiresAt > Date.now()) return cached.value;
  catalogs.delete(patch);
  if (catalogs.size >= MAX_CATALOGS) {
    const oldest = [...catalogs].find(([, entry]) => !entry.pending);
    if (!oldest) return emptyCatalog();
    catalogs.delete(oldest[0]);
  }
  const entry: CacheEntry = { expiresAt: 0 };
  catalogs.set(patch, entry);
  entry.pending = (async () => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const result = await Promise.race([
        fetchCatalog(patch, controller.signal),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => {
            controller.abort();
            reject(controller.signal.reason);
          }, 2_000);
        }),
      ]);
      if (result.champions.size && result.items.size) {
        entry.value = result;
        entry.expiresAt = Date.now() + DAY_SECONDS * 1000;
      }
      return result;
    } catch {
      return emptyCatalog();
    } finally {
      clearTimeout(timer);
      controller.abort();
      entry.pending = undefined;
      if (!entry.value) catalogs.delete(patch);
    }
  })();
  return entry.pending;
}

/** Return only requested assets, never raw catalogs or replay-controlled URLs. */
export async function resolveGameAssets(
  gameVersion: string | null,
  champions: string[],
  itemIds: (number | null)[],
): Promise<Catalog> {
  const patch =
    gameVersion === null
      ? "latest"
      : /^(\d{1,3}\.\d{1,3})(?:\.\d+){0,2}$/.exec(gameVersion)?.[1];
  if (!patch) return emptyCatalog();
  const catalog = await loadCatalog(patch);
  const result = emptyCatalog();
  for (const champion of champions) {
    const value = catalog.champions.get(champion.toLowerCase());
    if (value) result.champions.set(champion, { ...value });
  }
  for (const id of itemIds) {
    if (id === null || id === 0) continue;
    const value = catalog.items.get(id);
    if (value) result.items.set(id, { ...value });
  }
  return result;
}
