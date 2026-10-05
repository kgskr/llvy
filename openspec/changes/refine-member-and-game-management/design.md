## Context

The application already has viewer/admin/owner sessions, transactional mutation audits, replay ingestion, date overrides and reversible exclusion. Member accounts use `ON DELETE SET NULL`; administrator credentials currently restrict member deletion. Game dates are timestamps rendered in Korea time.

## Goals / Non-Goals

**Goals:** Implement the four requested administration improvements without weakening role enforcement, audit atomicity or historical game statistics.

**Non-Goals:** Bulk removal, deleting Riot accounts/replays, multiple comments or comment authorship threads.

## Decisions

- Delete through the audited member mutation service. Lock the member row (also used by grants), reject any active credential, detach linked accounts/reset linked timestamps, remove revoked credential rows, and delete the member in one transaction. Preserve audit snapshots and games. Active administrators cannot be deleted even by owners.
- Acquire target member locks before account locks in linking to match deletion and avoid a delete/link lock cycle. Existing revocation retains credential-before-member ordering.
- Use PostgreSQL `date` with Drizzle string mode for both original date and override. Convert old timestamps using `AT TIME ZONE 'Asia/Seoul'` before casting, preserving the date users previously saw. Convert file/upload instants to the same calendar date on ingestion. Leave uploaded/excluded/audit timestamps and duration unchanged.
- Keep one nullable comment column with a PostgreSQL `char_length <= 30` check. Validate Unicode code-point count server-side, preserve whitespace, and use null for an empty string. The UI has one replaceable value; empty input clears it. Comment changes use audited admin mutations; viewers receive read-only text.
- Query member IDs before joining accounts so ten members remain ten complete member rows. Use active-game joins for the unlinked queue/count. Independent `memberPage`/`accountPage` URL parameters are validated/clamped, preserving the other table's position. Link selectors fetch all member IDs/names separately.

## Risks / Trade-offs

- [Time detail is irreversibly removed] → Back up before migration; date casting is explicit and tested across Korea midnight and overrides.
- [Concurrent grant/delete or link/delete] → Share the member row lock and enforce the active-credential check inside the transaction. Verify rollback on audit failures; actual multi-connection locking remains a Preview check.
- [Supplementary Unicode characters differ from UTF-16 length] → Use code-point counting matching PostgreSQL `char_length`, with tests for spaces, Hangul and emoji.
- [Page changes after removal/linking] → Recount and clamp pages on every render.

## Migration Plan

Back up, migrate Preview with the appended migration, deploy the matching application, then verify dates/comments, deletion protection and independent pages. Apply the same order to production. A rollback cannot recover removed time precision without the backup.

## Open Questions

None. A comment is a shared per-game value; admin/owner edits and viewers read it.
