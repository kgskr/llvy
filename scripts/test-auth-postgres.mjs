import { spawnSync } from "node:child_process";

let local = false;
try {
  const url = new URL(process.env.LLVY_POSTGRES_TEST_URL);
  local =
    ["postgres:", "postgresql:"].includes(url.protocol) &&
    url.hostname === "127.0.0.1" &&
    url.pathname === "/llvy_auth_test" &&
    !url.search &&
    !url.hash;
} catch {
  // Require an explicit disposable fixture, never the application's database.
}
if (!local) {
  console.error(
    "Set LLVY_POSTGRES_TEST_URL to a disposable local PostgreSQL database named llvy_auth_test. Its authentication and game/member tables will be cleared.",
  );
  process.exit(1);
}
const result = spawnSync(
  process.execPath,
  [
    "node_modules/vitest/vitest.mjs",
    "run",
    "src/lib/auth-concurrency.postgres.test.ts",
  ],
  { stdio: "inherit" },
);
process.exit(result.status ?? 1);
