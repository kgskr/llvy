# redis-cache-deployment

## Purpose

Describe optional Redis connectivity and deployment choices without prescribing one provider or region.

## Requirements

### Requirement: Redis connection uses a standard server-side interface

The system SHALL accept an optional server-only REDIS_URL and application namespace REDIS_KEY_PREFIX. The current adapter SHALL use Redis TCP/TLS through ioredis, including the Redis commands used by query caches and autocomplete. Upstash Redis MAY supply this endpoint. Production connections MUST verify TLS certificates and use hostname SNI. Missing or unavailable Redis SHALL fall back to PostgreSQL.

#### Scenario: Compatible Redis endpoint

- **WHEN** a valid TLS Redis endpoint is configured
- **THEN** concurrent requests reuse one client per server instance, and replacing the URL disconnects the prior client

#### Scenario: Redis is not configured

- **WHEN** REDIS_URL is absent
- **THEN** reads and search use PostgreSQL without requiring a cache provider

### Requirement: Database technology and adapter constraints are explicit

Deployment instructions SHALL describe PostgreSQL as the required database and Redis as an optional service. They SHALL distinguish these technologies from example providers and disclose that the current PostgreSQL adapter uses @vercel/postgres with the Neon serverless transport; a generic PostgreSQL endpoint is not automatically compatible without a suitable adapter or transport.

#### Scenario: Operator selects another database provider

- **WHEN** the operator prepares a PostgreSQL service other than the example provider
- **THEN** setup guidance identifies the current transport constraint instead of claiming that changing the connection URL alone proves compatibility

### Requirement: Deployment region is an operator choice

Deployment instructions SHALL allow the operator to choose supported application, database and Redis regions. They SHOULD recommend nearby regions for latency without requiring Singapore or another specific location.

#### Scenario: Operator deploys outside Singapore

- **WHEN** the operator chooses another supported region and compatible services
- **THEN** the deployment remains consistent with the application requirements
