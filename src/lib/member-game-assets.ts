import "server-only";

import { resolveGameAssets } from "./game-assets";
import type { MemberHistoryGame } from "./member-history";

export async function resolveMemberGameAssets(games: MemberHistoryGame[]) {
  const groups = new Map<string | null, MemberHistoryGame[]>();
  for (const game of games) {
    const version = game.gameVersion ?? null;
    const group = groups.get(version) ?? [];
    group.push(game);
    groups.set(version, group);
  }
  const entries = [...groups];
  const result = new Map<
    string | null,
    Awaited<ReturnType<typeof resolveGameAssets>>
  >();
  // Respect the asset catalog's eight-entry bound, even on very old mixed pages.
  for (let start = 0; start < entries.length; start += 8) {
    await Promise.all(
      entries.slice(start, start + 8).map(async ([version, group]) => {
        const champions = new Set<string>();
        const items = new Set<number | null>();
        for (const game of group) {
          if (game.champion) champions.add(game.champion);
          for (const player of game.participants ?? []) {
            if (player.champion) champions.add(player.champion);
          }
          for (const id of game.items ?? []) items.add(id);
        }
        result.set(
          version,
          await resolveGameAssets(version, [...champions], [...items]),
        );
      }),
    );
  }
  return result;
}
