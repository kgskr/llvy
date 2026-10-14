// Bundled only by the opt-in, localhost-only Redis regression suite.
import { createAutocompleteIndex } from "@/lib/autocomplete-index";
import { CacheBudget, CacheReads } from "@/lib/cache-context";
import { withCacheLifecycle } from "@/lib/cache-lifecycle";
import { getRedisConnection, disconnectRedis } from "@/lib/redis";

const query = createAutocompleteIndex<{ name: string }>({
  namespace: "process-index",
  indexedName: (value) => value.name,
  project: (value) =>
    value &&
    typeof value === "object" &&
    "name" in value &&
    typeof value.name === "string"
      ? { name: value.name }
      : null,
});
const publications: (() => Promise<void>)[] = [];
process.on(
  "message",
  async (message: { action: string; name: string; defer?: boolean }) => {
    try {
      if (message.action === "close") {
        disconnectRedis();
        process.exit(0);
      }
      if (message.action === "publish") {
        for (const work of publications.splice(0)) await work();
        process.send?.({ action: "published" });
        return;
      }
      const connection = await getRedisConnection();
      if (!connection) throw new Error("fixture Redis unavailable");
      const context = {
        connection,
        revision: "process-fixture",
        snapshot: { epoch: "fixture", values: {} },
        budget: new CacheBudget(),
        reads: new CacheReads(connection.client),
      };
      const load = async () => {
        process.send?.({ action: "loaded" });
        return [{ name: message.name }];
      };
      const read = () => query("a", load, context);
      const result = message.defer
        ? await withCacheLifecycle((work) => {
            publications.push(work);
          }, read)
        : await read();
      process.send?.({ action: "result", result });
    } catch {
      process.send?.({ action: "error" });
    }
  },
);
process.send?.({ action: "ready" });
