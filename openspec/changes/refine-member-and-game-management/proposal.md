## Why

Member administration needs permanent deletion with protection for active administrators, and excluded games should not populate the unlinked-account queue. Game management should handle calendar dates and short comments, while growing administration tables need bounded pages.

## What Changes

- Permit administrators and owners to permanently delete non-administrator members, detach their accounts, and preserve game/audit history. Require owner revocation before deleting an administrator.
- Only show unlinked Riot accounts participating in active games; count only active games.
- **BREAKING** Store original/corrected game dates as PostgreSQL `date`, converting existing timestamps to their Korea calendar dates. Keep operational timestamps and game duration.
- Add one editable comment per game, at most 30 Unicode characters including spaces; administrators/owners edit and viewers read.
- Independently paginate member and unlinked-account tables in administration, ten rows per page; account-link selectors still include every member.

## Capabilities

### New Capabilities

- `member-administration`: Protected permanent deletion, active-game account queue and paginated administration.
- `game-calendar-and-comment`: Date-only persistence/migration and role-protected game comments.

### Modified Capabilities

None; prior unarchived changes remain historical context.

## Impact

DB schema/migrations, member and game mutations/queries, replay ingestion, server actions, role-aware screens, transactional audit, regression tests and deployment documentation. No new dependencies.
