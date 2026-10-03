## ADDED Requirements

### Requirement: Extract game-level metadata from a replay

The system SHALL read the metadata section of a `.rofl` file and extract game-level information without using the Riot API. Extracted fields MUST include game duration (the top-level `gameLength`, expressed in milliseconds) and the winning team (derived from which team's participants have a win result), and SHALL include the game version when present in metadata or the ROFL2 header. The play date/time is NOT present in a `.rofl` file; the system MUST NOT attempt to derive it from parsing — the game date is supplied at storage time from the upload (see `replay-upload` and `match-storage`).

#### Scenario: Valid replay yields game metadata
- **WHEN** a valid `.rofl` file is parsed
- **THEN** the system produces a game record containing game duration and the winning team, and the game version when present

#### Scenario: Parsing does not produce a play date
- **WHEN** a `.rofl` file is parsed
- **THEN** the parser does not return a game date, because none exists in the file

#### Scenario: ROFL2 stores its game version only in the header
- **WHEN** metadata has no usable game version and the ROFL2 header contains a valid bounded version field
- **THEN** the parser returns that header version without scanning the replay payload or interpreting it as a date

#### Scenario: Metadata version takes priority
- **WHEN** both metadata and the ROFL2 header contain a game version
- **THEN** the parser preserves the metadata version

### Requirement: Support legacy and ROFL2 file formats

The system SHALL accept both the legacy `.rofl` container (magic bytes `RIOT` `0x00 0x00`) and the newer ROFL2 container (magic bytes `RIOT` `0x02 0x00`).

#### Scenario: ROFL2 replay is accepted
- **WHEN** a `.rofl` file uses the ROFL2 magic bytes
- **THEN** the system parses it using the same metadata extraction path as the legacy format

### Requirement: Extract per-participant statistics

The system SHALL extract statistics for every participant in the replay. For each participant the system MUST extract the Riot ID (game name and tag line), the champion played, the team, the position, and win/loss. The system SHALL additionally extract kills, deaths, assists, and gold earned, and SHALL retain the full raw per-participant stats payload for fields not yet modeled.

#### Scenario: Each participant is extracted with required and bonus stats
- **WHEN** a valid replay containing ten participants is parsed
- **THEN** the system produces ten participant records, each with Riot ID, champion, team, position, win/loss, and the bonus kills/deaths/assists/gold

#### Scenario: Riot ID is captured for member matching
- **WHEN** a participant has a Riot ID game name and tag line in the replay metadata
- **THEN** the system captures both so the participant can be matched to a member's Riot account

#### Scenario: Win is determined without hard-coding the loser value
- **WHEN** a participant's win field is read
- **THEN** the participant is treated as a winner only when the value equals "win" case-insensitively, and as a loser for any other value including empty

#### Scenario: Position is captured with unknown handling
- **WHEN** a participant's primary position field is present and non-empty
- **THEN** the system records that position (one of TOP, JUNGLE, MIDDLE, BOTTOM, UTILITY)

#### Scenario: Unknown position is recorded as none
- **WHEN** a participant's position cannot be determined (primary position is empty and the fallback is unknown)
- **THEN** the system records the participant's position as unknown (no position) rather than failing the replay

### Requirement: Handle unsupported or corrupt replays

The system SHALL detect replays it cannot parse and MUST fail without persisting partial data.

#### Scenario: Corrupt or non-replay file
- **WHEN** a file does not have a valid `.rofl` structure or its metadata cannot be decoded
- **THEN** the system reports a parsing error and does not persist any game or participant records for that file

#### Scenario: Replay missing required participant fields
- **WHEN** a replay parses but is missing required participant statistics
- **THEN** the system reports the replay as unsupported and does not persist a partial game record

#### Scenario: Replay with no embedded participant stats
- **WHEN** a replay's metadata contains an empty participant statistics list (e.g. replays from the patch-13.20 era whose `statsJson` serializes to `[]`)
- **THEN** the system reports the replay as unsupported (no stats to ingest) and does not persist any game or participant records
