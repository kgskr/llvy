## Context

Codex Security scan `ed4196b0-0a96-410c-a233-aa894da68f5f` reported three findings against the current LLVY MVP:

- `src/app/login/actions.ts` derives the login rate-limit key from raw `x-forwarded-for`, so rotating that header can create fresh buckets before password verification.
- `/api/process` accepts a caller-supplied `blobUrl` and passes the same URL to Blob deletion during duplicate/error cleanup, without proving that URL is the current upload's orphan.
- `parseStats()` accepts any non-empty `statsJson` array. A crafted authenticated replay can keep the file under the byte cap while creating excessive parser, transaction, JSONB storage, and data-integrity work.

The current app uses a single shared password, direct Vercel Blob uploads, synchronous `/api/process` ingestion, and Vercel Postgres/Blob. There is no per-user account model, queue, or background worker in the MVP.

## Goals / Non-Goals

**Goals:**
- Make login throttling resistant to attacker-controlled forwarded-header partitioning.
- Ensure `/api/process` only fetches and deletes Blob objects that belong to a fresh pending upload issued by this app.
- Reject replay metadata that exceeds supported MVP game shape or configured parser/ingestion budgets before expensive DB work begins.
- Add regression tests for the three reported findings.
- Preserve the current MVP user experience: shared-password login, direct Blob upload, synchronous processing, and game list/detail flows.

**Non-Goals:**
- Introduce member-specific login accounts, roles, or admin/user authorization tiers.
- Replace synchronous ingestion with a queue or worker.
- Implement a broad file quarantine/lifecycle manager beyond the ownership checks needed for safe processing and cleanup.
- Treat the scan-suppressed slash-backslash redirect and direct-upload orphan lifecycle candidates as required fixes in this change.

## Decisions

### 1. Login throttling uses a non-spoofable baseline key

The login flow SHALL stop using raw `x-forwarded-for` as the sole limiter partition. For the current small-club MVP, the safest baseline is a global pre-auth login bucket that is always enforced, optionally combined with a trusted client identity only when the deployment proves a non-spoofable source.

Rationale:
- A global bucket is conservative but reliable: header rotation cannot create a fresh key.
- The app has one shared password and low expected login volume, so temporary global lockout is an acceptable trade-off compared with bypassable throttling.
- A future production hardening step can move the same keying model to Vercel KV/Upstash or another shared store without changing the user-facing contract.

Alternatives considered:
- Trust `x-forwarded-for`: rejected because it is the reported issue.
- Remove IP-style partitioning entirely and keep only the 400ms failed-login delay: rejected because it weakens brute-force protection.
- Add per-member accounts immediately: rejected as outside the MVP scope.

### 2. Blob processing requires a pending-upload binding

The upload token route SHALL create a server-side pending upload record or signed pending-upload token containing:

- an unguessable upload id,
- an unguessable cleanup/process nonce,
- the expected Blob pathname or exact URL constraint,
- creation/expiry timestamps,
- processing state (`pending`, `processing`, `processed`, `failed`, or `expired`).

The client SHALL call `/api/process` with the Blob URL plus the pending upload id/nonce returned for that upload. `/api/process` SHALL reject Blob URLs that do not match an active pending upload. Cleanup SHALL delete only the exact Blob URL bound to that pending upload.

Rationale:
- The server's Blob token is more privileged than the browser. Cleanup must be authorized against server-issued upload state, not just hostname shape.
- Same-store public Blob URLs can be known outside the current request; hostname allowlisting is not ownership.
- Pending state also gives a clean place to expire abandoned uploads later, though full lifecycle cleanup remains optional.

Alternatives considered:
- Keep only `*.blob.vercel-storage.com` host validation: rejected because it proves destination class, not object ownership.
- Compare only `blobUrl` path prefix: insufficient without an unguessable pending token because known URLs can still be replayed.
- Disable cleanup entirely: reduces delete risk but leaves avoidable orphaned objects and does not prove safe processing ownership.

