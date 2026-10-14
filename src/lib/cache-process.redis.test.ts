import { fork, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { build } from "esbuild";
import Redis from "ioredis";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";

const url = process.env.LLVY_REDIS_TEST_URL;
describe.skipIf(!url)("index leases across independent Node processes", () => {
  let directory: string;
  let bundle: string;
  let redis: Redis;
  let prefix: string;
  const workers: ChildProcess[] = [];
  beforeAll(async () => {
    if (new URL(url!).hostname !== "127.0.0.1")
      throw new Error("Local disposable Redis required");
    redis = new Redis(url!);
    directory = await mkdtemp(join(tmpdir(), "llvy-cache-workers-"));
    bundle = join(directory, "worker.cjs");
    const empty = join(directory, "server-only.cjs");
    await writeFile(empty, "module.exports = {};");
    await build({
      entryPoints: ["src/test/cache-index-worker.ts"],
      outfile: bundle,
      bundle: true,
      platform: "node",
      format: "cjs",
      alias: { "server-only": empty },
      logLevel: "silent",
    });
  }, 20000);
  beforeEach(() => {
    prefix = `llvy-process:${randomUUID()}`;
  });
  afterEach(async () => {
    for (const worker of workers.splice(0)) {
      if (worker.exitCode === null && worker.signalCode === null) {
        const stopped = new Promise<void>((resolve) =>
          worker.once("exit", () => resolve()),
        );
        worker.kill();
        await stopped;
      }
    }
    const keys = await redis.keys(`${prefix}:*`);
    if (keys.length) await redis.del(...keys);
  });
  afterAll(async () => {
    redis?.disconnect();
    if (directory) await rm(directory, { recursive: true, force: true });
  });

  async function worker() {
    const child = fork(bundle, [], {
      env: {
        ...process.env,
        REDIS_URL: url,
        REDIS_KEY_PREFIX: prefix,
        POSTGRES_URL: "postgres://fixture:fixture@fixture.invalid/disposable",
      },
      stdio: ["ignore", "ignore", "pipe", "ipc"],
    });
    workers.push(child);
    const messages: { action: string; result?: { name: string }[] }[] = [];
    child.on("message", (message) => {
      messages.push(message as (typeof messages)[number]);
    });
    async function wait(action: string) {
      await expect
        .poll(() => messages.some((message) => message.action === action), {
          timeout: 5000,
        })
        .toBe(true);
      return messages.splice(
        messages.findIndex((message) => message.action === action),
        1,
      )[0];
    }
    await wait("ready");
    return {
      child,
      messages,
      wait,
      read(name: string, defer = false) {
        child.send({ action: "read", name, defer });
        return wait("result");
      },
    };
  }

  it("allows only the lease owner to publish while another process uses bounded DB fallback", async () => {
    const first = await worker();
    const second = await worker();
    expect((await first.read("alpha", true)).result).toEqual([
      { name: "alpha" },
    ]);
    expect((await second.read("another")).result).toEqual([
      { name: "another" },
    ]);
    expect(await redis.keys(`${prefix}:*:ready`)).toHaveLength(0);
    first.child.send({ action: "publish" });
    await first.wait("published");
    second.messages.length = 0;
    expect((await second.read("absent")).result).toEqual([{ name: "alpha" }]);
    expect(second.messages.some((message) => message.action === "loaded")).toBe(
      false,
    );
  });

  it("rejects a late owner and recovers after the replacement process terminates", async () => {
    const old = await worker();
    const replacement = await worker();
    await old.read("ancient", true);
    const lease = (await redis.keys(`${prefix}:*:lease`))[0];
    await redis.del(lease); // deterministic lease expiry, not a production operation
    await replacement.read("actual", true);
    const token = await redis.get(lease);
    old.child.send({ action: "publish" });
    await old.wait("published");
    expect(await redis.get(lease)).toBe(token);
    expect(await redis.keys(`${prefix}:*:ready`)).toHaveLength(0);
    const stopped = new Promise<void>((resolve) =>
      replacement.child.once("exit", () => resolve()),
    );
    replacement.child.kill();
    await stopped;
    await redis.pexpire(lease, 1);
    await expect.poll(() => redis.exists(lease)).toBe(0);
    expect((await old.read("after-recovery")).result).toEqual([
      { name: "after-recovery" },
    ]);
    expect(await redis.keys(`${prefix}:*:ready`)).toHaveLength(1);
  });
});
