## MODIFIED Requirements

### Requirement: Member autocomplete follows shared cache lifecycle and authorization

The member index SHALL occupy a separate versioned namespace from the Riot index and use the authoritative member and account directory revisions. The Riot index SHALL use account and active-history eligibility revisions. Both indices SHALL use an initial six-hour retention policy with bounded plus-or-minus 10 percent jitter after revision-based cache activation. Every key within one snapshot SHALL share one expiration deadline. The system SHALL publish complete snapshots atomically, treat partial/corrupt snapshots as misses, coalesce concurrent local builds and prevent an old build from filling a different revision identity. Index construction SHALL avoid per-member account queries. Committed member creation/rename/deletion, account linking/unlinking/renaming and game ingestion/exclusion/restoration SHALL update applicable revision scopes according to each source's data dependencies; rollback SHALL NOT publish new revisions. Missing or unavailable Redis SHALL fall back to DB with equivalent matching, ordering and limits. The server SHALL authenticate before any index access. A failure to load either database source SHALL return an autocomplete error rather than a partial success response. Existing legacy request/response shapes, current navigation resolution, Unicode normalization and access-control requirements SHALL remain unchanged.

#### Scenario: Renaming with a warm cache

- **WHEN** an authorized member rename commits after the old name was cached
- **THEN** subsequent requests SHALL use the new member revision, offer the new name and ignore late fills from the old revision

#### Scenario: Unauthenticated request with warm indexes

- **WHEN** a caller lacks a current valid session but matching suggestions are cached
- **THEN** the API SHALL return 401 before querying either index or exposing suggestions

#### Scenario: Cache unavailable

- **WHEN** Redis is missing or unavailable but PostgreSQL is healthy
- **THEN** both suggestion types SHALL use equivalent DB fallback results and final navigation SHALL remain functional

#### Scenario: Unrelated comment or reservation

- **WHEN** a game comment changes or an upload reservation commits without changing search-source data
- **THEN** both autocomplete snapshots SHALL remain reusable without rebuilding

#### Scenario: Game eligibility changes without directory changes

- **WHEN** a game is excluded and account display and member directory data remain unchanged
- **THEN** the Riot eligibility revision SHALL change while the member directory snapshot SHALL remain reusable

#### Scenario: Empty directory is queried repeatedly

- **WHEN** the complete source dataset is empty and its revisions are unchanged
- **THEN** the system SHALL reuse a valid empty snapshot for the configured index retention period

## ADDED Requirements

### Requirement: Index build coordination has bounded ownership

Automatic index reconstruction across instances SHALL use a revision-keyed expiring lease with a unique owner token. Publication and release SHALL atomically check current ownership so an expired builder cannot overwrite or release a successor's work. A waiter SHALL use a published valid snapshot or fall back within the query-cache coordination budget. Lease failure MUST NOT block business availability or serve data from an older revision. Local fallback loads SHALL be coalesced where their full identities match. A failed or terminated builder SHALL leave only bounded-lifetime temporary data.

#### Scenario: Builder loses its lease

- **WHEN** a paused builder resumes after its lease has expired and another builder owns reconstruction
- **THEN** the old builder SHALL neither publish over the new owner's snapshot nor delete its lease

#### Scenario: Another instance is still building

- **WHEN** an index is not available within the permitted coordination wait
- **THEN** the request SHALL return equivalent database results without waiting for the remote builder indefinitely

### Requirement: Index publication can follow the response lifecycle

After obtaining a validated database snapshot, the system SHALL support publishing its index through a supported response-lifecycle callback so publication need not delay the response. The callback SHALL retain the captured revisions, projection and valid ownership checks. Standalone execution without lifecycle support SHALL use awaited publication. Failure or cancellation of deferred publication MUST NOT affect returned database results or make old revisions current. Independent reads SHALL be batched where possible while preserving each source's complete-snapshot validation.

#### Scenario: Deferred publication fails

- **WHEN** the application returns database suggestions and the subsequent index publication fails
- **THEN** the response SHALL remain valid and a later request SHALL be able to reconstruct a complete snapshot under its current revisions
