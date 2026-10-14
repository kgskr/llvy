import { beforeEach, expect, it, vi } from "vitest";
import { memberGameFixture } from "@/test/member-history";
const mocks = vi.hoisted(() => ({ resolve: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("./game-assets", () => ({ resolveGameAssets: mocks.resolve }));
import { resolveMemberGameAssets } from "./member-game-assets";

beforeEach(() =>
  mocks.resolve
    .mockReset()
    .mockResolvedValue({ champions: new Map(), items: new Map() }),
);

it("groups requests by version, deduplicates requested assets and skips empty pages", async () => {
  expect((await resolveMemberGameAssets([])).size).toBe(0);
  expect(mocks.resolve).not.toHaveBeenCalled();
  const games = [
    memberGameFixture(),
    memberGameFixture(),
    memberGameFixture({ gameVersion: null }),
  ];
  expect((await resolveMemberGameAssets(games)).size).toBe(2);
  expect(mocks.resolve).toHaveBeenCalledTimes(2);
  const [version, champions, items] = mocks.resolve.mock.calls[0];
  expect(version).toBe("16.19.1.1");
  expect(champions).toHaveLength(10);
  expect(champions).toContain("Ahri");
  expect(items).toEqual(games[0].items);
});

it("bounds parallel catalogs while retaining all versions on an old mixed page", async () => {
  let active = 0;
  let peak = 0;
  mocks.resolve.mockImplementation(async () => {
    active++;
    peak = Math.max(peak, active);
    await Promise.resolve();
    active--;
    return { champions: new Map(), items: new Map() };
  });
  const games = Array.from({ length: 25 }, (_, index) =>
    memberGameFixture({ gameVersion: `16.${index + 1}.1` }),
  );
  expect((await resolveMemberGameAssets(games)).size).toBe(25);
  expect(peak).toBeLessThanOrEqual(8);
});
