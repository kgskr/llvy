## ADDED Requirements

### Requirement: Reversibly exclude games
The system SHALL allow authenticated users to exclude and restore games without deleting their participants, content hashes, or replay blobs. Default game lists and member history MUST omit excluded games. A separate excluded list and the game detail SHALL allow restoration.

#### Scenario: Exclude and restore a game
- **WHEN** an authenticated user excludes a game and later restores it
- **THEN** it disappears from the active list and member aggregates, remains available in excluded records, and reappears after restoration with the original data

#### Scenario: Duplicate upload of an excluded game
- **WHEN** an excluded replay is uploaded again
- **THEN** the existing game is returned without duplicating or automatically restoring it

### Requirement: Correct game dates while preserving the original
The system SHALL accept a valid manually entered Korea-local game timestamp and use it for game and member-history ordering. The original timestamp and source MUST remain available. Users SHALL be able to clear the override and restore the original value.

#### Scenario: Correct and reset a date
- **WHEN** a user saves a valid date and later restores the original date
- **THEN** the effective date and source change to manual and then return to the preserved original value and source

#### Scenario: Invalid dates do not change a game
- **WHEN** a user supplies an empty, impossible, before-2009, or more-than-one-day-future date
- **THEN** the action returns a descriptive validation error without writing

### Requirement: Protect all record mutations
Every game mutation SHALL authenticate the request and validate identifiers and input on the server. Missing games and database errors SHALL produce useful user feedback without claiming success.

#### Scenario: Unauthenticated direct invocation
- **WHEN** a caller without a valid session invokes a date or exclusion mutation directly
- **THEN** no record changes and the response requires login
