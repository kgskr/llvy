## ADDED Requirements

### Requirement: Cache failures fail fast

The system SHALL bound Redis connection, readiness and individual command waits to 100ms, disconnect the failed shared client and use the existing database fallback without replaying commands. The system SHALL retain the five-second retry cooldown, authentication, projection, generation and TTL contracts.

#### Scenario: Redis accepts a connection but never becomes ready
- **WHEN** Redis readiness stalls
- **THEN** callers fall back after the 100ms readiness deadline instead of waiting one second

#### Scenario: A ready Redis stops replying
- **WHEN** a cache command does not complete before its deadline
- **THEN** the database loader runs once and requests during the cooldown do not reconnect

### Requirement: Read authentication is scoped to one request

The system SHALL share the authentication promise within a React render or an explicitly scoped read handler. It MUST perform fresh database authentication on the next request and MUST isolate concurrent requests and users. Route and DAL authorization checks SHALL remain in place.

#### Scenario: API and DAL authenticate the same request
- **WHEN** the autocomplete handler and its DAL both require authentication
- **THEN** one database session lookup serves both checks

#### Scenario: Parallel requests and authority revocation
- **WHEN** multiple requests run concurrently or a session is revoked between requests
- **THEN** requests do not share authentication results and the next request observes revocation

#### Scenario: Authentication fails
- **WHEN** authentication returns null or throws
- **THEN** duplicate checks in that read scope share that result and no stale successful authority is used

### Requirement: Mutation authority remains fresh

The system MUST keep fresh authentication for mutation guards and upload token issuance, including when called inside a read scope. Transactional authority locks SHALL remain unchanged.

#### Scenario: Authority changes after a read
- **WHEN** a session is revoked after a read authentication result has been memoized
- **THEN** a mutation guard or explicit fresh session lookup rejects the revoked session
