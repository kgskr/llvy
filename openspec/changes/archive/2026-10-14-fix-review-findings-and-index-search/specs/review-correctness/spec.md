## ADDED Requirements

### Requirement: Membership decisions precede registration
The system SHALL retain the newest membership decision by guild and Discord ID before account registration and SHALL reject older or repeated login evidence. It SHALL preserve existing account lock ordering, deny-only first-login behavior and atomic login/audit commits.

#### Scenario: Newer denial precedes delayed first login
- **WHEN** an absent or pending decision commits before an older eligible callback registers the same identity
- **THEN** no account, session or successful login audit SHALL be created by the older callback; a newer eligible login SHALL remain possible

#### Scenario: Login commits before newer denial
- **WHEN** concurrent transactions commit the eligible login before a newer denied decision
- **THEN** the denied decision SHALL suspend the account and revoke the session before it completes without a deadlock

### Requirement: Replay display identity does not move backwards
The system SHALL update a stable Riot identity's display name only when the incoming observation is at least as recent as the stored observation. An unknown observation time SHALL NOT replace a known observation time. Account identity and member links SHALL remain unchanged.

#### Scenario: Upload old replay after new replay
- **WHEN** a renamed PUUID appears in a newer replay followed by an older replay
- **THEN** both games SHALL be saved while the newer display name and current-name search SHALL remain intact

### Requirement: Storage text is valid Unicode
The system SHALL reject NUL and unpaired UTF-16 surrogates in retained replay strings and member names before persistence. Replay rejection SHALL use RoflParseError and the existing 422/bound-Blob cleanup path. Legitimate Unicode SHALL remain accepted.

#### Scenario: Invalid replay text in identity or diagnostic fields
- **WHEN** a replay contains NUL or malformed UTF-16 in a string retained as a column or JSON scalar
- **THEN** processing SHALL return 422, delete only its bound Blob and persist no game

#### Scenario: Invalid member input
- **WHEN** a name contains NUL or malformed UTF-16 through a Server Action or protected mutation
- **THEN** it SHALL be rejected before the database write, while emoji and composed/decomposed text SHALL remain supported

#### Scenario: Deeply nested replay on Node 24
- **WHEN** participant JSON is within the byte budget but exceeds the nesting limit
- **THEN** the depth check SHALL reject it as RoflParseError before serialization can overflow the runtime stack
