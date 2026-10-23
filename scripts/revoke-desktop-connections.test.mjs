import { describe, expect, it, vi } from "vitest";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  loadRuntime,
  run,
  validateOptions,
} from "./revoke-desktop-connections.mjs";

const env = {
  DESKTOP_UPLOADER_ENABLED: "false",
  POSTGRES_URL:
    "postgres://operator:secret@db.example.invalid/llvy?sslmode=require",
};
const args = [
  "--apply",
  "--database-target",
  "db.example.invalid/llvy",
  "--all-deployments-disabled",
  "--issuance-drained",
];

describe("desktop operator command", () => {
  it("defaults to a plan without loading server code or connecting to a DB", async () => {
    const load = vi.fn(),
      write = vi.fn();
    await run([], env, { load, write });
    expect(load).not.toHaveBeenCalled();
    expect(write.mock.calls.flat().join(" ")).toContain(
      "without opening a database connection",
    );
    expect(write.mock.calls.flat().join(" ")).not.toContain("secret");
  });
  it.each([
    [args, { ...env, DESKTOP_UPLOADER_ENABLED: undefined }],
    [args, { ...env, DESKTOP_UPLOADER_ENABLED: "true" }],
    [args, { ...env, POSTGRES_URL: undefined }],
    [args, { ...env, POSTGRES_URL: "invalid:secret" }],
    [
      args,
      {
        ...env,
        POSTGRES_URL:
          "postgres://operator:secret@db.example.invalid/llvy?host=other.example.invalid",
      },
    ],
    [
      args,
      {
        ...env,
        POSTGRES_URL:
          "postgres://operator:secret@db.example.invalid/llvy?port=5433",
      },
    ],
    [
      args,
      {
        ...env,
        POSTGRES_URL:
          "postgres://operator:secret@db.example.invalid/llvy?sslmode=require&sslmode=disable",
      },
    ],
    [args, { ...env, POSTGRES_URL: "https://db.example.invalid/llvy" }],
    [
      args,
      {
        ...env,
        POSTGRES_URL: "postgres://operator:secret@other.example.invalid/llvy",
      },
    ],
    [args.filter((a) => a !== "--issuance-drained"), env],
    [args.filter((a) => a !== "--all-deployments-disabled"), env],
    [[...args, "--apply"], env],
    [[...args, "--help"], env],
    [["--database-target"], env],
    [["--all-deployments-disabled"], env],
  ])(
    "rejects incomplete or ambiguous apply arguments before loading",
    async (input, config) => {
      const load = vi.fn();
      await expect(run(input, config, { load })).rejects.toThrow();
      expect(load).not.toHaveBeenCalled();
    },
  );
  it("invokes the existing operation once and always closes it", async () => {
    const revoke = vi.fn().mockResolvedValue({ accounts: 3, requests: 2 });
    const close = vi.fn(),
      write = vi.fn();
    await run(args, env, { load: async () => ({ revoke, close }), write });
    expect(revoke).toHaveBeenCalledOnce();
    expect(close).toHaveBeenCalledOnce();
    expect(write).toHaveBeenCalledWith(
      expect.stringContaining("3 accounts scanned, 2 remaining"),
    );
    revoke.mockRejectedValue(new Error("secret DB failure"));
    await expect(
      run(args, env, { load: async () => ({ revoke, close }), write }),
    ).rejects.toThrow();
    expect(close).toHaveBeenCalledTimes(2);
    expect(write).toHaveBeenCalledTimes(1);
  });
  it("rejects secret-bearing or invalid operation result fields", async () => {
    const close = vi.fn(),
      write = vi.fn();
    await expect(
      run(args, env, {
        load: async () => ({
          revoke: async () => ({ accounts: "secret", requests: 0 }),
          close,
        }),
        write,
      }),
    ).rejects.toThrow();
    expect(write).not.toHaveBeenCalled();
    expect(close).toHaveBeenCalledOnce();
  });
  it("builds and loads the real server module without executing a database query", async () => {
    const original = process.env.POSTGRES_URL;
    process.env.POSTGRES_URL =
      "postgres://fixture:fixture@fixture-pooler.invalid/test";
    try {
      const runtime = await loadRuntime();
      try {
        expect(runtime.revoke).toBeTypeOf("function");
      } finally {
        await runtime.close();
      }
    } finally {
      if (original === undefined) delete process.env.POSTGRES_URL;
      else process.env.POSTGRES_URL = original;
    }
  });
  it("the standalone entry rejects missing configuration without loading .env or exposing input", () => {
    const result = spawnSync(
      process.execPath,
      [
        fileURLToPath(
          new URL("./revoke-desktop-connections.mjs", import.meta.url),
        ),
        ...args,
      ],
      {
        env: {
          PATH: process.env.PATH,
          DESKTOP_UPLOADER_ENABLED: "false",
          POSTGRES_URL: "invalid-secret-value",
        },
        encoding: "utf8",
      },
    );
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("valid explicit POSTGRES_URL");
    expect(result.stderr).not.toContain("invalid-secret-value");
  });
  it("accepts a matching explicit target including port", () => {
    expect(
      validateOptions(
        args.map((v) =>
          v === "db.example.invalid/llvy" ? "db.example.invalid:5433/llvy" : v,
        ),
        {
          ...env,
          POSTGRES_URL:
            "postgresql://operator:secret@db.example.invalid:5433/llvy",
        },
      ),
    ).toEqual({ apply: true });
  });
});
