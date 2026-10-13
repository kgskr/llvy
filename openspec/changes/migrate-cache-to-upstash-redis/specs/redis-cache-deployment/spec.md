## ADDED Requirements

### Requirement: Redis provider configuration

The system SHALL use server-only `REDIS_URL` for its optional Upstash Redis connection and `REDIS_KEY_PREFIX` for the application namespace. Production Redis and Vercel Functions MUST be deployed in Singapore. The system MUST NOT fall back to the retired `VALKEY_URL` setting.

#### Scenario: Upstash production connection

- **WHEN** a valid TLS REDIS_URL is configured for Production
- **THEN** requests share an ioredis connection within the server instance, with certificate verification and hostname SNI enabled
- **AND** deployment verification confirms the database primary region is Singapore and the function region is sin1

#### Scenario: Missing replacement setting

- **WHEN** REDIS_URL is absent and only the retired VALKEY_URL remains
- **THEN** reads use PostgreSQL without attempting the retired cache connection

#### Scenario: Redis endpoint replacement

- **WHEN** REDIS_URL changes within a running process
- **THEN** the prior client is disconnected and the replacement URL is used

### Requirement: Preserve cache and search behavior

The system SHALL preserve live authorization before cache reads, role/database/environment namespaces, 60-second TTL, generation invalidation, atomic autocomplete publication, UTF-8 prefix matching, and bounded failure fallback to PostgreSQL.

#### Scenario: Cached and uncached results

- **WHEN** a permitted user reads cached data or autocomplete suggestions
- **THEN** cold and warm requests return the same projected data and existing API DTOs
- **AND** revoked authorization cannot read a warm cache

#### Scenario: Redis failure

- **WHEN** Redis cannot become ready within one second or a command fails
- **THEN** the request uses PostgreSQL and subsequent connection attempts observe the existing cooldown
- **AND** warnings contain no credentials or raw driver errors

### Requirement: Verify provider transition

The migration SHALL include real disposable local Redis regression tests and separate production verification. Production credentials MUST NOT be used as local integration fixtures.

#### Scenario: Local and production evidence

- **WHEN** the migration is reported complete
- **THEN** local checks cover TTL, invalidation, atomic index publication, partial eviction, Unicode prefix matching and authorization
- **AND** production evidence records the deployed commit, region, authenticated responses and Redis connection observations without claiming local tests prove production behavior
