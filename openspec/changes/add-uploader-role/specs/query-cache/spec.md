## MODIFIED Requirements

### Requirement: Authorized projected query cache

The system MUST verify the current session before each cache lookup. Cache keys SHALL separate roles, database environments and query arguments. Viewer and uploader results MUST be projected before caching, including birth years on existing member-read surfaces but excluding unrelated privileged fields. All four authenticated roles SHALL permit birth-year reads on those surfaces; existing minimal autocomplete and member-suggestion contracts SHALL remain unchanged. A new projection schema version or cache identity SHALL prevent older birth-year-excluding entries from serving the revised member-read contract without changing retention policies. Authentication MUST remain fresh across requests; audit queries and administrator/uploader assignment and login-account list reads MUST remain outside the shared cache.

#### Scenario: Viewer follows an administrator read

- **WHEN** an administrator or uploader has populated a cache and a viewer requests the same resource
- **THEN** the viewer reads its separate role entry including birth years permitted by that resource and excluding unrelated administrator-only fields

#### Scenario: Revoked session with a warm cache

- **WHEN** a revoked administrator attempts to read a cached resource
- **THEN** the system rejects the session before reading cached data

#### Scenario: Uploader reads after a viewer cache fill

- **WHEN** viewer has populated a member-read cache and uploader requests the same resource
- **THEN** uploader receives its own role projection including birth years permitted by that resource, without changing the viewer entry or broadening minimal suggestion DTOs

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
- **THEN** subsequent reads SHALL use the new dependency revisions immediately while preserving the current role projection, including birth years for all authenticated roles on the member-list surface without exposing unrelated privileged fields
