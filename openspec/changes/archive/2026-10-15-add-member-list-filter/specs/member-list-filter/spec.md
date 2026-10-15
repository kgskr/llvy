## ADDED Requirements

### Requirement: Member list search shares the heading row

The members tab SHALL display a search input on the same row as `모임원 정보`, beside the title and approximately beneath the main navigation's members area. The input SHALL have an accessible name identifying member-name and Riot-ID search. Narrow screens SHALL retain a usable title/search row without horizontal page overflow; administrative controls MAY wrap onto another row.

#### Scenario: Open the members tab

- **WHEN** an authenticated user opens `/members`
- **THEN** the title and search input SHALL share a row above the member cards, with existing administrative controls visible only to authorized roles

### Requirement: Filter loaded members by name or any linked Riot ID

The members tab SHALL filter the already-loaded complete member list in the browser as the query changes. A member SHALL match when its name or any linked account's displayed Riot ID contains the query after NFC normalization, surrounding whitespace trimming and case folding by JavaScript lowercase. Matching SHALL be literal substring matching. A matching member SHALL appear once, retain all its displayed accounts and retain its original relative order. Members without accounts SHALL remain searchable by name.

#### Scenario: Name fragment and case variation

- **WHEN** the user enters a fragment contained anywhere in a member name, including equivalent NFC text or different letter case
- **THEN** only matching member cards SHALL remain on the current page

#### Scenario: Match a secondary account or tag

- **WHEN** the query occurs in any linked account's nickname, tag or complete displayed Riot ID
- **THEN** that member SHALL appear once with all of its accounts, even if another linked account also matches

#### Scenario: Literal punctuation

- **WHEN** the query contains `%`, `_` or `#`
- **THEN** these characters SHALL match literally rather than act as patterns or separate search commands

### Requirement: Filtering stays local and preserves existing information boundaries

Typing, clearing or pressing Enter in the list search SHALL NOT issue a search request, invoke a Server Action, query the database, change the URL or navigate. Initial page loading SHALL retain the existing authenticated role-specific read model. Result links SHALL avoid automatic prefetch so newly visible cards do not cause server requests. Existing member details and administrative actions SHALL remain reachable by explicit links. Viewer data SHALL continue to omit birth years, and search SHALL use only names and linked Riot IDs.

#### Scenario: Change the query repeatedly

- **WHEN** a user types, replaces or clears a query or presses Enter
- **THEN** only the local card list SHALL update without additional requests or navigation

#### Scenario: Viewer filters an already loaded list

- **WHEN** a viewer searches for a member
- **THEN** the member's name and linked Riot IDs SHALL remain visible while birth years and administrative controls remain absent

### Requirement: Empty queries restore the list and empty results are distinct

An empty or whitespace-only query SHALL show the complete loaded member list in its original order. A nonmatching query SHALL show `검색 결과가 없습니다.` and guidance to try another name or Riot ID. A list with no registered members SHALL retain `아직 등록된 모임원이 없습니다.` and authorized member-add guidance. The interface SHALL announce the visible member count through a polite status region.

#### Scenario: Clear a search

- **WHEN** the user clears a query or replaces it with whitespace
- **THEN** all originally loaded member cards SHALL reappear in their original order

#### Scenario: No member matches

- **WHEN** registered members exist but none match the query
- **THEN** the list SHALL display search-specific empty guidance and announce zero results

#### Scenario: No registered members

- **WHEN** the initially loaded member list is empty
- **THEN** the page SHALL retain the registration-empty guidance regardless of the search query
