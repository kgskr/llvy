## MODIFIED Requirements

### Requirement: Expiration and mutation invalidation

Query results SHALL use named retention policies after current authoritative dependency revisions have been verified. The member-list snapshot, including its embedded linked-account information, SHALL have an exact 24-hour (86,400-second) TTL without jitter. Initial base TTLs SHALL be 30 minutes for game lists and separately cached history linked-account lists, 6 hours for game details, 1 hour for member-history aggregates, 30 minutes for member-history pages and 5 minutes for admitted nickname substring searches. Null single-resource results SHALL use a fixed 30-second TTL where their dependency revisions can be verified. Non-null query-result policies other than the member-list policy SHALL receive a bounded plus-or-minus 10 percent jitter once at fill time; reads MUST NOT extend expiration. Entries SHALL carry a validated schema version and absolute expiry. Successful business commits SHALL update only applicable authoritative revision scopes. A query that began with older revisions MUST NOT populate a newer revision key. Failed transactions MUST NOT invalidate successful cached data. Cache errors after commit MUST NOT turn a completed database mutation into an application failure. Legacy deployments SHALL retain their existing 60-second policy during transition; new revision-aware readers SHALL bypass shared caches while their policy is disabled.

#### Scenario: Mutation races a cache fill

- **WHEN** a query starts before a successful mutation and finishes after its revision update
- **THEN** its cache write SHALL belong only to the captured old revisions and later requests SHALL use the new revisions

#### Scenario: Redis rejects invalidation

- **WHEN** PostgreSQL commits data and revisions while Redis rejects writes
- **THEN** the mutation SHALL still succeed and later cache reads SHALL use the authoritative committed revisions rather than waiting for old entries to expire

#### Scenario: A user returns after several minutes

- **WHEN** a valid cached game detail is requested ten minutes later with unchanged dependency revisions
- **THEN** the business loader SHALL not run and the existing entry's absolute expiration SHALL not be extended

#### Scenario: Cached absence becomes a resource

- **WHEN** a cacheable null result is followed by a resource creation changing its existence dependency
- **THEN** subsequent requests SHALL not use the prior null result even if its short TTL has not elapsed

#### Scenario: Member list is revisited within one day

- **WHEN** a valid member-list entry with unchanged member and account revisions is read before its 24-hour deadline
- **THEN** it SHALL be reused without a business reload or extension of its expiration, and SHALL become expired at that deadline

#### Scenario: Member or linked account changes during the day

- **WHEN** a member name, birth year, deletion, account link or accepted Riot ID change commits while the previous member-list entry is unexpired
- **THEN** subsequent reads SHALL use the new dependency revisions immediately while preserving role projection and excluding birth years from viewer results

### Requirement: Cache failures fail fast

The system SHALL bound Redis connection, readiness and individual command waits to 100ms, disconnect the failed shared client and use the existing database fallback without replaying commands. The system SHALL retain the five-second retry cooldown and current authentication and projection contracts. Redis connection, cache-read and lease-coordination waits SHALL additionally have a cumulative 150ms budget, excluding authorization, revision and business database execution. These database costs SHALL be measured separately and the Redis budget MUST NOT be reported as a total API latency bound. Distributed build coordination SHALL wait at most 50ms within that budget before falling back. The system MUST NOT add cache-version database lookups when shared caching is absent or already bypassed.

#### Scenario: Redis accepts a connection but never becomes ready

- **WHEN** Redis readiness stalls
- **THEN** callers SHALL fall back after the 100ms readiness deadline instead of waiting one second

#### Scenario: A ready Redis stops replying

- **WHEN** a cache command does not complete before its deadline
- **THEN** the database loader SHALL run once for that fallback operation and requests during the cooldown SHALL not reconnect

#### Scenario: Individually bounded commands accumulate

- **WHEN** cache reads and coordination would cumulatively exceed their 150ms wait budget
- **THEN** the request SHALL stop waiting for cached data and proceed to the bounded fallback path

## ADDED Requirements

### Requirement: Concurrent identical query loads are shared

