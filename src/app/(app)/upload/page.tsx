"use client";

import { upload } from "@vercel/blob/client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

import { MAX_UPLOAD_BYTES } from "@/lib/limits";

type Result =
  | { kind: "idle" }
  | { kind: "uploading"; progress: number }
  | { kind: "processing" }
  | { kind: "done"; gameId: string; duplicate: boolean }
  | { kind: "error"; message: string };

type PendingUploadBinding = {
  uploadId: string;
  nonce: string;
  pathname: string;
  access: "public" | "private";
};

export default function UploadPage() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [result, setResult] = useState<Result>({ kind: "idle" });

  const busy = result.kind === "uploading" || result.kind === "processing";

  function goToLogin() {
    router.push(`/login?redirectTo=${encodeURIComponent("/upload")}`);
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    const file = inputRef.current?.files?.[0];
    if (!file) {
      setResult({ kind: "error", message: "리플레이 파일을 선택하세요." });
      return;
    }
    if (!file.name.toLowerCase().endsWith(".rofl")) {
      setResult({
        kind: "error",
        message: ".rofl 파일만 업로드할 수 있습니다.",
      });
      return;
    }
    if (file.size === 0 || file.size > MAX_UPLOAD_BYTES) {
      setResult({
        kind: "error",
        message: `비어 있지 않은 ${MAX_UPLOAD_BYTES / 1024 / 1024}MB 이하의 파일을 선택하세요.`,
      });
      return;
    }

    try {
      setResult({ kind: "uploading", progress: 0 });

      // 1) Get a pending-upload binding: the server reserves a blob pathname
      //    and the { uploadId, nonce } pair that authorizes it end-to-end.
      const beginResponse = await fetch("/api/uploads", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ filename: file.name }),
      });
      if (beginResponse.status === 401) {
        goToLogin();
        return;
      }
      const binding = (await beginResponse.json()) as PendingUploadBinding & {
        error?: string;
      };
      if (
        !beginResponse.ok ||
        !binding.uploadId ||
        !binding.nonce ||
        (binding.access !== "public" && binding.access !== "private")
      ) {
        throw new Error(binding.error ?? "업로드를 시작하지 못했습니다.");
      }

      // 2) Direct upload to the reserved pathname; the binding rides along as
      //    clientPayload so the token route can verify it.
      const blob = await upload(binding.pathname, file, {
        access: binding.access,
        handleUploadUrl: "/api/blob/upload",
        contentType: "application/octet-stream",
        clientPayload: JSON.stringify({
          uploadId: binding.uploadId,
          nonce: binding.nonce,
        }),
        onUploadProgress: (event) =>
          setResult({ kind: "uploading", progress: event.percentage }),
      });

      setResult({ kind: "processing" });
      // 3) Process the uploaded blob, proving ownership with the binding.
      // Guard against a silently stalled connection (server maxDuration is 60s).
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 70_000);
      let response: Response;
      try {
        response = await fetch("/api/process", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            uploadId: binding.uploadId,
            nonce: binding.nonce,
            blobUrl: blob.url,
            originalFilename: file.name,
            lastModified: file.lastModified,
          }),
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timeout);
      }

      if (response.status === 401) {
        goToLogin();
        return;
      }

      const data = (await response.json()) as {
        gameId?: string;
        duplicate?: boolean;
        error?: string;
      };

      if (!response.ok || !data.gameId) {
        throw new Error(data.error ?? "리플레이 처리에 실패했습니다.");
      }

      setResult({
        kind: "done",
        gameId: data.gameId,
        duplicate: Boolean(data.duplicate),
      });
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        setResult({
          kind: "error",
          message: "처리 시간이 초과되었습니다. 잠시 후 다시 시도해 주세요.",
        });
        return;
      }
      const message =
        error instanceof Error ? error.message : "업로드에 실패했습니다.";
      // The Blob upload-token request is auth-gated; a session that expired
      // mid-flow surfaces here as an auth error.
      if (/unauthor|401/i.test(message)) {
        goToLogin();
        return;
      }
      setResult({ kind: "error", message });
    }
  }

  return (
    <section className="card stack">
      <div>
        <h1>리플레이 업로드</h1>
        <p className="muted">
          League 클라이언트에서 내려받은 .rofl 파일을 올리면 게임 정보와 참가자
          전적을 추출해 저장합니다.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="stack">
        <div className="field">
          <label htmlFor="replay">리플레이 파일 (.rofl)</label>
          <input
            ref={inputRef}
            id="replay"
            type="file"
            accept=".rofl"
            disabled={busy}
          />
          <p className="form-note">최대 {MAX_UPLOAD_BYTES / 1024 / 1024}MB</p>
        </div>
        <button type="submit" className="button" disabled={busy}>
          {busy ? "처리 중…" : "업로드"}
        </button>
      </form>

      {result.kind === "uploading" ? (
        <p className="muted">업로드 중… {Math.round(result.progress)}%</p>
      ) : null}
      {result.kind === "processing" ? (
        <p className="muted">파싱 및 저장 중…</p>
      ) : null}
      {result.kind === "error" ? (
        <p className="form-error" role="alert">
          {result.message}
        </p>
      ) : null}
      {result.kind === "done" ? (
        <p>
          {result.duplicate ? "이미 저장된 리플레이입니다. " : "저장 완료! "}
          <Link href={`/games/${result.gameId}`}>게임 보기 →</Link>
        </p>
      ) : null}
    </section>
  );
}
