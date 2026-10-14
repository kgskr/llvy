## ADDED Requirements

### Requirement: One search field accepts member names and Riot IDs

The authenticated landing SHALL provide one GET search form using `q` for member names and Riot IDs. Its placeholder SHALL be `모임원 이름 또는 롤 닉네임#태그를 입력하세요`. Member-name matching SHALL normalize NFC, surrounding whitespace and case, use prefix matching for autocomplete and full-name equality for submitted searches. Riot ID matching SHALL preserve existing normalized nickname and optional tag semantics. Name matching SHALL treat `#` literally while only the Riot branch interprets it as a tag separator. Empty input, more than 100 Unicode code points, control characters and ill-formed UTF-16 SHALL produce no matches. Repeated input parameters or simultaneous `q` and `nickname` SHALL be rejected as ambiguous input, with HTTP 400 for autocomplete and the existing missing-user page for submission.

#### Scenario: Member name prefix

- **WHEN** an authenticated user enters `김길` and a registered member is named `김길수`
- **THEN** autocomplete SHALL offer that member and preserve the original display name

#### Scenario: Direct full-name search without JavaScript

- **WHEN** the user submits a complete member name through the GET form without JavaScript
- **THEN** the server SHALL resolve current exact name and Riot ID matches through the same unified search behavior

#### Scenario: Normalization and literal input

- **WHEN** equivalent queries differ only in NFC form, case or surrounding whitespace, or contain literal `%` or `_`
- **THEN** matching SHALL use the shared normalization and SHALL NOT interpret user text as a SQL wildcard pattern

#### Scenario: Prefix is submitted without selecting a suggestion

- **WHEN** a submitted prefix is not itself any exact eligible member name or Riot ID
- **THEN** the system SHALL show the missing-user page rather than selecting a longer name arbitrarily

### Requirement: Member and Riot search eligibility are distinct

Name search SHALL include all currently registered game members, including members with no linked account, no games or only excluded games. Riot ID search SHALL continue to include only stored accounts currently linked to a member and having at least one active game. Discord login-account names SHALL NOT be searchable through this feature.

#### Scenario: Newly registered member without history

- **WHEN** a registered member has no linked Riot account or active game history
- **THEN** name search SHALL still offer and resolve that member to the existing empty-history view

#### Scenario: Excluded-only or unlinked Riot account

- **WHEN** a Riot account is unlinked or occurs only in excluded games
- **THEN** that account SHALL remain absent from Riot ID suggestions and exact account matches, without removing its existing member from name search

### Requirement: Unified suggestions are typed bounded and distinguishable

Autocomplete for `q` SHALL return at most 10 suggestions in total. A `member` suggestion SHALL contain only kind, member UUID as id, original name and an accounts array with at most two linked gameName/tagLine pairs. A `riot-account` suggestion SHALL contain only kind, account UUID as id, gameName and tagLine. Results SHALL deduplicate by kind and id, allocate up to five slots to each type first and fill unused slots from the other type. Members SHALL appear before accounts; each group SHALL use deterministic normalized UTF-8 lexical ordering with UUID tie-breaking. Member suggestions SHALL show the `모임원` label and available linked Riot IDs, or `연결된 계정 없음`; account suggestions SHALL show `라이엇 계정`. Different member IDs sharing a name SHALL remain separate suggestions.

#### Scenario: Both types match the same prefix

- **WHEN** at least five member names and five Riot IDs match
- **THEN** the response SHALL contain five suggestions of each type and SHALL distinguish their type and stable identity

#### Scenario: One type has few matches

- **WHEN** two member names and more than eight Riot IDs match
- **THEN** the response SHALL contain the two members and eight accounts

#### Scenario: Same-name members

- **WHEN** two distinct members have the same name
- **THEN** both SHALL remain independently selectable with their linked Riot ID previews, without using birth years or merging them by name

### Requirement: Selection and submission resolve the intended current member

Selecting a member suggestion SHALL navigate by its member UUID to the member detail page, which SHALL revalidate the current session and member existence. Selecting a Riot account suggestion SHALL use the existing exact Riot ID resolver and current PostgreSQL linkage. Unified direct submission SHALL union exact name matches and eligible exact Riot ID matches, deduplicate by member UUID before counting or pagination, redirect for one member, and show the missing-user page for zero members. Multiple members SHALL be offered in stable pages of 20 members with the original query preserved. Neither source type nor account count SHALL cause an arbitrary redirect or suppress other matching members. The complete distinct result set SHALL be counted before pagination. Database failures SHALL remain errors rather than missing-user results.

#### Scenario: One member matches through several identities

- **WHEN** a member matches by name and multiple linked Riot accounts and no other member matches
- **THEN** the search SHALL redirect once to that member's detail page

#### Scenario: Name collides with another member's nickname

- **WHEN** an exact member name and an eligible exact Riot ID resolve to different members
- **THEN** the system SHALL display both members for selection rather than prioritizing one source

