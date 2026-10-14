# member-registry

## Purpose

Maintain stable game-member and Riot-account identities independently of login accounts.

## Requirements

### Requirement: Maintain member records

The system SHALL store a record for each club member containing a stable unique identifier (UUID), a name, and an optional birth year (NULL when omitted). The UUID MUST be the member's primary identity and MUST remain stable across changes to the member's name or accounts.

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

#### Scenario: An unlinked legacy account gains a PUUID

- **WHEN** a previously unseen PUUID is supplied with a Riot ID matching exactly one legacy account that has no member link and no conflicting known identities
- **THEN** the system adds the PUUID to that account while preserving its UUID

#### Scenario: A linked legacy account is not promoted by display name

- **WHEN** a previously unseen PUUID has the same Riot ID as an already member-linked legacy account
- **THEN** the system retains the legacy account and its member link, creates a separate unlinked PUUID account, and requires explicit account linking before the new games contribute to that member's history

#### Scenario: Reused display names do not merge distinct identities

- **WHEN** multiple known PUUIDs share a Riot ID and a replay supplies no stable identity
- **THEN** the system keeps an unlinked legacy account rather than assigning a member by guessing

### Requirement: Auto-link known Riot IDs during ingestion

When ingesting a replay, the system SHALL resolve each participant by PUUID when present, otherwise by an unambiguous Riot ID candidate. Games SHALL resolve through the selected account's current member link. Display-name equality alone MUST NOT promote a member-linked legacy account to an unseen PUUID.

#### Scenario: Known Riot ID resolves to its member

- **WHEN** a parsed participant resolves to an existing member-linked account by the supported identity rules
- **THEN** the participant is associated with that account and resolves to its member

### Requirement: Hold unknown Riot IDs as unlinked

When a participant cannot resolve to an existing account under the supported identity rules, the system SHALL create a Riot account record in an unlinked state (associated with no member) and MUST NOT discard the participant data.

#### Scenario: New Riot ID is stored unlinked

- **WHEN** a parsed participant cannot resolve to an existing account under the supported identity rules
- **THEN** the system creates an unlinked Riot account for that Riot ID and associates the participant with it, with no member assigned

### Requirement: Manually link Riot accounts to members

The system SHALL provide a way for an administrator to link an unlinked Riot account to a member after the fact, and the link SHALL retroactively apply to all past participants of that Riot account.

#### Scenario: Linking an account resolves historical games

- **WHEN** an administrator links a previously unlinked Riot account to a member
- **THEN** all existing and future participants of that Riot account resolve to that member without re-ingesting the replays

### Requirement: Protected permanent member deletion

The system SHALL allow admins and owners to delete game members, detach their Riot accounts, and preserve games and historical audits. Deletion SHALL NOT change independent login-account authority. Deletion and detached links MUST be audited atomically.

#### Scenario: Delete a game member

- **WHEN** an administrator deletes a game member
- **THEN** the member is deleted and account links are cleared while games, audit snapshots and login-account roles remain unchanged

#### Scenario: Audit failure rolls deletion back

- **WHEN** deletion cannot store its audit records
- **THEN** the member and account links remain unchanged

### Requirement: Active-game unlinked account queue

The system SHALL list/count unlinked Riot accounts only if they participate in at least one non-excluded game, with game counts based only on non-excluded games.

#### Scenario: Account only in excluded games

- **WHEN** all games containing an unlinked account are excluded
- **THEN** it is absent from the queue and total count until a game is restored

### Requirement: Independently paginated administration tables

The system SHALL paginate the member and unlinked-account tables independently at ten rows per page with stable ordering, complete linked-account lists, accurate totals, validated/clamped page parameters and all-member account-link options.

#### Scenario: Navigate one table

- **WHEN** the user changes the member page while viewing the second account page
- **THEN** the member table changes, the account page remains second, and members on other pages remain selectable for account linking

#### Scenario: Removal shrinks the last page

- **WHEN** deletion or linking reduces the total below the requested page
- **THEN** rendering clamps to the last valid page without an empty out-of-range table

### Requirement: Replay display identity does not move backwards

The system SHALL update a stable Riot identity's display name only when the incoming observation is at least as recent as the stored observation. An unknown observation time SHALL NOT replace a known observation time. Account identity and member links SHALL remain unchanged.

#### Scenario: Upload old replay after new replay

- **WHEN** a renamed PUUID appears in a newer replay followed by an older replay
- **THEN** both games SHALL be saved while the newer display name and current-name search SHALL remain intact

### Requirement: Member names use valid Unicode

The system SHALL reject NUL and unpaired UTF-16 surrogates in member names before persistence, including direct protected-mutation calls. Legitimate Unicode SHALL remain accepted.

#### Scenario: Invalid member input

- **WHEN** a name contains NUL or malformed UTF-16 through a Server Action or protected mutation
- **THEN** it is rejected before the database write, while emoji and composed/decomposed text remain supported
