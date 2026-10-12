## ADDED Requirements

### Requirement: Exact submission uses indexed normalized keys
Exact member search SHALL filter members and eligible Riot accounts in PostgreSQL using indexed normalized keys. Stored keys SHALL be maintained automatically on insert/update and populated for existing rows. Normalization SHALL preserve NFC, ECMAScript trimming and locale-independent Unicode lowercase, including dotted I and contextual Final Sigma.

#### Scenario: Many unrelated members and accounts
- **WHEN** a user submits an exact name or Riot ID among many unrelated rows
- **THEN** the application SHALL receive only matching member identities and page data, and PostgreSQL SHALL have usable equality indexes for both sources

#### Scenario: Existing rows and renamed rows
- **WHEN** migration runs over existing data or an existing member/account is renamed
- **THEN** the normalized keys SHALL match the current display text without a separate backfill command or stale key window

#### Scenario: PostgreSQL has older Unicode tables
- **WHEN** a supported PostgreSQL 17 database normalizes characters introduced in Unicode 16 or 17
- **THEN** canonical composition and combining order SHALL agree with the application normalization, without requiring a database major-version upgrade

### Requirement: Search preserves complete member-level results
The system SHALL merge name and Riot matches by member ID before counting and paging. It SHALL return 20 members per page ordered by normalized UTF-8 name and UUID, include members without games for name search, require active history for Riot matches, and retain nickname-only mode, live authentication and minimal DTOs.

#### Scenario: Many accounts and homonyms
- **WHEN** one member has over 20 matching accounts and over 20 members share a name
- **THEN** every matching member SHALL remain reachable once across pages, and each preview SHALL contain at most two linked Riot IDs
