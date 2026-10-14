## MODIFIED Requirements

### Requirement: List stored games

The system SHALL list active and excluded games separately, ordered by effective play date, upload time and ID descending, with 10 games per page. Each row SHALL show date, duration, winning team, comment and participants in blue/red team rows instead of a participant-count column. Blue wins SHALL fill the row with `#28344e`, red wins with `#59343b`, and unknown results with a neutral background. The list SHALL retain detail navigation and authorized excluded-game restoration.

Linked participants SHALL display their member name; only unlinked accounts SHALL display their full Riot ID including tag when present. Each name SHALL have a champion portrait on its left, with a placeholder on missing/failed images. Positions SHALL appear as TOP, JUG, MID, BOT and SUP in role order, with unknown positions clearly distinguished. Unknown teams and missing participants SHALL remain visible without inventing data. The layout MUST remain usable on narrow screens.

The list SHALL first select the requested game page and then fetch its participants in one batch, skipping the participant query for an empty page. It MUST NOT issue a detail query per game or select participant raw statistics, PUUIDs or member birth years. The projected result SHALL use the existing role-scoped, invalidated query cache under a new shape key, with live authentication before reading it. Champion lookup SHALL reuse the existing shared catalog cache.

#### Scenario: Games list shows newest first

- **WHEN** a user opens the games list with more than 10 games
- **THEN** the system shows the newest 10 games with date, duration, winning-team background, comment and team rosters, and offers the next page

#### Scenario: Linked and unlinked names

- **WHEN** a game contains linked and unlinked participants
- **THEN** linked participants show member names, unlinked participants show Riot IDs, and each name has its champion portrait with JUG for jungle

#### Scenario: Bounded reads and refreshed identities

- **WHEN** a nonempty page is loaded without cache
- **THEN** its participants are read in one query restricted to that page's game IDs
- **WHEN** the cache is warm
- **THEN** the roster is reused without participant reads, while successful member rename/link/unlink/delete mutations invalidate it

#### Scenario: Missing data and excluded games

- **WHEN** an excluded game has an unknown result, team, position or champion image
- **THEN** the row uses neutral result styling and explicit missing-data fallbacks, and only authorized admins/owners receive the restore control
