# query-cache

## Purpose

Accelerate authorized business reads with an optional Redis cache and predictable database fallback.

## Requirements

### Requirement: Authorized projected query cache

The system MUST verify the current session before each cache lookup. Cache keys SHALL separate roles, database environments and query arguments. Viewer results MUST be projected before caching, without birth years or privileged fields. Authentication MUST remain fresh across requests; audit queries and administrator assignment reads MUST remain outside the shared cache.

#### Scenario: Viewer follows an administrator read

- **WHEN** an administrator has populated a cache and a viewer requests the same resource
- **THEN** the viewer reads a separate entry containing only viewer-safe fields

#### Scenario: Revoked session with a warm cache

- **WHEN** a revoked administrator attempts to read a cached resource
- **THEN** the system rejects the session before reading cached data

### Requirement: Expiration and mutation invalidation

Query results SHALL expire after 60 seconds. Successful application data commits SHALL replace the shared cache generation. A query that began in an older generation MUST NOT populate the new generation. Failed transactions MUST NOT invalidate successful cached data. Cache errors after commit MUST NOT turn a completed database mutation into an application failure.

#### Scenario: Mutation races a cache fill

- **WHEN** a query starts before a successful mutation and finishes after generation replacement
- **THEN** its cache write belongs only to the old generation and later queries read the new generation

#### Scenario: Redis rejects invalidation

- **WHEN** PostgreSQL commits and Redis rejects generation replacement
- **THEN** the mutation still succeeds and previous cache entries expire through their TTL

### Requirement: Cache failures fail fast

The system SHALL bound Redis connection, readiness and individual command waits to 100ms, disconnect the failed shared client and use the existing database fallback without replaying commands. The system SHALL retain the five-second retry cooldown, authentication, projection, generation and TTL contracts.

#### Scenario: Redis accepts a connection but never becomes ready

- **WHEN** Redis readiness stalls
- **THEN** callers fall back after the 100ms readiness deadline instead of waiting one second

#### Scenario: A ready Redis stops replying

- **WHEN** a cache command does not complete before its deadline
- **THEN** the database loader runs once and requests during the cooldown do not reconnect
