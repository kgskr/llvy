## Why

Codex Security repository scan `ed4196b0-0a96-410c-a233-aa894da68f5f` completed with 3 reportable findings: two medium-severity controls around login throttling and replay ingestion resource limits, plus one low-severity Blob cleanup authorization issue. These findings affect the MVP's core trust boundaries, so they should be tracked as an explicit OpenSpec hardening change before implementation.

## What Changes

- Harden the shared-password login throttle so attacker-controlled forwarded headers cannot partition rate-limit buckets.
- Bind `/api/process` Blob fetch and cleanup to a server-tracked pending upload or equivalent nonce, so caller-supplied known Blob URLs are not deleted with app Blob authority.
- Add semantic replay parsing and ingestion budgets for `statsJson` participant count, nested/raw JSON size, field size, and per-upload DB work before starting expensive transactions.
- Reduce persistence of arbitrary replay-controlled raw participant JSON where a normalized allowlist is sufficient.
- Add regression tests for the three reported scan findings.
- Leave the scan-suppressed slash-backslash redirect and direct-upload orphan lifecycle findings out of required scope, except where the Blob ownership design naturally improves orphan handling.

## Capabilities

### New Capabilities
- `access-control-hardening`: login and shared-password security controls, including trusted rate-limit identity and bypass-resistant throttling.
- `blob-processing-ownership`: upload-processing ownership, pending-upload binding, and safe Blob cleanup behavior for `/api/process`.
- `replay-ingestion-resource-limits`: parser, replay metadata, transaction, and storage limits for replay ingestion.

### Modified Capabilities
<!-- Existing live specs are not archived under openspec/specs yet; this change adds follow-up hardening capabilities instead of mutating the completed replay-ingestion-mvp artifacts. -->

## Impact

- **Affected code**: `src/app/login/actions.ts`, `src/lib/rate-limit.ts`, `src/app/api/blob/upload/route.ts`, `src/app/api/process/route.ts`, `src/lib/rofl/parser.ts`, `src/lib/ingest.ts`, `src/db/schema.ts`, and related tests.
- **Data model**: may require a pending-upload table or signed upload token metadata, plus possible schema changes if raw replay JSON is reduced or bounded.
- **APIs**: `/api/blob/upload` and `/api/process` request/response contracts may gain an upload identifier, nonce, or ownership token.
- **Validation**: targeted tests should reproduce the scan cases: rotated `x-forwarded-for`, same-store Blob URL cleanup, and oversized `statsJson` participant arrays under the byte cap.
- **Operational note**: live Vercel Blob deletion/readback and Postgres threshold behavior still require staging validation with disposable resources.
