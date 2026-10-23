## ADDED Requirements

### Requirement: Aggregate member relationship highlights

The system SHALL calculate the highest same-team win rate, highest opposing-team win rate, most frequent teammate, and most frequent opponent across all active games of the viewed member's currently linked accounts, independently of pagination. Candidates MUST be other linked members with at least three games in the respective relationship. Each pair SHALL count at most once per game, and games where either member has multiple linked participating accounts or an unknown team MUST be omitted for that pair. Excluded games and unlinked accounts MUST be omitted. Win rate SHALL use the viewed member's wins divided by decided outcomes; unknown outcomes SHALL count toward meeting frequency but not the win-rate denominator. A candidate with no decided outcomes MUST NOT win a win-rate category. Win-rate ties SHALL prefer more decided games, then more total games, then ascending member UUID; frequency ties SHALL prefer ascending member UUID.

#### Scenario: Separate thresholds and merged accounts

- **WHEN** two members have two same-team games and one opposing-team game across their linked accounts
- **THEN** neither relationship qualifies until it independently reaches three games
- **AND** different linked accounts of the same member contribute to one candidate

#### Scenario: Invalid or ambiguous participation

- **WHEN** a game is excluded, either member participates through multiple accounts, or either team is unknown
- **THEN** that game contributes to no relationship statistic for that pair

#### Scenario: Unknown outcomes and zero wins

- **WHEN** a pair has three qualifying games with unknown outcomes
- **THEN** it may appear in frequency categories but not win-rate categories
- **WHEN** a pair has three decided losses
- **THEN** its zero-percent win rate remains a valid aggregate candidate

### Requirement: Display relationship blocks below positions

The member-detail page SHALL show up to four blocks directly below ‘플레이 포지션’ and above linked accounts, in the order ‘가장 많이 함께한 팀원’, ‘가장 많이 만난 상대’, ‘같은 팀 최고 승률’, ‘상대 팀 최고 승률’. The presentation layer MUST omit a win-rate block unless its unrounded win rate is greater than 50 percent, without changing aggregate queries or cached results. Frequency blocks SHALL remain eligible regardless of win rate. Blocks SHALL share one horizontal row, allowing scrolling within that row on narrow screens. Each block SHALL show the member name linked to `/members/{memberId}` with prefetch disabled, its primary metric, meeting count, and outcomes. Missing or filtered categories MUST produce no block or placeholder. If no category remains visible, the entire relationship region and its explanatory note MUST be omitted.

#### Scenario: Four, some, or no categories

- **WHEN** all categories have eligible candidates and both win rates exceed 50 percent
- **THEN** four blocks appear in one row below positions
- **WHEN** only some categories have candidates
- **THEN** only those blocks are created, in the same relative order
- **WHEN** no category has a visible candidate after presentation filtering
- **THEN** no relationship region, empty block, or empty-state message is rendered

#### Scenario: Hide low win rates only in presentation

- **WHEN** either highest win rate is 50 percent or lower, or has no decided value
- **THEN** its win-rate block is omitted while frequency blocks remain visible on the left
- **AND** the aggregate and cache retain the original statistics
- **WHEN** a highest win rate is greater than 50 percent
- **THEN** its block is shown after the frequency blocks

### Requirement: Cache relationship summaries with current identities

Relationship summaries SHALL use one additional aggregate SQL statement per cache miss, return at most four projected member summaries, and omit PUUIDs, birth years, raw replay data, and unused account fields. The relationship summaries MUST use a dedicated cache identity and depend on member, account, and history revisions. It SHALL be independent of recent-game pagination.

#### Scenario: Rename, relink, or change a game

- **WHEN** a member is renamed or deleted, accounts are relinked, or relevant games change
- **THEN** subsequent authorized reads use updated summaries and names rather than cached prior identities
- **WHEN** only the recent-game page changes
- **THEN** a valid aggregate cache entry is reused
