## MODIFIED Requirements

### Requirement: List stored games

The system SHALL list active and excluded games separately, ordered by effective play date, upload time and ID descending, with 10 games per page. Each row SHALL show date, duration, winning team, comment and participants in blue/red team rows instead of a participant-count column. Blue-team participant areas SHALL use `#28344e` and red-team participant areas SHALL use `#59343b`, regardless of the winner. Date/duration and the full-width comment/action footer SHALL use the darker winning-team background (`#1c263a` for blue, `#3d242a` for red), or a neutral background when the winner is unknown. Known teams SHALL show their win/loss label only when the winning team is known; unknown teams SHALL retain a neutral participant area without an inferred outcome. The list SHALL retain detail navigation and authorized excluded-game restoration.

Linked participants SHALL display their member name; only unlinked accounts SHALL display their full Riot ID including tag when present. Each name SHALL have a champion portrait on its left, with a placeholder on missing/failed images. Positions SHALL appear as TOP, JUG, MID, BOT and SUP in role order, with unknown positions clearly distinguished. Unknown teams and missing participants SHALL remain visible without inventing data. The layout MUST remain usable on narrow screens.

The list SHALL first select the requested game page and then fetch its participants in one batch, skipping the participant query for an empty page. It MUST NOT issue a detail query per game or select participant raw statistics, PUUIDs or member birth years. The projected result SHALL use the existing role-scoped, invalidated query cache under a new shape key, with live authentication before reading it. Champion lookup SHALL reuse the existing shared catalog cache.

#### Scenario: Games list shows newest first

- **WHEN** a user opens the games list with more than 10 games
- **THEN** the system shows the newest 10 games with date, duration, darker winning-team metadata and footer, comment and separately colored team rosters, and offers the next page

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
- **THEN** the metadata and footer use neutral result styling, known team areas retain their own colors, and explicit missing-data fallbacks remain visible, and only authorized admins/owners receive the restore control
