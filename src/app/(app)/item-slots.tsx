import { AssetIcon } from "./asset-icon";
import type { GameAsset } from "@/lib/game-assets";

export function ItemSlots({
  items,
  assets,
  size = 32,
}: {
  items: (number | null)[];
  assets: Map<number, GameAsset>;
  size?: number;
}) {
  return (
    <span className="game-item-slots">
      {Array.from({ length: 7 }, (_, slot) => {
        const id = items?.[slot] ?? null;
        const item = id ? assets.get(id) : undefined;
        const name =
          id === 0
            ? "빈 슬롯"
            : id === null
              ? "정보 없음"
              : (item?.name ?? `아이템 ${id}`);
        return (
          <AssetIcon
            key={`${slot}:${id}:${item?.iconUrl}`}
            src={item?.iconUrl}
            label={`${slot === 6 ? "장신구" : `아이템 ${slot + 1}`}: ${name}`}
            empty={id === 0}
            size={size}
          />
        );
      })}
    </span>
  );
}
