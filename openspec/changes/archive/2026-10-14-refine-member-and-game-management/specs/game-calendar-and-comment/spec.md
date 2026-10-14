## ADDED Requirements

### Requirement: Calendar date persistence
The system SHALL persist original and corrected game dates as calendar dates without a time component. Existing timestamps and new file/upload instants MUST use their Asia/Seoul calendar date. Game screens MUST display only dates and admin/owner editing MUST accept date-only input.

#### Scenario: Korea midnight migration
- **WHEN** an old game/override timestamp falls on the following day in Korea
- **THEN** migration preserves that Korea calendar day and removes time precision from both columns

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
