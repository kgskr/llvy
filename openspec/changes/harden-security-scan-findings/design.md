## Context

This change introduced trusted ingress identity, pending-upload ownership and bounded replay processing. Its implementation is consolidated in [access control](../../specs/access-control-hardening/spec.md), [Blob ownership](../../specs/blob-processing-ownership/spec.md) and [resource limits](../../specs/replay-ingestion-resource-limits/spec.md). Production verification tasks 6.9 and 6.10 remain open.

Later Discord authentication superseded shared-password login and session-scoped upload budgets. The completed task entries retain that development history; current behavior follows the main specs.

## Decisions

- Trust only Vercel's normalized client IP in production. PostgreSQL counters enforce per-IP and global OAuth budgets before provider work.
- Bind uploads to the current administrator/owner account and grant, an unguessable nonce and the exact reserved Blob pathname. Check current authority again at final persistence.
- Apply account and application reservation budgets across repeated logins. Budget consumption precedes reservation insertion; later insertion failure does not refund the allowance.
- Permit only one processing claim. Terminal or expired bindings cannot authorize later processing. Duplicate/error cleanup must preserve the canonical Blob referenced by a stored game.
- Reconcile abandoned uploads through authenticated bounded maintenance with reclaimable cleanup claims. Failed objects remain retryable.
- Bound participant count, decoded metadata, nested JSON, retained diagnostics and transaction work before writes. Store only the diagnostic allowlist while retaining the original replay in Blob storage.
- Limit each trimmed PUUID, Riot game name and tag line to 512 UTF-8 bytes in the parser and revalidate before the ingestion transaction. This fixed storage ceiling is independent of injectable diagnostic budgets: the PUUID B-tree key stays within 512 bytes and the legacy name/tag composite within 1,024 bytes, leaving room for index tuple overhead. The normalized name index uses hashing. Reject oversized identities with `RoflParseError`, never truncate them or change identity matching; missing PUUID and empty legacy tag lines remain supported.
- Both browser and desktop processing must record an `invalid_replay` failure with the actor, reserved filename and computed SHA-256 and terminate the reservation. Browser processing attempts bound Blob cleanup immediately; desktop processing delegates deletion to existing bounded maintenance after expiry. No game, Riot account or participant records may be written. Existing duplicate hash short-circuit behavior is unchanged.

Normalized game versions and champion names have a fixed 256 UTF-8 byte ceiling after the parser's existing trimming. Original filenames retain their supplied text with a 1,024 UTF-8 byte ceiling, allowing the desktop contract's 255 UTF-16 code units without changing that contract. Reject oversized values with `RoflParseError` instead of truncation. Validate replay fields in the parser and again before the write transaction; validate filenames before the duplicate branch because duplicate audits also consume this input. Existing browser/desktop failure audit, bound cleanup and hash-deduplication behavior remain intact.

## Remaining verification

Confirm the required schema, CRON_SECRET and schedule on the target deployment, then observe real cleanup. Verify normalized ingress identity and shared budgets using actual PostgreSQL connections. Existing local and historical deployment results do not establish those observations. Deleted dated reports remain available in Git history.
