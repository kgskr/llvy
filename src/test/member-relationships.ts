import { randomUUID } from "node:crypto";
import { gameParticipants, games, riotAccounts } from "@/db/schema";
import { db } from "@/test/database";
import { createMemberFixture } from "@/test/members";

/** Setup only; changes under test must use protected mutation services. */
export async function relationshipMemberFixture(name: string) {
  const id = await createMemberFixture(name, 1990);
  const accounts = await db
    .insert(riotAccounts)
    .values(
      [0, 1].map((index) => ({
        memberId: id,
        gameName: `${name}${index}`,
        tagLine: "KR1",
        puuid: randomUUID(),
      })),
    )
    .returning({ id: riotAccounts.id });
  return { id, accounts: accounts.map((account) => account.id) };
}

export async function relationshipGameFixture(
  participants: { account: string; team: number | null }[],
  winningTeam: number | null = 100,
  excluded = false,
) {
  const [game] = await db
    .insert(games)
    .values({
      fileHash: randomUUID(),
      blobUrl: `https://fixture.invalid/${randomUUID()}.rofl`,
      playedAt: "2026-10-01",
      playedAtSource: "manual",
      winningTeam,
      excludedAt: excluded ? new Date() : null,
    })
    .returning({ id: games.id });
  await db.insert(gameParticipants).values(
    participants.map((participant) => ({
      gameId: game.id,
      riotAccountId: participant.account,
      team: participant.team,
      // The loader must derive the result from the game, not this legacy field.
      win: false,
      rawStats: { PUUID: "private-fixture" },
    })),
  );
  return game.id;
}
