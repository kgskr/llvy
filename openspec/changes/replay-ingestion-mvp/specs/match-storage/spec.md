## ADDED Requirements

### Requirement: Persist games and participants

The system SHALL persist each parsed replay as one game record and one participant record per player. A game and its participants MUST be stored atomically: if any part fails, none of the records for that replay are persisted.

#### Scenario: Parsed replay is stored
- **WHEN** a replay has been parsed into a game and its participants
- **THEN** the system persists the game and all participant records in a single transaction

#### Scenario: Storage failure leaves no partial game
- **WHEN** persisting a game or any of its participants fails
- **THEN** the system rolls back so that no game or participant records from that replay remain

### Requirement: Enforce unique games by content hash

The system SHALL store each replay's content hash on its game record and MUST enforce that the hash is unique across all games.

#### Scenario: Duplicate hash is not inserted
- **WHEN** a game with a content hash equal to an existing game is submitted for storage
- **THEN** the system does not insert a second game record for that hash

### Requirement: Store an always-populated game play date

Every stored game MUST have a non-null play date. Since a `.rofl` contains no date, the system SHALL set the play date from the uploaded file's last-modified time when available, otherwise from the upload time, and SHALL record which source was used.

#### Scenario: Play date set from file time
- **WHEN** a game is stored and the upload provided a file last-modified time
- **THEN** the game's play date is that file time and the recorded source indicates the file's last-modified time

#### Scenario: Play date falls back to upload time
- **WHEN** a game is stored and no usable file last-modified time was provided
- **THEN** the game's play date is the upload time and the recorded source indicates the upload time

### Requirement: List stored games

The system SHALL provide a way to list stored games, ordered with the most recent game first by play date, showing a summary (play date, game duration, winning team, participant count) for each.

#### Scenario: Games list shows newest first
- **WHEN** a user opens the games list
- **THEN** the system shows stored games ordered by play date with the most recent first, each with its summary

### Requirement: Show game detail with participant stats

The system SHALL provide a detail view for a single game that lists all participants grouped by team (winning and losing), with each participant's Riot ID, champion, position, KDA, gold earned, win/loss, and the linked member when the participant's Riot account is connected to a member.

#### Scenario: Game detail lists participants by team
- **WHEN** a user opens a stored game's detail
- **THEN** the system shows all participants grouped by their team with Riot ID, champion, position, KDA, gold, and win/loss

#### Scenario: Unknown position is shown distinctly
- **WHEN** a participant has no recorded position
- **THEN** the detail view indicates the position is unknown rather than showing a misleading role

#### Scenario: Linked member is shown
- **WHEN** a participant's Riot account is linked to a member
- **THEN** the game detail shows that member's name alongside the participant's Riot ID
