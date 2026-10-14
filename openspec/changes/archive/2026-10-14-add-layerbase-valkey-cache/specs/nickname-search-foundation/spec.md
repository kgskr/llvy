## ADDED Requirements

### Requirement: Cached stored-account nickname search

The system SHALL provide an authenticated server search function for stored Riot accounts linked to members with active game history. It SHALL normalize NFC, surrounding whitespace and case, support nickname substring matching and an optional exact tag after `#`, treat LIKE wildcard characters literally, and return at most 20 accounts. Search results SHALL use the shared query cache and role-specific member name projection.

#### Scenario: Equivalent searches

- **WHEN** a user searches the same nickname with different letter case or surrounding whitespace
- **THEN** the searches use the same normalized cache key and return the same eligible accounts

#### Scenario: Excluded-only history

- **WHEN** an account appears only in excluded games
- **THEN** the account is absent from search results and becomes eligible when a game is restored

#### Scenario: Viewer result privacy

- **WHEN** a viewer searches a linked account
- **THEN** the result contains a masked member name and no birth year

### Requirement: Valkey nickname autocomplete

The system SHALL authenticate each autocomplete request and return at most 10 member-linked, active-history stored accounts whose normalized Riot IDs start with the provided prefix. It SHALL use Valkey core Sorted Set lexicographic lookup and store only account ID, nickname and tag. The index SHALL share mutation generations and a 60-second TTL with the query cache, publish complete snapshots atomically, and fall back to PostgreSQL when Valkey is unavailable.

#### Scenario: Partial nickname or tag

- **WHEN** a logged-in user enters a nickname prefix or `nickname#tag-prefix`
- **THEN** up to 10 matching accounts appear, with original display case preserved and no member personal information

#### Scenario: Index invalidation

- **WHEN** an account changes or a game is excluded or restored
- **THEN** the next autocomplete request rebuilds its generation from eligible accounts and a delayed old rebuild cannot populate the new generation

### Requirement: Search navigation

The landing SHALL provide an active search form and accessible debounced autocomplete. Search SHALL resolve an exact normalized nickname and optional exact tag to its currently linked member using PostgreSQL. A unique member SHALL redirect to its detail page. Multiple matching members SHALL present account choices without choosing one arbitrarily. No eligible linked member SHALL redirect to a dedicated missing-user page.

#### Scenario: Known account

- **WHEN** the user searches a stored eligible nickname linked to a single member
- **THEN** the browser navigates to that member's information page

#### Scenario: Unknown or unlinked account

- **WHEN** no eligible linked member matches, including unlinked or excluded-only accounts
- **THEN** the browser navigates to the missing-user page with an option to search again

#### Scenario: Ambiguous nickname

- **WHEN** the same nickname matches different members and no tag disambiguates it
- **THEN** the user chooses from accounts whose member names are masked for viewers and no birth years appear