Within one instance, simultaneous misses for the same complete authorized cache identity SHALL share a pending loader. Different roles, arguments, database environments, epochs or dependency revisions MUST NOT share pending results. The pending registry SHALL have a bounded size and remove settled entries after success or failure. Sharing MUST NOT allow mutable returned objects to contaminate another caller's result. Loader errors MUST NOT be cached and SHALL permit later retry.

#### Scenario: Twenty callers miss the same key

- **WHEN** twenty authorized requests in one instance miss the same full cache key concurrently
- **THEN** the business loader SHALL execute once and each caller SHALL receive an isolated equivalent result

#### Scenario: Shared loader fails

- **WHEN** a shared loader rejects and a subsequent request retries after it settles
- **THEN** the concurrent callers SHALL observe the error and the subsequent request SHALL be able to start a new loader

### Requirement: Aggregate reuse is independent of history pagination

Member-history aggregate caches SHALL be independent of page limit and offset. Paginated game and participant data SHALL be cached separately and combined with current member identity, current linked-account data and role projection into the existing enriched read-model DTO. This DTO SHALL retain game version, own-player level and seven inventory slots, both team rosters and membership highlighting fields without exposing raw replay data or other participants' loadouts. Ambiguous own-player data SHALL retain existing missing-data behavior. Participant enrichment SHALL remain a single query restricted to the selected page and SHALL be skipped for empty or cached pages. Aggregates SHALL continue to cover all active linked accounts and eligible games, independently of the displayed page.

#### Scenario: A member opens the next history page

- **WHEN** a valid aggregate cache exists and the user requests another page with unchanged dependencies
- **THEN** only missing page data SHALL require business loading and total, champion and position aggregates SHALL be reused without recomputation

### Requirement: Cache migration preserves enriched game list and asset contracts

The cache change SHALL preserve the current game-list, game-detail and member-history v2 projections and SHALL isolate incompatible older cache shapes. Game-list pages SHALL retain ten games, active/excluded visibility separation, linked-member names and unlinked Riot IDs. Uncached participant reads SHALL remain batched for only the selected page, with no per-game detail queries. Business cache entries SHALL retain internal asset identities and game versions; catalog-derived names and URLs SHALL continue to resolve through the existing independent catalog caches. Shared champion-name and portrait loading, successful 24-hour catalog retention, the eight-entry patch-catalog bound, recorded-patch selection and bounded failure behavior SHALL remain intact. The game-list links' existing disabled prefetch behavior SHALL be preserved.

#### Scenario: Existing enriched list is cached

- **WHEN** a ten-game page is read through the revised cache
- **THEN** its projected rosters SHALL be reused without participant DB reads, and legacy cache entries lacking those rosters SHALL not satisfy the request

#### Scenario: Redis is warm but the asset catalog is cold

- **WHEN** the business result is cached but required champion or patch catalogs are missing
- **THEN** catalog lookup SHALL retain the current shared loading and fallback contracts, with its time measured separately from the Redis business-cache hit

### Requirement: Cache admission and telemetry are bounded

The system SHALL canonicalize cache arguments to the same interpretation used by database loaders. Query payloads above 256KiB SHALL bypass shared storage. Initial paginated-result admission SHALL cover the first twenty pages; deeper valid pages SHALL retain their response behavior using direct database reads. Cache telemetry SHALL distinguish current authorization, revision lookup, cache reading, business loading, index building, publication and asset-catalog lookup, and record cache outcomes and payload size without credentials, search text or per-person metric labels. Performance validation SHALL include total response latency, database revision costs and independently cold or warm catalog states, not cache hit ratio alone.

#### Scenario: Equivalent oversized page requests

- **WHEN** multiple requested game pages normalize to the same final page
- **THEN** they SHALL use the same canonical cache identity or the same deep-page bypass policy

#### Scenario: An entry exceeds its size budget

- **WHEN** a projected query result exceeds 256KiB
- **THEN** the result SHALL still be returned but SHALL not be stored, and telemetry SHALL distinguish the size bypass from an ordinary miss
