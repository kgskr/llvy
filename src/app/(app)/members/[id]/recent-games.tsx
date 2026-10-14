import Link from "next/link";
import { AssetIcon } from "@/app/(app)/asset-icon";
import { ItemSlots } from "@/app/(app)/item-slots";
import {
  formatDuration,
  formatGameDate,
  positionLabel,
  riotId,
} from "@/lib/format";
import { playedAtSourceLabel } from "@/lib/game-date";
import type { GameAsset } from "@/lib/game-assets";
import type {
  MemberHistoryGame,
  MemberHistoryParticipant,
} from "@/lib/member-history";
import type { resolveMemberGameAssets } from "@/lib/member-game-assets";

const RESULTS = { win: "승리", loss: "패배", unknown: "미정" };
const POSITIONS = ["TOP", "JUNGLE", "MIDDLE", "BOTTOM", "UTILITY"];
const EMPTY_ASSETS = {
  champions: new Map<string, GameAsset>(),
  items: new Map<number, GameAsset>(),
};

function orderPlayers(
  a: MemberHistoryParticipant,
  b: MemberHistoryParticipant,
) {
  const rank = (position: string | null) => {
    const index = POSITIONS.indexOf(position ?? "");
    return index === -1 ? POSITIONS.length : index;
  };
  return (
    rank(a.position) - rank(b.position) ||
    a.gameName.localeCompare(b.gameName, "ko") ||
    a.tagLine.localeCompare(b.tagLine) ||
    a.id.localeCompare(b.id)
  );
}

function kdaRatio(game: MemberHistoryGame) {
  const { kills, deaths, assists } = game;
  if (kills === null || deaths === null || assists === null)
    return "KDA 정보 없음";
  return deaths === 0
    ? "Perfect KDA"
    : `${((kills + assists) / deaths).toFixed(2)} KDA`;
}

function Roster({
  players,
  champions,
}: {
  players: MemberHistoryParticipant[];
  champions: Map<string, GameAsset>;
}) {
  const groups = [
    { title: "블루 팀", players: players.filter((p) => p.team === 100) },
    { title: "레드 팀", players: players.filter((p) => p.team === 200) },
    {
      title: "팀 미확인",
      players: players.filter((p) => p.team !== 100 && p.team !== 200),
    },
  ];
  return (
    <div className="member-game-rosters" aria-label="양 팀 참가자">
      {groups
        .filter((group, index) => index < 2 || group.players.length > 0)
        .map((group) => (
          <section
            className="member-game-team"
            key={group.title}
            aria-label={group.title}
          >
            <h3>{group.title}</h3>
            <ul>
              {group.players.sort(orderPlayers).map((player) => {
                const champion = player.champion
                  ? champions.get(player.champion)
                  : undefined;
                const name =
                  champion?.name ?? player.champion ?? "챔피언 정보 없음";
                return (
                  <li
                    key={player.id}
                    className={player.isMember ? "member-game-self" : undefined}
                  >
                    <AssetIcon
                      src={champion?.iconUrl}
                      label={`${name} · ${positionLabel(player.position)}`}
                      size={20}
                    />
                    <span
                      className="member-game-player"
                      title={`${riotId(player.gameName, player.tagLine)} · ${name} · ${positionLabel(player.position)}`}
                    >
                      {player.gameName}
                      {player.isMember ? (
                        <span className="sr-only"> (현재 모임원)</span>
                      ) : null}
                    </span>
                  </li>
                );
              })}
              {group.players.length === 0 ? (
                <li className="member-game-note">참가자 정보 없음</li>
              ) : null}
            </ul>
          </section>
        ))}
    </div>
  );
}

export function RecentGames({
  games,
  assetsByVersion,
  isAdmin,
}: {
  games: MemberHistoryGame[];
  assetsByVersion: Awaited<ReturnType<typeof resolveMemberGameAssets>>;
  isAdmin: boolean;
}) {
  return (
    <ol className="member-game-list" aria-label="최근 경기">
      {games.map((game) => {
        const assets =
          assetsByVersion.get(game.gameVersion ?? null) ?? EMPTY_ASSETS;
        const champion = game.champion
          ? assets.champions.get(game.champion)
          : undefined;
        const championName =
          champion?.name ?? game.champion ?? "챔피언 정보 없음";
        return (
          <li key={game.id}>
            <article
              className={`member-game-card member-game-${game.result}`}
              aria-label={`${formatGameDate(game.playedAt)} ${RESULTS[game.result]}`}
            >
              <div className="member-game-overview">
                <strong className="member-game-result">
                  {RESULTS[game.result]}
                </strong>
                <time
                  dateTime={game.playedAt}
                  title={playedAtSourceLabel(game.playedAtSource)}
                >
                  {formatGameDate(game.playedAt)}
                </time>
                <span className="member-game-note">
                  {formatDuration(game.durationMs)}
                </span>
                <Link
                  className="member-game-detail"
                  href={`/games/${game.id}`}
                  prefetch={false}
                >
                  상세 →
                </Link>
              </div>
              <div className="member-game-champion">
                <span className="member-game-portrait">
                  <AssetIcon
                    src={champion?.iconUrl}
                    label="챔피언 초상화"
                    decorative
                    size={56}
                  />
                  <span
                    className="member-game-level"
                    aria-label={
                      game.level == null
                        ? "레벨 정보 없음"
                        : `레벨 ${game.level}`
                    }
                  >
                    {game.level ?? "—"}
                  </span>
                </span>
                <span className="member-game-champion-name">
                  {game.ambiguous ? "참가자 미확정" : championName}
                </span>
                <span className="member-game-note">
                  {positionLabel(game.position)}
                </span>
              </div>
              <div className="member-game-performance">
                <div
                  className="member-game-kda"
                  aria-label="킬 / 데스 / 어시스트"
                >
                  {game.kills ?? "—"} / {game.deaths ?? "—"} /{" "}
                  {game.assists ?? "—"}
                </div>
                <span className="member-game-note">{kdaRatio(game)}</span>
                <ItemSlots items={game.items} assets={assets.items} size={28} />
                {game.ambiguous ? (
                  <span className="member-game-warning">
                    {isAdmin ? (
                      <Link href="/admin">계정 중복 연결 확인</Link>
                    ) : (
                      "계정 중복 연결 확인 필요"
                    )}
                  </span>
                ) : null}
              </div>
              <Roster
                players={game.participants ?? []}
                champions={assets.champions}
              />
            </article>
          </li>
        );
      })}
    </ol>
  );
}
