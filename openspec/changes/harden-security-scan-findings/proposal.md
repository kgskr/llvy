## Why

Codex Security scan `ed4196b0-0a96-410c-a233-aa894da68f5f` reported three issues in the initial MVP: forwarded-header login throttle bypass, unbound Blob cleanup, and excessive replay-derived database work. This change records the current implementation of those controls and the subsequent shared-budget and abandoned-upload cleanup additions.

## What Changes

- Enforce login attempts per Vercel-normalized client IP with shared Postgres fixed-window counters; reject production login when trusted identity is unavailable.
- Bind Blob token issuance and `/api/process` fetch/cleanup to Postgres upload reservations with an unguessable id and nonce.
- Limit reservations to ten per session and fifty app-wide per 24-hour window.
- Reconcile expired uploads through a daily authenticated maintenance route, preserving every Blob referenced by a stored game.
- Bound participant count, input JSON size/depth, retained diagnostic fields, and ingestion work before transactions.
- Cover identity selection, atomic budgets, binding replay, safe deletion, parser limits, and cleanup recovery with regressions.

## Capabilities

### New Capabilities
- `access-control-hardening`: verified-client identity, shared login throttling, and missing-identity rejection.
- `blob-processing-ownership`: pending upload binding, reservation budgets, consumed-binding protection, and expired-upload reconciliation.
- `replay-ingestion-resource-limits`: parser, transaction, and diagnostic storage budgets.

### Modified Capabilities

The initial MVP is not archived into live `openspec/specs` yet. Its current documents describe the same bounded diagnostics and identity rules so the change artifacts do not contradict each other.

## Impact

- **Code**: login actions, `login-throttle.ts`, `trusted-client-ip.ts`, `request-budget.ts`, upload/token/process/maintenance routes, pending-upload store, expired-upload cleanup, parser, ingestion, auth, schema, and tests. The process-local `rate-limit.ts` is removed.
- **Data**: Postgres `pending_uploads`, `request_budgets`, and the cleanup claim timestamp.
- **API**: `/api/uploads` returns the binding and access mode; token/process requests present it. The maintenance endpoint uses `CRON_SECRET` instead of a session cookie.
- **Operations**: deploy the matching Drizzle migrations, environment variables, and daily Cron configuration. Current local code is not evidence that these later changes are deployed.
- **Validation**: local PostgreSQL-compatible integration tests and mocked Blob operations cover the controls. Earlier live upload/cleanup evidence is retained in the dated deployment record; current Cron and shared-budget production behavior still needs separate verification.
