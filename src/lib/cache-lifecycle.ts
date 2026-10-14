import "server-only";
import { AsyncLocalStorage } from "node:async_hooks";
type Schedule = (work: () => Promise<void>) => void;
const lifecycle = new AsyncLocalStorage<Schedule>();
export function withCacheLifecycle<T>(schedule: Schedule, work: () => T): T {
  return lifecycle.run(schedule, work);
}
export function cachePublicationScheduler() {
  return lifecycle.getStore();
}
