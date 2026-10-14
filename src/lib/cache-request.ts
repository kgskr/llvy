import "server-only";
import { AsyncLocalStorage } from "node:async_hooks";
import { cache } from "react";

const request = new AsyncLocalStorage<Map<string, Promise<unknown>>>();

export function withCacheRequest<T>(work: () => T): T {
  return request.run(new Map(), work);
}

/** React handles RSC renders; the explicit scope handles read-only routes. */
export function requestCached<T>(load: (key: string) => Promise<T>) {
  return cache((key: string): Promise<T> => {
    const scope = request.getStore();
    if (!scope) return load(key);
    if (!scope.has(key)) scope.set(key, load(key));
    return scope.get(key) as Promise<T>;
  });
}
