## ADDED Requirements

### Requirement: Maintain member records

The system SHALL store a record for each club member containing a stable unique identifier (UUID), a name, and a birth year. The UUID MUST be the member's primary identity and MUST remain stable across changes to the member's name or accounts.

#### Scenario: Create a member
- **WHEN** an administrator creates a member with a name and birth year
- **THEN** the system stores the member with a newly generated UUID

#### Scenario: Member identity is stable
- **WHEN** a member's name is later edited
- **THEN** the member's UUID is unchanged and all linked Riot accounts remain linked

### Requirement: Associate multiple Riot accounts with a member

The system SHALL allow a single member to have multiple Riot accounts, since members own several League accounts. PUUID SHALL identify a Riot account when available, with Riot ID (game name and tag line) as the fallback for older replays. Account identity and member links SHALL remain stable when a known PUUID changes its display name.

#### Scenario: Link multiple accounts to one member
- **WHEN** an administrator links two different Riot accounts to the same member
- **THEN** both Riot accounts resolve to that member

#### Scenario: Repeated legacy Riot IDs reuse their account
- **WHEN** the same Riot ID without a PUUID is encountered more than once and identifies one unambiguous account
- **THEN** the system uses that account record rather than creating duplicates

#### Scenario: A legacy account gains a PUUID
- **WHEN** a previously unseen PUUID is supplied with a Riot ID matching exactly one legacy account and no conflicting known identities
- **THEN** the system adds the PUUID to that account while preserving its UUID and member link

#### Scenario: Reused display names do not merge distinct identities
- **WHEN** multiple known PUUIDs share a Riot ID and a replay supplies no stable identity
- **THEN** the system keeps an unlinked legacy account rather than assigning a member by guessing

### Requirement: Auto-link known Riot IDs during ingestion

When ingesting a replay, the system SHALL automatically associate each parsed participant with the existing Riot account that matches its Riot ID, so participants of registered accounts resolve to the correct member without manual action.

#### Scenario: Known Riot ID resolves to its member
- **WHEN** a parsed participant's Riot ID matches a Riot account already linked to a member
- **THEN** the participant is associated with that account and resolves to its member

### Requirement: Hold unknown Riot IDs as unlinked

When a parsed Riot ID is not yet registered, the system SHALL create a Riot account record in an unlinked state (associated with no member) and MUST NOT discard the participant data.

#### Scenario: New Riot ID is stored unlinked
- **WHEN** a parsed participant's Riot ID does not match any existing Riot account
- **THEN** the system creates an unlinked Riot account for that Riot ID and associates the participant with it, with no member assigned

### Requirement: Manually link Riot accounts to members

The system SHALL provide a way for an administrator to link an unlinked Riot account to a member after the fact, and the link SHALL retroactively apply to all past participants of that Riot account.

#### Scenario: Linking an account resolves historical games
- **WHEN** an administrator links a previously unlinked Riot account to a member
- **THEN** all existing and future participants of that Riot account resolve to that member without re-ingesting the replays
