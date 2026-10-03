"use client";

import { useEffect } from "react";

export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <section className="card stack">
      <h1>문제가 발생했습니다</h1>
      <p className="muted">
        페이지를 불러오는 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.
      </p>
      <div>
        <button type="button" className="button" onClick={reset}>
          다시 시도
        </button>
      </div>
    </section>
  );
}
