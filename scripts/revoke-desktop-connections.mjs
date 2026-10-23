import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const usage = `Default: print this plan without opening a database connection.
Disable desktop issuance on ALL serving deployments (including old URLs),
then drain in-flight issuance before applying. This command cannot verify those steps.
Supply POSTGRES_URL and DESKTOP_UPLOADER_ENABLED=false explicitly; .env files are not loaded.
Apply: npm run desktop:revoke-all -- --apply --database-target HOST[:PORT]/DATABASE --all-deployments-disabled --issuance-drained
The transaction permanently revokes desktop devices and unfinished authorization requests.
Browser sessions and completed game records are preserved.`;

export class InputError extends Error {}

export function validateOptions(args, env) {
  const flags = new Set();
  let target;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--database-target" && target === undefined) {
      target = args[++i];
      if (!target || target.startsWith("--"))
        throw new InputError(
          "--database-target requires HOST[:PORT]/DATABASE.",
        );
    } else if (
      [
        "--apply",
        "--all-deployments-disabled",
        "--issuance-drained",
        "--help",
      ].includes(arg) &&
      !flags.has(arg)
    )
      flags.add(arg);
    else throw new InputError("Unknown or duplicate argument; use --help.");
  }
  if (flags.has("--help") && args.length !== 1)
    throw new InputError("Use --help on its own.");
  if (!flags.has("--apply")) {
    if (
      target !== undefined ||
      flags.has("--all-deployments-disabled") ||
      flags.has("--issuance-drained")
    )
      throw new InputError("Apply acknowledgements require --apply.");
    return { apply: false };
  }
  if (env.DESKTOP_UPLOADER_ENABLED !== "false")
    throw new InputError(
      "Set DESKTOP_UPLOADER_ENABLED=false explicitly before applying.",
    );
  if (
    !flags.has("--all-deployments-disabled") ||
    !flags.has("--issuance-drained")
  )
    throw new InputError(
      "Confirm all serving deployments are disabled and issuance has drained.",
    );
  let url;
  try {
    url = new URL(env.POSTGRES_URL);
  } catch {
    throw new InputError("A valid explicit POSTGRES_URL is required.");
  }
  if (
    !["postgres:", "postgresql:"].includes(url.protocol) ||
    !url.hostname ||
    !/^\/[A-Za-z0-9_.-]+$/.test(url.pathname) ||
    url.hash
  )
    throw new InputError(
      "POSTGRES_URL must identify a PostgreSQL host and database.",
    );
  // Connection-string query options can override the apparent host/port.
  // Accept only a single TLS mode, so target confirmation names the real target.
  if (
    [...url.searchParams.keys()].some((key) => key !== "sslmode") ||
    url.searchParams.getAll("sslmode").length > 1 ||
    (url.searchParams.has("sslmode") &&
      !["disable", "prefer", "require", "verify-ca", "verify-full"].includes(
        url.searchParams.get("sslmode"),
      ))
  )
    throw new InputError("POSTGRES_URL permits only one sslmode query option.");
  if (target !== `${url.host}${url.pathname}`)
    throw new InputError(
      "--database-target must match POSTGRES_URL host[:port]/database.",
    );
  return { apply: true };
}

// Bundle the repository implementation, not a separately maintained SQL copy.
// The server-only sentinel is a Next.js compile-time boundary; this entry is Node-only.
export async function loadRuntime() {
  const { build } = await import("esbuild");
  const cache = join(root, "node_modules", ".cache");
  await mkdir(cache, { recursive: true });
  const dir = await mkdtemp(join(cache, "desktop-revoke-"));
  const output = join(dir, "runtime.cjs");
  try {
    await build({
      absWorkingDir: root,
      stdin: {
        contents:
          'export { revokeAllDesktopConnections as revoke } from "./src/lib/desktop/maintenance"; export { sql } from "@vercel/postgres";',
        resolveDir: root,
        loader: "ts",
      },
      outfile: output,
      bundle: true,
      platform: "node",
      format: "cjs",
      packages: "external",
      logLevel: "silent",
      plugins: [
        {
          name: "node-operator-server-only",
          setup(builder) {
            builder.onResolve({ filter: /^server-only$/ }, () => ({
              path: "server-only",
              namespace: "operator",
            }));
            builder.onLoad({ filter: /.*/, namespace: "operator" }, () => ({
              contents: "",
            }));
          },
        },
      ],
    });
    const runtime = createRequire(import.meta.url)(output);
    return {
      revoke: runtime.revoke,
      close: async () => {
        try {
          await runtime.sql.end();
        } finally {
          await rm(dir, { recursive: true, force: true });
        }
      },
    };
  } catch (error) {
    await rm(dir, { recursive: true, force: true });
    throw error;
  }
}

export async function run(
  args,
  env,
  { load = loadRuntime, write = console.log } = {},
) {
  const options = validateOptions(args, env);
  if (!options.apply) {
    write(usage);
    return;
  }
  const runtime = await load();
  try {
    const result = await runtime.revoke();
    if (
      !Number.isSafeInteger(result.accounts) ||
      result.accounts < 0 ||
      !Number.isSafeInteger(result.requests) ||
      result.requests < 0
    )
      throw new Error("Invalid operation result");
    write(
      `Desktop revocation committed: ${result.accounts} accounts scanned, ${result.requests} remaining unfinished authorization requests revoked.`,
    );
  } finally {
    await runtime.close();
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  run(process.argv.slice(2), process.env).catch((error) => {
    // Provider errors may contain URLs, SQL parameters or credentials.
    console.error(
      error instanceof InputError
        ? error.message
        : "Desktop revocation failed or completion is unconfirmed. Keep issuance disabled; inspect the database audit and rerun after resolving the failure.",
    );
    process.exitCode = 1;
  });
}