### 3. Replay ingestion enforces semantic budgets before DB work

The parser and ingestion pipeline SHALL enforce explicit limits independent of total file size:

- maximum participant count for supported MVP game modes (`10` by default),
- maximum `statsJson` string byte length,
- maximum raw participant object serialized size,
- maximum nested object/array depth for retained diagnostic JSON,
- maximum DB rows/account upserts per replay.

The parser SHALL reject over-budget metadata before returning participants to `ingestReplay()`. Ingestion SHALL validate the participant count again before starting a transaction. Arbitrary raw participant JSON SHALL either not be persisted or SHALL be reduced to a bounded allowlist of diagnostic fields.

Rationale:
- The 64MB route cap does not control nested JSON fanout, row count, or JSONB storage pressure.
- A ten-participant cap matches the MVP's current custom-game replay assumptions and the existing tests/spec wording.
- Enforcing the budget before transaction start avoids partially consumed DB work.

Alternatives considered:
- Rely on Vercel function duration/timeouts: rejected because timeouts are a failure mode, not a control.
- Keep raw `raw_stats` unchanged and only cap participant count: partial mitigation, but large nested raw fields can still amplify storage.
- Store no raw metadata at all: safest, but the MVP benefits from bounded diagnostics for parser drift and future migration.

## Risks / Trade-offs

- **Global login throttling can lock out legitimate users during a burst** -> keep limits configurable and show a clear retry message; revisit distributed/client-aware throttling after deployment ingress is verified.
- **Pending-upload state adds schema/API complexity** -> keep the table/token minimal and expire unused pending uploads; do not introduce full per-user auth.
- **Strict participant limits may reject unusual game modes** -> document MVP support for normal ten-player custom games and make the limit configurable for future modes.
- **Reducing raw JSON can limit future forensic/debug value** -> retain bounded diagnostic fields and preserve parse error messages without storing arbitrary attacker-controlled payloads.
- **Live Blob/Postgres behavior was not validated in the scan** -> run staging tests with disposable Blob objects and database rows before production rollout.

## Migration Plan

1. Add configuration constants for login throttle limits and replay ingestion budgets.
2. Add pending-upload storage or signed pending-upload token support before changing `/api/process` to require it.
3. Update the upload UI/API contract to pass pending upload id/nonce with the uploaded Blob URL.
4. Add parser and ingestion limit checks, then update tests to cover oversized `statsJson` and no-write failure behavior.
5. Deploy to staging with disposable Vercel Blob/Postgres resources and verify Blob deletion/readback and DB rollback behavior.
6. Roll back by reverting the API contract and pending-upload migration only if staging shows incompatible upload behavior before production data depends on the new state.

## Open Questions

All three were resolved during implementation:

- **Pending-upload state: Postgres table** (`pending_uploads`). The
  consumed-binding requirement ("a consumed binding MUST NOT authorize a later
  request") needs revocable server-side state, which a stateless signed token
  cannot provide. The nonce is stored as a SHA-256 hash only; the blob pathname
  `replays/<uploadId>.rofl` is deterministic (no random suffix) so process-time
  URL matching is exact. Rows are swept opportunistically on create (expired >
  1 day), avoiding a cron.
- **Numeric budgets** (defaults in `src/lib/limits.ts`, injectable for tests):
  10 participants, 4MB metadata, 256KB `statsJson` (checked before
  `JSON.parse`), 32KB per participant object, nesting depth 4, 256-char cap on
  retained string values. Real 10-player replays run ~40KB of statsJson with
  flat participant objects, so each cap has generous headroom.
- **`raw_stats`: bounded scalar allowlist** (kept, not removed): ~60 known stat
  fields, scalars only, oversized strings omitted. `games.raw_metadata` is
  reduced the same way to the four known top-level scalar fields. This keeps
  bounded diagnostics without persisting arbitrary replay-controlled JSON.
