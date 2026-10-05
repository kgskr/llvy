## ADDED Requirements

### Requirement: Optional bounded Valkey connection

The system SHALL use the server-only `VALKEY_URL` supplied by Layerbase's Vercel integration, reuse one connection per instance, and bound connection and command waits. Production connections MUST verify TLS certificates. Missing or unavailable Valkey SHALL fall back to PostgreSQL.

#### Scenario: Cache unavailable

- **WHEN** Valkey is unconfigured or a connection/command fails
- **THEN** the authorized query returns its PostgreSQL result without exposing the connection URL or credentials in logs

### Requirement: Authorized projected query cache

The system MUST verify the current session before each cache lookup. Cache keys SHALL separate roles, database environments and query arguments. Viewer results MUST be projected before caching, without original member names or birth years. Authentication, credential validation, audit queries and administrator assignment reads MUST remain uncached.

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

#### Scenario: Valkey rejects invalidation

- **WHEN** PostgreSQL commits and Valkey rejects generation replacement
- **THEN** the mutation still succeeds and previous cache entries expire through their TTL