#### Scenario: Many accounts precede another member

- **WHEN** one matching member has more than 20 matching accounts and another member also matches
- **THEN** account rows SHALL be grouped by member before limiting results and the other member SHALL remain reachable

#### Scenario: More than twenty matching members

- **WHEN** more than 20 distinct members exactly match the query
- **THEN** all SHALL be reachable through result pagination without exceeding 20 members on a page

#### Scenario: A displayed suggestion becomes stale

- **WHEN** a member is renamed or deleted, or a Riot account is relinked after autocomplete
- **THEN** name selection SHALL show the same member's current details or the existing 404 if deleted, and account selection SHALL resolve current DB linkage rather than cached membership

### Requirement: Legacy nickname requests preserve their contract

Existing `/search?nickname=...` requests SHALL remain Riot-only exact searches. Existing `/api/search/autocomplete?nickname=...` requests SHALL retain the untyped `{ suggestions: [{ id, gameName, tagLine }] }` shape and SHALL NOT return name suggestions or member fields. Legacy submissions SHALL share the distinct-member result pagination while retaining their input parameter in links. New typed responses SHALL be returned only for `q` mode.

#### Scenario: Previously open client requests suggestions

- **WHEN** an older client sends a nickname-only autocomplete request
- **THEN** it SHALL receive the existing account-only response shape with no new member fields

#### Scenario: Saved Riot ID search URL

- **WHEN** a user opens a saved nickname search whose text is also someone's real name
- **THEN** the request SHALL resolve only the Riot ID interpretation

### Requirement: Member autocomplete follows shared cache lifecycle and authorization

The new member index SHALL occupy a separate versioned namespace from the existing Riot index and share its mutation generation and 60-second TTL. It SHALL publish complete snapshots atomically, treat partial/corrupt snapshots as misses, coalesce concurrent local builds and prevent an old build from filling a new generation. Index construction SHALL avoid per-member account queries. Committed member creation/rename/deletion, account linking/unlinking/renaming and game ingestion/exclusion/restoration SHALL invalidate applicable results through shared generation changes; rollback SHALL NOT publish a new generation. Missing or unavailable Valkey SHALL fall back to DB with equivalent matching, ordering and limits. The server SHALL authenticate before any index access. A failure to load either database source SHALL return an autocomplete error rather than a partial success response.

#### Scenario: Renaming with a warm cache

- **WHEN** an authorized member rename commits after the old name was cached
- **THEN** subsequent requests SHALL use the new generation, offer the new name and ignore late fills from the old generation

#### Scenario: Unauthenticated request with warm indexes

- **WHEN** a caller lacks a current valid session but matching suggestions are cached
- **THEN** the API SHALL return 401 before querying either index or exposing suggestions

#### Scenario: Cache unavailable

- **WHEN** Valkey is missing or unavailable but PostgreSQL is healthy
- **THEN** both suggestion types SHALL use equivalent DB fallback results and final navigation SHALL remain functional

### Requirement: Search exposes only permitted member information

Member names SHALL be visible to all authenticated roles under the current name-display policy. Search indexes, API responses, result HTML and client props SHALL omit birth years, Discord login-account information and authentication credentials. New member suggestions SHALL expose only the explicit member fields in this contract; legacy suggestions SHALL retain their smaller projection. The API SHALL retain `Cache-Control: private, no-store`. Shared business cache access SHALL NOT replace current DB authorization.

#### Scenario: Viewer searches after an owner

- **WHEN** a viewer searches using indexes already warmed by an owner
- **THEN** names and bounded Riot ID previews SHALL be visible while birth years, login-account records and privileged controls SHALL remain absent

### Requirement: Mixed autocomplete preserves accessible interaction

The form SHALL retain 200ms debounce, cancellation and stale-response suppression, combobox/listbox roles, pointer selection and Arrow/Enter/Escape behavior for both candidate types. Enter during IME composition SHALL NOT select or submit. Candidate text SHALL be escaped and internal navigation SHALL be constructed from validated types and IDs rather than an arbitrary response URL. The client SHALL validate both candidate shapes and preview bounds. Failure guidance, loading state, search results and missing-user text SHALL describe name and Riot ID input. Autocomplete errors SHALL leave direct GET search usable.

#### Scenario: Korean composition and delayed response

- **WHEN** a user composes a Korean name and a response for an older input arrives
- **THEN** composition Enter SHALL not navigate and the old response SHALL not replace the latest suggestions

#### Scenario: Keyboard or pointer selects a member

- **WHEN** the user selects a member option by click or Arrow keys followed by Enter
- **THEN** both interactions SHALL navigate to that same member UUID

#### Scenario: Autocomplete fails

- **WHEN** the suggestion request fails temporarily
- **THEN** the form SHALL display retry guidance for names and nicknames while permitting manual GET submission
