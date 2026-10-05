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

### Requirement: Present member information with one detail link
The member-list page SHALL use the heading ‘모임원 정보’. Each member's name SHALL link to the member-detail page and display as `name(birthYear)` when a birth year is recorded, or as the name alone otherwise. The member card SHALL NOT include a separate ‘전적 보기’ link to the same page.

#### Scenario: Member has a birth year
- **WHEN** a member named 민수 with birth year 1997 appears in the list
- **THEN** the name link displays `민수(1997)` and opens that member's detail page

#### Scenario: Member has no birth year
- **WHEN** a member has no recorded birth year
- **THEN** the name link displays only the member's name

### Requirement: Show champion summaries above linked accounts
The member-detail page SHALL display a champion summary above the linked Riot accounts. The summary SHALL combine all active games from currently linked accounts independently of recent-game pagination and show each champion's game count, wins, losses, undecided results, decided-outcome win rate, and average kills/deaths/assists. It SHALL omit ambiguous participation and games with no known champion. Rows SHALL sort by game count descending, then internal champion name ascending. Display names SHALL use the existing localized champion lookup with an internal-name fallback.

#### Scenario: Multiple accounts and pages
- **WHEN** the member plays the same champion on different linked accounts and opens any recent-game page
- **THEN** one champion row includes all qualifying games across those accounts with the same summary on every page

#### Scenario: Excluded, ambiguous, or missing champion
- **WHEN** a game is excluded, contains multiple linked participant accounts for the member, or has no known champion
- **THEN** it contributes to no champion-summary row

#### Scenario: Undecided outcomes and missing counters
- **WHEN** a champion has undecided outcomes or missing kills/deaths/assists
- **THEN** undecided games remain in its game count but not the win-rate denominator, each average ignores missing values independently, and a metric without data displays ‘—’

#### Scenario: No qualifying champion games
- **WHEN** the member has no qualifying champion games
- **THEN** the page displays an empty champion-summary state above the linked accounts

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
