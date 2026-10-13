import { beforeEach, describe, expect, it, vi } from "vitest";
import { ownerActor } from "@/test/actor";

const mocks = vi.hoisted(() => ({ cookies: vi.fn(), actor: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({ cookies: mocks.cookies }));
vi.mock("@/lib/auth", () => ({
  SESSION_COOKIE: "fixture-session",
  readSessionToken: async (token: string | undefined) =>
    token ? { reference: token, issuedAt: 1 } : null,
}));
vi.mock("@/lib/auth-store", () => ({
  hashReference: (value: string) => value,
}));
vi.mock("@/lib/authority", () => ({ findSessionActor: mocks.actor }));
import {
  assertAdmin,
  assertOwner,
  assertReadOwner,
  assertSession,
  getReadSession,
  getSession,
  UnauthorizedError,
  withReadSession,
} from "./session";

beforeEach(() => {
  vi.resetAllMocks();
  mocks.cookies.mockResolvedValue({ get: () => ({ value: "first" }) });
  mocks.actor.mockResolvedValue(ownerActor);
});

describe("request-only read authentication", () => {
  it("shares an in-flight DB lookup across repeated read guards", async () => {
    let finish!: (value: typeof ownerActor) => void;
    mocks.actor.mockImplementation(
      () => new Promise((resolve) => (finish = resolve)),
    );
    await withReadSession(async () => {
      const reads = Promise.all([
        getReadSession(),
        assertSession(),
        assertReadOwner(),
      ]);
      await vi.waitFor(() => expect(mocks.actor).toHaveBeenCalledOnce());
      finish(ownerActor);
      const sessions = await reads;
      expect(sessions.every((session) => session === sessions[0])).toBe(true);
      expect(await getReadSession()).toBe(sessions[0]);
    });
    expect(mocks.cookies).toHaveBeenCalledOnce();
    expect(mocks.actor).toHaveBeenCalledOnce();
  });

  it("isolates overlapping requests with different cookies", async () => {
    mocks.cookies
      .mockResolvedValueOnce({ get: () => ({ value: "first" }) })
      .mockResolvedValueOnce({ get: () => ({ value: "second" }) });
    mocks.actor.mockImplementation(async (reference: string) => ({
      ...ownerActor,
      name: reference,
    }));
    const [first, second] = await Promise.all([
      withReadSession(() => Promise.all([getReadSession(), getReadSession()])),
      withReadSession(() => Promise.all([getReadSession(), getReadSession()])),
    ]);
    expect(first.map((s) => s?.name)).toEqual(["first", "first"]);
    expect(second.map((s) => s?.name)).toEqual(["second", "second"]);
    expect(mocks.actor).toHaveBeenCalledTimes(2);
  });

  it("rechecks revoked authority on the next request", async () => {
    expect(await withReadSession(getReadSession)).not.toBeNull();
    mocks.actor.mockResolvedValue(null);
    await withReadSession(async () => {
      expect(await getReadSession()).toBeNull();
      await expect(assertSession()).rejects.toBeInstanceOf(UnauthorizedError);
    });
    expect(mocks.actor).toHaveBeenCalledTimes(2);
  });

  it("shares errors within a request but retries the next request", async () => {
    const failure = new Error("database unavailable");
    mocks.actor.mockRejectedValueOnce(failure);
    const results = await withReadSession(() =>
      Promise.allSettled([getReadSession(), assertSession()]),
    );
    expect(results).toEqual([
      { status: "rejected", reason: failure },
      { status: "rejected", reason: failure },
    ]);
    expect(mocks.actor).toHaveBeenCalledOnce();
    expect(await withReadSession(getReadSession)).not.toBeNull();
    expect(mocks.actor).toHaveBeenCalledTimes(2);
  });

  it.each([getSession, assertAdmin, assertOwner])(
    "fresh lookup/guard %s bypasses a previously successful read snapshot",
    async (fresh) => {
      await withReadSession(async () => {
        expect(await getReadSession()).not.toBeNull();
        mocks.actor.mockResolvedValue(null);
        if (fresh === getSession) expect(await fresh()).toBeNull();
        else await expect(fresh()).rejects.toBeInstanceOf(UnauthorizedError);
      });
      expect(mocks.actor).toHaveBeenCalledTimes(2);
    },
  );

  it("does not memoize unscoped reads outside React rendering", async () => {
    await getReadSession();
    mocks.actor.mockResolvedValue(null);
    expect(await getReadSession()).toBeNull();
    expect(mocks.actor).toHaveBeenCalledTimes(2);
  });
});
