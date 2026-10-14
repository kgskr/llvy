import Link from "next/link";
import type { GameAsset } from "@/lib/game-assets";
import type { GameParticipantRow } from "@/lib/games";
import { positionLabel, riotId } from "@/lib/format";
import { AssetIcon } from "@/app/(app)/asset-icon";
import { ItemSlots } from "@/app/(app)/item-slots";

export type TeamResult = "win" | "loss" | "unknown";

const RESULT_BADGE: Record<TeamResult, { className: string; label: string }> = {
  win: { className: "badge badge-win", label: "승리" },
  loss: { className: "badge badge-loss", label: "패배" },
  unknown: { className: "badge badge-muted", label: "미정" },
};

export function TeamBlock({
  title,
  result,
  players,
  assets,
}: {
  title: string;
  result: TeamResult;
  players: GameParticipantRow[];
  assets: { champions: Map<string, GameAsset>; items: Map<number, GameAsset> };
}) {
  const badge = RESULT_BADGE[result];
  return (
    <div className="team-block">
      <h3>
        {title} <span className={badge.className}>{badge.label}</span>
      </h3>
      <div className="table-scroll">
        <table className="table game-detail-table">
          <thead>
            <tr>
              <th>포지션</th>
              <th>라이엇 아이디</th>
              <th>챔피언</th>
              <th>아이템</th>
              <th>모임원</th>
              <th>K / D / A</th>
              <th>골드</th>
            </tr>
          </thead>
          <tbody>
            {players.map((p) => (
              <tr key={p.id}>
                <td>
                  {p.position ? (
                    positionLabel(p.position)
                  ) : (
                    <span className="badge badge-muted">불명</span>
                  )}
                </td>
                <td>{riotId(p.gameName, p.tagLine)}</td>
                <td>
                  <span className="game-champion">
                    <AssetIcon
                      src={
                        p.champion
                          ? assets.champions.get(p.champion)?.iconUrl
                          : undefined
                      }
                      label="챔피언 초상화"
                      decorative
                    />
                    {p.champion
                      ? (assets.champions.get(p.champion)?.name ?? p.champion)
                      : "-"}
                  </span>
                </td>
                <td>
                  <ItemSlots items={p.items} assets={assets.items} />
                </td>
                <td>
                  {p.memberId && p.memberName ? (
                    <Link href={`/members/${p.memberId}`}>{p.memberName}</Link>
                  ) : (
                    <span className="muted">미연결</span>
                  )}
                </td>
                <td>
                  {p.kills ?? "-"} / {p.deaths ?? "-"} / {p.assists ?? "-"}
                </td>
                <td>
                  {p.goldEarned != null ? p.goldEarned.toLocaleString() : "-"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
