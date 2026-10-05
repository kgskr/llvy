import { spawnSync } from "node:child_process";

const target = process.env.LLVY_VALKEY_TEST_URL;
let local = false;
try {
  const url = new URL(target);
  local = url.protocol === "redis:" && url.hostname === "127.0.0.1";
} catch {
  // A missing or invalid fixture URL is a test setup error, not a skipped pass.
}
if (!local) {
  console.error(
    "Set LLVY_VALKEY_TEST_URL to the disposable Podman container, e.g. redis://127.0.0.1:16379.",
  );
  process.exit(1);
}

const result = spawnSync(
  process.execPath,
  [
    "node_modules/vitest/vitest.mjs",
    "run",
    "src/lib/valkey.test.ts",
    "src/lib/query-cache.integration.test.ts",
  ],
  {
    stdio: "inherit",
    env: { ...process.env, VALKEY_URL: "" },
  },
);
process.exit(result.status ?? 1);
