# champion-name-cache

## Purpose

Resolve localized champion names with bounded shared fetches and expiring memory entries.

## Requirements

### Requirement: Expire successful in-memory champion maps

The resolver SHALL reuse a successful nonempty champion map for 24 hours after lookup completion in the same module instance. It MUST NOT extend this lifetime on reads. At or after expiration, it SHALL perform another bounded lookup before resolving names. The existing Next.js fetch revalidation setting SHALL remain one day; this memory lifetime does not guarantee upstream freshness across the framework cache.

#### Scenario: Before and at the expiration boundary

- **WHEN** names are resolved before expiration and again exactly 24 hours after the last successful lookup completed
- **THEN** the first call reuses the map and the boundary call loads another map, including newly available champion names

### Requirement: Share pending champion lookups

Concurrent calls within one module instance SHALL share one pending lookup, both when cold and after expiration. Each caller SHALL receive a separate result containing only its requested names. The pending reference SHALL be cleared after success, an empty or invalid response, an error, or timeout so later calls can retry.

#### Scenario: Concurrent initial load and refresh

- **WHEN** multiple callers request different names while a cold or expired lookup is pending
- **THEN** one versions request and one champion-data request serve all callers, and each result contains only that caller's requested names

### Requirement: Preserve bounded failure recovery

The entire shared lookup, including both requests and response bodies, MUST remain bounded by the existing two-second deadline. Failures and empty maps MUST NOT become successful memory entries. A failed refresh SHALL fall back to internal names rather than reuse the expired map. Late responses from a timed-out lookup MUST NOT populate memory or interfere with a newer pending lookup. Existing remote response validation and unknown-name fallback SHALL remain in place.

#### Scenario: Refresh fails and later recovers

- **WHEN** a lookup after expiration fails or returns an empty or invalid map
- **THEN** callers receive their internal names and the next call can load and cache a successful map

#### Scenario: Shared timeout and late response

- **WHEN** a shared lookup times out and its response arrives while a later retry is pending
- **THEN** all original callers fall back within the shared deadline, the late result is ignored, and the retry remains shared and can populate memory
