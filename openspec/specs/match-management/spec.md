# match-management

## Purpose

Manage game exclusion, calendar dates and comments through authorized audited mutations.

## Requirements

### Requirement: Reversibly exclude games

The system SHALL allow admins and owners to exclude and restore games without deleting their participants, content hashes, or replay blobs. Default game lists and member history MUST omit excluded games. A separate excluded list and the game detail SHALL allow restoration.

#### Scenario: Exclude and restore a game

- **WHEN** an administrator excludes a game and later restores it
- **THEN** it disappears from the active list and member aggregates, remains available in excluded records, and reappears after restoration with the original data

#### Scenario: Duplicate upload of an excluded game

- **WHEN** an excluded replay is uploaded again
- **THEN** the existing game is returned without duplicating or automatically restoring it

### Requirement: Correct game dates while preserving the original

The system SHALL accept a valid manually entered calendar date and use it for game and member-history ordering. The original date and source MUST remain available. Admins and owners SHALL be able to clear the override and restore the original value.

#### Scenario: Correct and reset a date

- **WHEN** an administrator saves a valid date and later restores the original date
- **THEN** the effective date and source change to manual and then return to the preserved original value and source

#### Scenario: Invalid dates do not change a game

- **WHEN** a user supplies an empty, impossible, before-2009, or more-than-one-day-future date
- **THEN** the action returns a descriptive validation error without writing

### Requirement: Protect all record mutations

Every game mutation SHALL require current admin or owner authority and validate identifiers and input on the server. Missing games and database errors SHALL produce useful user feedback without claiming success.

#### Scenario: Unauthenticated direct invocation

- **WHEN** a caller without current admin or owner authority invokes a date or exclusion mutation directly
- **THEN** no record changes and the response requires login or reports insufficient permission

### Requirement: Calendar date persistence

The system SHALL persist original and corrected game dates as calendar dates without a time component. New file/upload instants MUST use their Asia/Seoul calendar date. Game screens MUST display only dates and admin/owner editing MUST accept date-only input.

#### Scenario: Ingestion and correction

- **WHEN** a replay is ingested and an administrator corrects its date
- **THEN** original/override values contain only YYYY-MM-DD and restoration returns the original date

### Requirement: Editable short game comment

The system SHALL support one game comment of at most 30 Unicode code points including every space. Admins/owners MUST be authorized for create/edit/clear at the server mutation boundary; viewers SHALL only read. The database MUST reject longer values and successful edits MUST share a transaction with their audit record.

#### Scenario: Exact boundary and spaces

- **WHEN** a comment contains 30 code points including leading/trailing spaces
- **THEN** it is stored unchanged, while a 31-code-point comment is rejected

#### Scenario: Clear or unauthorized edit

- **WHEN** an administrator submits empty input
- **THEN** the comment is cleared and the before/after change is audited
- **WHEN** a viewer attempts direct mutation
- **THEN** no comment or audit change occurs
