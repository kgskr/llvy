## Context

Codex Security scan `ed4196b0-0a96-410c-a233-aa894da68f5f` originally reported raw forwarded-header login throttling, unbound Blob cleanup, and unbounded replay participant work. Those are historical scan observations, not descriptions of the current implementation.

The current local app uses shared-password login, signed session cookies, direct Vercel Blob upload, synchronous processing, and Postgres-backed upload bindings and request budgets. A daily maintenance route reconciles expired uploads. There are no per-member login accounts or ingestion queue. Production evidence from 2026-10-04 is recorded separately in `docs/validation/2026-10-04-production-deployment.md`; it does not establish deployment of later local changes.

## Goals / Non-Goals

**Goals:**
- Limit login attempts by platform-verified IP using atomic counters shared across server instances.
- Bind Blob token issuance, processing, and deletion to a server-reserved upload path and secret nonce.
- Bound parser and transaction work before database writes.
- Bound daily upload reservations and reconcile abandoned uploads without deleting committed replay originals.
- Preserve shared-password login and direct-upload/synchronous-ingestion flows.

**Non-Goals:**
- Per-member authentication, roles, or authorization tiers.
- Queued ingestion or automatic retry of abandoned processing.
- A global login bucket that allows one IP to lock out other clients.
- Arbitrary Blob cleanup outside server-reserved pending-upload paths.

## Decisions

### 1. Login throttling uses a platform-verified IP and shared Postgres counters

`trustedClientIp()` uses a valid IP from `x-vercel-forwarded-for` only when `VERCEL=1`. Raw `x-forwarded-for` is ignored. Production without a trusted identity rejects login before password verification; it does not fall back to a global bucket. Non-production outside Vercel uses the fixed `local-development` identity.

`checkLoginThrottle()` consumes an atomic `request_budgets` counter keyed by a SHA-256 hash of the client IP. The default permits ten login attempts per 60-second fixed window. All admitted attempts, including successful and empty-password submissions, consume the budget. An exhausted budget prevents password verification. Wrong-password responses have a 400ms delay. One IP's exhausted budget does not exhaust another IP's budget.

A global login lockout was replaced with per-IP counters to avoid cross-client lockouts. The trade-off is that distinct actual IPs receive separate budgets. Deployment correctness depends on Vercel normalizing the trusted header; local tests do not prove ingress behavior on an arbitrary host.

### 2. Blob processing requires a Postgres pending-upload binding

Authenticated `POST /api/uploads` accepts a `.rofl` filename, consumes upload reservation budgets, and creates a `pending_uploads` row. Its response is `{uploadId, nonce, pathname, access}`. The nonce has 256 bits of randomness, is returned once, and is stored only as a SHA-256 hash. The path is `replays/<uploadId>.rofl`. Upload-token issuance remains in `/api/blob/upload`, which verifies the session, pending state, expiry, nonce, and exact pathname. Random suffixes and overwrites are disabled. Maximum file size is 64MiB.

The browser sends `{uploadId, nonce, blobUrl, originalFilename, lastModified}` to `/api/process` with its session cookie. Processing validates the store origin derived from the configured Blob token and access mode, the exact reserved pathname, and the nonce before fetching or deleting. It uses a canonical URL without caller-provided query or fragment aliases. An atomic pending-to-processing claim allows only one processor. Successful and duplicate handling ends as `processed`; terminal failure ends as `failed`. Any non-pending or expired binding is rejected. Expiry is a timestamp check, not a separately persisted `expired` state.

Private reads send the Blob credential only to the validated canonical object. Redirects and caching are disabled. The entire download/body read has a 20-second timeout; the processing route has a 60-second execution limit. Processing downloads the entire file rather than using Range requests. Duplicate and failure cleanup target only the bound upload, and committed original Blobs are preserved when the transaction outcome or bookkeeping is uncertain.

### 3. Upload reservations use shared fixed-window budgets

Each signed session token receives ten reservations per 24-hour fixed window and the whole app receives fifty. Both counters are consumed atomically; a rejected budget transaction consumes neither. Counters live in `request_budgets`, and session identifiers are hashed. `POST /api/uploads` returns HTTP 429 on budget exhaustion. Reservations count even if the browser abandons the upload. A new login issues a new session token, while the app-wide budget still applies.

