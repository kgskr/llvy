## ADDED Requirements

### Requirement: Business changes and cache revisions commit atomically

The system SHALL store authoritative cache revisions in PostgreSQL and increment affected scopes in the same transaction as the business change. Scope updates SHALL be deduplicated and use a consistent lock order after existing authority and business locks. A rollback MUST roll back both business changes and revisions. Redis writes MUST NOT be required for a committed change to become distinguishable from earlier cached data.

#### Scenario: Redis is unavailable during a successful mutation

- **WHEN** a member rename commits while Redis writes are unavailable
- **THEN** the member revision SHALL commit with the rename, the mutation SHALL succeed, and later requests SHALL select the new revision even after Redis recovers with older entries intact

#### Scenario: Transaction rolls back

- **WHEN** a business transaction fails after attempting revision updates
- **THEN** neither the business changes nor revision changes SHALL persist

#### Scenario: Concurrent changes overlap in scope

- **WHEN** multiple authorized transactions affect overlapping cache scopes
- **THEN** revision updates SHALL not be lost and SHALL follow the documented authority, business and sorted revision lock order

### Requirement: Cache reads use current dependency revisions

The system SHALL authorize each read before cache access and fetch its required authoritative revisions from PostgreSQL. The system SHALL batch required scope reads and reuse identical revision reads only within the current read request. Cache identity SHALL include environment and database identity, schema namespace, policy epoch, query version, canonical arguments and the complete dependency revision vector. Query-result identities SHALL additionally separate roles; autocomplete indices SHALL preserve their existing role-invariant minimal projection and sharing after authorization. Revision values MUST preserve integer precision. A fill SHALL retain the revisions captured before its loader started. Missing required metadata or a failed revision lookup SHALL bypass shared cached values; database loader failures SHALL remain errors.

#### Scenario: A fill overlaps a mutation

- **WHEN** a loader starts with revision r1 and finishes after a mutation commits r2
- **THEN** its fill SHALL use only r1 and a request beginning after the commit SHALL select r2

#### Scenario: Revision lookup fails

- **WHEN** Redis has a cached value but the current dependency revisions cannot be verified
- **THEN** the application SHALL query business data directly instead of trusting the cached value

#### Scenario: A revision exceeds JavaScript safe integer precision

- **WHEN** the database returns a revision larger than the maximum exactly representable JavaScript integer
- **THEN** key construction and equality checks SHALL preserve the exact revision value

### Requirement: Invalidation follows data dependencies

The system SHALL maintain separate scopes for member directory data, account display and linkage data, game lists, individual games, member history and Riot account search eligibility. Reads SHALL include every scope affecting their projected DTO, including account display changes in other members' historical game rosters. Both active and excluded game-list caches SHALL depend on game-list, member and account revisions because their rosters resolve current linked-member names. Successful no-op mutations, duplicate replay ingestion, upload reservation and audit-only operations MUST NOT invalidate business cache scopes. Game comment changes SHALL affect game lists and that game's detail without invalidating autocomplete or member history. Member autocomplete SHALL depend on member and account directory changes; Riot autocomplete SHALL depend on account and active-history eligibility changes.

#### Scenario: Upload is reserved without storing a game

- **WHEN** an upload reservation and its audit record commit
- **THEN** existing game, member, history and autocomplete cache revisions SHALL remain unchanged

#### Scenario: Comment is edited

- **WHEN** a game's comment changes
- **THEN** the game-list and target game revisions SHALL change while both autocomplete snapshots and member-history caches remain reusable

#### Scenario: An opponent changes their Riot ID

- **WHEN** an accepted account rename is persisted by replay ingestion
- **THEN** subsequent requests for previously cached games and member-history rosters containing that account SHALL use the new account revision

#### Scenario: An older replay does not change the accepted Riot ID

- **WHEN** account upsert retains its existing display fields under the established name-observation ordering
- **THEN** it SHALL not increment the account-directory revision solely because an upsert was attempted

#### Scenario: Cached game rosters change their displayed identity

- **WHEN** a member is renamed or deleted, or an account is linked, unlinked or moved between members
- **THEN** subsequent active and excluded game-list reads SHALL display the current member name or unlinked Riot ID using updated member/account revisions even if the game-list revision itself is unchanged

### Requirement: Cache activation is safe across writer versions and restores

Long-lived revision-based cache reads SHALL remain disabled until all active writers maintain the required revisions. Activation SHALL establish a new policy epoch. Deployments with legacy readers SHALL retain legacy invalidation until those readers are retired. Before rolling back to writers without revision support, operators SHALL disable revision-based cache reads. Database restore and subsequent reactivation SHALL establish a fresh epoch so restored revision numbers cannot reuse unrelated cached values. Reverting to a legacy reader SHALL also isolate or expire its previous cache namespace.

#### Scenario: Mixed writer versions are still active

- **WHEN** an older deployment or administrative writer can change business data without recording revisions
- **THEN** long-lived revision-based cache reads SHALL remain disabled

#### Scenario: Database snapshot is restored

- **WHEN** the database returns to earlier revision values while Redis retains newer cache entries
- **THEN** a new epoch SHALL prevent cache reuse across the restore boundary before revision-based reads resume
