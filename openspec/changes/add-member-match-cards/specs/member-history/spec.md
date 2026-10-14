## MODIFIED Requirements

### Requirement: Color recent-game rows by outcome

The member-detail recent-game list SHALL use a dark blue background (`#28344E`) for winning card rows and a dark red background (`#59343B`) for losing card rows. Decided rows SHALL use readable neutral text, and result labels SHALL appear as plain text without a separate colored badge. Unknown results SHALL retain a neutral background. Hovering a decided row SHALL retain its outcome background.

#### Scenario: View recent results

- **WHEN** recent games include wins, losses, and unknown outcomes
- **THEN** winning rows are blue, losing rows are red, and unknown rows use a neutral background
- **AND** ‘승리’, ‘패배’, and ‘미정’ appear as plain result text

## ADDED Requirements

### Requirement: Show compact recent-game cards

Each recent-game card SHALL display outcome, calendar date, duration, champion portrait and name, level when available, K/D/A, seven final inventory slots, and both teams' participant names and champion portraits. It SHALL retain the game-detail link and pagination. The member's linked participants SHALL be highlighted. Team and position ordering SHALL be deterministic; unknown teams SHALL remain visible. Cards SHALL fit narrow screens by reflowing their contents.

#### Scenario: A complete replay

- **WHEN** a recent game contains the member's unambiguous participant and both teams
- **THEN** its card shows the requested participant statistics and both team rosters, with item names available through accessible labels and tooltips

#### Scenario: Missing or ambiguous data

- **WHEN** level, item, champion, team, or counter data is missing, or multiple linked accounts played in the same game
- **THEN** unavailable personal data is not invented, the existing account-link warning remains available, and the roster still displays all stored participants

### Requirement: Batch recent-game enrichment by page

The system SHALL fetch additional participant information with at most one database query for the current page's game IDs, after pagination. Empty pages SHALL skip that query. The response and role-specific cache SHALL omit raw replay objects, PUUIDs, birth years of roster participants, and unneeded participant statistics. Full-history aggregates SHALL remain independent of pagination. A new cache identity SHALL separate enriched results from the earlier data shape.

#### Scenario: Multiple recent games

- **WHEN** a page contains multiple games
- **THEN** a single additional query fetches all requested rosters and own-player loadouts, with no query for games outside the page

#### Scenario: Cached or empty page

- **WHEN** an enriched page is served from a valid cache entry or contains no games
- **THEN** no additional participant query is issued