Pending bindings expire after 30 minutes. The shared budget transaction and subsequent pending-row insertion are separate; a later insertion failure does not refund an already consumed reservation budget.

### 4. Daily maintenance reconciles expired uploads

`vercel.json` schedules `GET /api/maintenance/uploads` daily at 03:00 UTC (12:00 Korea time). The proxy exempts this exact endpoint from session authentication; the route requires `Authorization: Bearer <CRON_SECRET>` and rejects requests when the configured secret is absent or mismatched.

`reconcileExpiredUploads()` selects at most fifty bindings whose expiry is more than 24 hours old. Each row is atomically claimed as `cleaning` with `cleanup_claimed_at`; a claim older than ten minutes can be reclaimed. A canonical Blob URL referenced by a stored game is never deleted. Otherwise the cleanup lists the exact reserved path in the configured store, verifies its canonical URL, and deletes only that object. After successful reconciliation it deletes the pending row. Failure retains the row for retry, normally resetting it to `failed` and clearing the claim; stale claims allow recovery if resetting fails. Old request-budget rows are also removed after the same 24-hour grace.

Cleanup is scheduled, not opportunistic during reservation creation. It does not re-ingest abandoned uploads. A backlog can require multiple daily batches to drain.

### 5. Replay parsing and ingestion enforce semantic budgets

Defaults in `src/lib/limits.ts` are injectable for tests:
- Ten participants per replay.
- 4MiB decoded metadata and 256KiB nested `statsJson` text, checked before parsing that text.
- 32KiB per participant object and nesting depth four.
- At most 256 characters in retained diagnostic string values.

The parser rejects oversized metadata before returning participants. Ingestion revalidates participant and retained-JSON budgets before starting a transaction. Participant accounts are resolved in consistent identity order to reduce lock-order conflicts. Only rolled-back deadlock/serialization failures (`40P01`/`40001`) are retried; uncertain outcomes are not assumed safe to delete or retry. A known content hash short-circuits parsing and participant database work.

`raw_stats` contains a bounded scalar allowlist of known fields. `raw_metadata` contains four known top-level scalar fields. Unknown or nested diagnostics and oversized retained strings are omitted; oversized input objects are rejected according to parser budgets. Full raw JSON is not stored in JSONB. The original replay file remains in Blob storage.

## Risks / Trade-offs

- Verified-IP dependence means unsupported production hosting or a missing trusted header blocks login. No global fallback is implemented.
- IP counters count successful attempts too; shared NAT clients share one login budget.
- Session upload budgets can be renewed by logging in again; the global reservation budget remains the shared ceiling.
- Cron configuration and `CRON_SECRET` must be deployed for scheduled cleanup. Code and mocked Blob tests alone do not prove a live scheduled execution.
- Strict ten-participant and JSON budgets reject unsupported or oversized replay shapes.
- Bounded diagnostics do not support reconstructing arbitrary original stats from JSONB; use the retained Blob file.

## Migration Plan

Apply Drizzle migrations in order. Pending bindings were added by the earlier hardening migration. The current `0003_ambiguous_human_cannonball.sql` adds `request_budgets` and `pending_uploads.cleanup_claimed_at`. Deploy the matching application, `CRON_SECRET`, and `vercel.json` schedule together. Session payloads include an issuance timestamp and random nonce; rotating either shared password or signing secret invalidates sessions.

The 2026-10-04 deployment record verifies the earlier three migrations and upload/game flows, not the later fourth migration or new daily maintenance behavior. Recheck deployment, migration application, normalized ingress, and cleanup with disposable data before marking the current follow-up operationally verified.

## Resolved implementation choices

- Revocable Postgres pending rows, not stateless signed upload bindings.
- Shared Postgres fixed-window counters, not process-local rate-limit maps.
- Verified-IP login limits without a global fallback.
- Daily claimed cleanup with canonical-file preservation, not on-create row sweeping.
- Bounded diagnostic allowlists, not complete replay JSON retention.
