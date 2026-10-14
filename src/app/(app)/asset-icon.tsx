"use client";

import Image from "next/image";
import { useState } from "react";

export function AssetIcon({
  src,
  label,
  empty = false,
  decorative = false,
  size = 32,
}: {
  src?: string;
  label: string;
  empty?: boolean;
  decorative?: boolean;
  size?: number;
}) {
  const [failedSrc, setFailedSrc] = useState<string>();
  return (
    <span
      className={`game-asset-icon${empty ? " game-asset-empty" : ""}`}
      role={decorative ? undefined : "img"}
      aria-label={decorative ? undefined : label}
      aria-hidden={decorative || undefined}
      title={label}
      style={
        size === 32 ? undefined : { width: size, height: size, flexBasis: size }
      }
    >
      {src && failedSrc !== src ? (
        <Image
          src={src}
          width={size}
          height={size}
          alt=""
          unoptimized
          onError={() => setFailedSrc(src)}
        />
      ) : (
        <span aria-hidden="true">{empty ? "" : "?"}</span>
      )}
    </span>
  );
}
