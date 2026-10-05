## ADDED Requirements

### Requirement: Protected permanent member deletion
The system SHALL allow admins and owners to permanently delete non-administrator members, detach their Riot accounts, remove revoked credentials, and preserve games and historical audits. It MUST reject deletion while any active administrator credential exists and atomically audit deletion and detached links.

#### Scenario: Delete a former administrator
- **WHEN** an owner revokes a member's administrator credential and an admin deletes that member
- **THEN** the member row and revoked credentials are deleted, account links are cleared, and historical game/audit data remains

#### Scenario: Active administrator deletion is blocked
- **WHEN** an admin or owner requests deletion of a member with an active credential
- **THEN** no member, credential or account link is changed

#### Scenario: Audit failure rolls deletion back
- **WHEN** deletion cannot store its audit records
- **THEN** the member and account links remain unchanged

### Requirement: Active-game unlinked account queue
The system SHALL list/count unlinked Riot accounts only if they participate in at least one non-excluded game, with game counts based only on non-excluded games.

#### Scenario: Account only in excluded games
- **WHEN** all games containing an unlinked account are excluded
- **THEN** it is absent from the queue and total count until a game is restored

### Requirement: Independently paginated administration tables
The system SHALL paginate the member and unlinked-account tables independently at ten rows per page with stable ordering, complete linked-account lists, accurate totals, validated/clamped page parameters and all-member account-link options.

#### Scenario: Navigate one table
- **WHEN** the user changes the member page while viewing the second account page
- **THEN** the member table changes, the account page remains second, and members on other pages remain selectable for account linking

#### Scenario: Removal shrinks the last page
- **WHEN** deletion or linking reduces the total below the requested page
- **THEN** rendering clamps to the last valid page without an empty out-of-range table
