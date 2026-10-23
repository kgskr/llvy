## ADDED Requirements

### Requirement: Normalized replay text fits bounded storage

The parser SHALL reject trimmed game versions and champion names exceeding 256 UTF-8 bytes. Ingestion SHALL revalidate these limits before the write transaction and reject original filenames exceeding 1,024 UTF-8 bytes before duplicate handling. These ceilings SHALL be independent of diagnostic JSON limits. Values SHALL NOT be truncated. Missing game versions and null original filenames SHALL remain supported. Oversized inputs SHALL follow existing invalid-replay failure, audit and cleanup paths without game, account or participant writes.

#### Scenario: Oversized normalized text with bounded diagnostics

- **WHEN** a replay has an oversized game version or champion, even if diagnostic copies omit that value
- **THEN** browser and desktop processing reject it with HTTP 422 and an invalid_replay failure audit before replay writes

#### Scenario: Browser supplies an oversized original filename

- **WHEN** a bound browser process request supplies an original filename exceeding 1,024 UTF-8 bytes
- **THEN** ingestion rejects it without storing the filename, including on duplicate uploads, and the failure audit retains only bounded filename information

#### Scenario: UTF-8 boundary remains accepted

- **WHEN** a version or champion is exactly 256 UTF-8 bytes or an original filename is exactly 1,024 UTF-8 bytes
- **THEN** length validation accepts it unchanged, including multibyte text

### Requirement: Replay identities fit indexed storage

The parser SHALL reject any trimmed PUUID, Riot game name or Riot tag line exceeding 512 UTF-8 bytes. Ingestion SHALL revalidate the same fixed ceiling before opening its write transaction. Identity values MUST NOT be truncated. Missing PUUID and empty legacy tag lines SHALL remain supported. Existing stored replay hashes SHALL retain their duplicate short-circuit behavior.

#### Scenario: Oversized identity in a small valid replay

- **WHEN** a syntactically valid replay contains an oversized PUUID, game name or tag line, even within all metadata and diagnostic budgets
- **THEN** processing rejects it as invalid replay before any game, Riot account or participant writes
- **AND** both web and desktop processing return HTTP 422, record one terminal failure audit with `invalid_replay`, actor, reserved filename and computed SHA-256, and terminate the reservation
- **AND** browser processing attempts immediate bound Blob cleanup while desktop processing delegates cleanup to existing bounded maintenance after expiry, preserving the terminal audit

#### Scenario: UTF-8 boundary and legacy identities

- **WHEN** every present identity field is at most 512 UTF-8 bytes after trimming, including multibyte names or a missing PUUID and empty tag line
- **THEN** identity length validation accepts those values without truncation or altered matching

### Requirement: Replay parser enforces participant and metadata budgets

The system SHALL reject replay metadata whose `statsJson` exceeds configured semantic limits, including participant count, serialized metadata size, participant object size, and nesting depth. The default participant limit for the MVP SHALL be ten participants unless explicitly configured otherwise.

#### Scenario: Oversized participant array is rejected

- **WHEN** a replay contains more participant stats entries than the configured limit
- **THEN** the parser rejects the replay as unsupported and does not return participant records for ingestion

#### Scenario: Oversized nested stats JSON is rejected

- **WHEN** a replay's `statsJson` string or nested participant objects exceed configured size or depth budgets
- **THEN** the parser rejects the replay as unsupported before database work begins

### Requirement: Ingestion bounds database work per replay

The system SHALL validate parser output against configured ingestion budgets before starting a transaction. A replay that would exceed the maximum participant rows, account upserts, or raw JSON storage budget MUST fail without writing game, account, or participant records.

#### Scenario: Over-budget replay performs no writes

- **WHEN** an authenticated upload contains a syntactically valid replay with over-budget participant data
- **THEN** ingestion fails before inserting or updating any game, account, or participant records

#### Scenario: Duplicate hash still short-circuits safely

- **WHEN** a replay's content hash already exists
- **THEN** ingestion returns the duplicate result without parsing unbounded participant data or performing participant DB work

### Requirement: Persist only bounded replay-derived diagnostic JSON

The system SHALL NOT persist arbitrary unbounded participant raw JSON. Retained participant diagnostics SHALL use a bounded scalar allowlist; unknown fields, nested values, and strings longer than 256 characters SHALL be omitted. Game diagnostics SHALL use four known top-level scalar fields. Input JSON exceeding size and depth limits SHALL be rejected before storage.

#### Scenario: Raw stats are bounded before storage

- **WHEN** a participant record is prepared for storage
- **THEN** any retained raw stats payload is reduced to the configured bounded scalar allowlist

#### Scenario: Oversized raw stats do not reach JSONB storage

- **WHEN** a participant's raw replay stats exceed the configured raw JSON budget
- **THEN** the system rejects the replay before storing `raw_stats`
