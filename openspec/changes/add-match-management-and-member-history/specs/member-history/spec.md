## ADDED Requirements

### Requirement: Show a member's combined account history
The system SHALL provide authenticated member-list and member-detail pages. A detail page SHALL combine currently linked accounts into a paginated active-game history ordered by effective game date, show linked account names, and display game count, wins, losses, undecided results, win rate, and average kills/deaths/assists.

#### Scenario: Multiple linked accounts
- **WHEN** a member has played on different linked accounts in different games
- **THEN** all active games contribute to one member history and aggregate regardless of the selected page

#### Scenario: No games or unknown member
- **WHEN** an existing member has no linked games
- **THEN** the page displays an empty history with zero counts and no invented averages
- **WHEN** the member identifier is invalid or absent
- **THEN** the page responds as not found

### Requirement: Keep aggregates consistent with corrections and linking
Excluded games SHALL contribute to no member-history metric. Corrections and current account link/unlink operations SHALL immediately affect the displayed history without re-ingesting files. Win rate SHALL use only decided outcomes; missing values SHALL not be coerced to zero.

#### Scenario: Exclusion and restoration update totals
- **WHEN** a member's game is excluded and later restored
- **THEN** the game is removed from and then restored to all history totals and pages

#### Scenario: Link and unlink an existing account
- **WHEN** an existing account is linked to or unlinked from a member
- **THEN** past games are added to or removed from that member's history without re-ingestion

### Requirement: Avoid ambiguous duplicate member participation
A game SHALL count once per member. When multiple participant accounts in the same game are linked to one member, the system MUST mark that game as ambiguous with an unknown outcome and omit its K/D/A from averages.

#### Scenario: Two accounts linked in one game
- **WHEN** two participants in one game resolve to one member
- **THEN** the history contains one game, no fabricated win/loss or K/D/A, and a visible account-link warning
