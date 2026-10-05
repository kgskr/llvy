## ADDED Requirements

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
