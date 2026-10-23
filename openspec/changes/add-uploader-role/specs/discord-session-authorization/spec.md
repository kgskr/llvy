## MODIFIED Requirements

### Requirement: Existing protected requests depend on local account session and authority

Existing viewer/uploader/admin/owner protected reads and ordinary business mutations SHALL authorize through an active login account, active unexpired DB session, admitted guild matching current configuration and current owner identity or active administrator/uploader grant as required by the operation. These requests SHALL NOT perform Discord membership lookups, expire account admission based on membership-evidence age or become unavailable solely because Discord is unavailable or its circuit breaker is open. New login and administrator/uploader grant SHALL still require fresh eligible membership confirmation. A database authorization failure SHALL NOT permit protected access.

#### Scenario: Discord outage after old membership confirmation

- **WHEN** the account and session remain active but the last membership confirmation is older than one day and Discord is unavailable
- **THEN** existing protected requests SHALL use current DB authority without a Discord call or an evidence-age failure

#### Scenario: Owner revokes authority during Discord outage

- **WHEN** an owner with a valid active session revokes an administrator while Discord or the bot is unavailable
- **THEN** revocation SHALL proceed through local DB checks without requiring membership confirmation of the owner or target

### Requirement: Membership lookup results have version protection without user tokens

Session storage SHALL NOT contain Discord user access/refresh tokens, provider token ciphertext, provider-expiry fields or provider refresh leases. Hashes and lifecycle fields for LLVY-issued desktop credentials SHALL remain distinct from provider credentials and SHALL NOT introduce Discord token persistence or provider refresh. Login, administrator/uploader grant and scheduled membership reconciliation SHALL use the configured server bot token and stable verified/persisted Discord account ID independently of individual sessions. Membership results SHALL be stored per account and configured guild with version protection so an obsolete result cannot overwrite a newer account admission/denial decision. Result storage SHALL NOT reactivate revoked sessions or grants. External calls SHALL NOT hold database row locks through network waits.

#### Scenario: Scheduled check has no user token or session

- **WHEN** daily reconciliation checks a registered active account whose user token was discarded and which has no active LLVY session
- **THEN** the bot SHALL perform membership lookup without user-token refresh or target re-login

#### Scenario: Obsolete response arrives

- **WHEN** an older positive or negative bot lookup completes after a newer admission/denial decision was stored
- **THEN** conditional storage SHALL reject the obsolete account-state update and SHALL NOT revive any revoked session or grant

#### Scenario: Bot token is rotated

- **WHEN** serving instances receive a valid replacement DISCORD_BOT_TOKEN
- **THEN** later permitted membership requests SHALL use it without replacing otherwise valid LLVY session cookies or bypassing shared rate-limit waits

### Requirement: Confirmed departure revokes account sessions and grants atomically

An explicit Unknown Member (10007) response or a valid pending-membership response obtained during login, administrator/uploader grant or reconciliation SHALL atomically suspend an existing account, store denial, revoke all its active browser and desktop sessions, associated desktop credentials and active administrator and uploader grants, and record a system/authorized-operation audit under the common account lock. This SHALL apply to owner accounts as well. Account records, game data and historical grants/audits SHALL be retained. Bot authentication/access failure, Unknown Guild, timeout, rate limit, server error or malformed responses SHALL NOT suspend an account, revoke its grant or extend its last successful membership time. Provider failure SHALL leave unresolved accounts available through their existing valid local authority and prevent new login/grant based on an unconfirmed result.

#### Scenario: Daily check confirms administrator departure

- **WHEN** the bot explicitly confirms that an administrator has left or is pending
- **THEN** account suspension, all existing-session revocations, active-grant revocation and audit SHALL commit together and its next protected request SHALL be rejected

#### Scenario: Bot configuration or provider failure

- **WHEN** membership lookup returns bot 401/403, Unknown Guild, timeout, 429, 5xx or invalid data
- **THEN** the account and its existing sessions/grant SHALL remain unchanged, membership success time SHALL NOT advance, and pending reconciliation SHALL be skipped or marked partial according to the shared controls

#### Scenario: Departed account has connected upload devices

- **WHEN** confirmed departure suspends an account with desktop sessions and pending desktop jobs
- **THEN** the same account-locked transaction revokes device authority and invalidates unfinished upload authority, and neither refresh nor final replay persistence restores it

#### Scenario: Daily check confirms uploader departure

- **WHEN** the bot confirms an uploader has left or is pending
- **THEN** the same transaction suspends the account, retires the uploader grant, revokes browser/desktop authority and unfinished approvals, and records audit; old uploads cannot persist

### Requirement: Rejoining requires fresh login and does not restore old authority

A suspended account SHALL become active only after a new eligible login verifies non-pending membership and atomically creates a new session with current membership evidence and login audit. Successful background checks or administrator/uploader grant requests SHALL NOT reactivate a suspended account. Old sessions, revoked grants and prior upload authority SHALL remain invalid. Rejoining non-owner accounts SHALL be viewer until owner explicitly creates a new admin grant or owner/admin creates a new uploader grant. The configured owner SHALL derive owner authority from the current environment after a new eligible login.

#### Scenario: Former administrator rejoins

- **WHEN** a suspended former administrator rejoins and completes a new eligible login
- **THEN** the same account SHALL become active with a new viewer session, while old sessions and its former grant SHALL remain revoked

#### Scenario: Former uploader rejoins

- **WHEN** a suspended former uploader completes a new eligible login
- **THEN** the account receives viewer authority with a new session and neither its former grant nor its old reservations or devices revive

### Requirement: Every protected entry point derives current authority

The data-access layer, each Server Action and each Route Handler SHALL enforce current local account/session/guild/owner/grant authority. For browser routes, Proxy SHALL use only optimistic cookie checks and SHALL NOT be the sole authority. The separate desktop namespace SHALL use explicit bearer-aware handlers and service scope checks; routing past the browser cookie check SHALL not grant access. An actor delegated for upload SHALL not gain management or audit permissions from its account role alone. Long-lived shared caches SHALL NOT store account authorization or provider/session secrets. Role-partitioned business caches SHALL be accessed only after current authorization. APIs SHALL distinguish unauthenticated, forbidden and temporarily unavailable results.

#### Scenario: Viewer mutation and admin owner-only access

- **WHEN** viewer directly invokes uploads or management mutations, uploader invokes management or permission/audit operations, or admin invokes administrator-grant/revoke or audit queries/actions
- **THEN** access SHALL be denied before protected data is returned or business mutation is attempted

#### Scenario: Privilege change with cached business data

- **WHEN** an account's current privileges differ from a previously rendered role or shared business-cache key
- **THEN** each new protected request SHALL use current privileges and SHALL NOT disclose a prior role's data

#### Scenario: Desktop owner token reaches a management service

- **WHEN** an upload-scoped desktop actor is presented to a management operation
- **THEN** the operation rejects its scope even if the associated account is owner

#### Scenario: Admin manages uploader authority only

- **WHEN** admin invokes uploader grant or revoke with an eligible target
- **THEN** the server checks current management capability and target role; direct calls cannot change an admin or owner even when a forged UI request supplies that target

### Requirement: Authorized mutations serialize with revocation and suspension

Mutation transactions SHALL revalidate active account and session, current guild and current owner identity or active grant of the required kind inside the transaction without Discord calls or membership-evidence TTL checks. They SHALL retain authority locks through commit using a consistent order shared with session/grant revocation and scheduled account suspension. Completed revocation/suspension SHALL prevent subsequent old-session mutations from committing. Replay final persistence SHALL perform the same local checks even after earlier upload authorization. Required external lookup for login, administrator/uploader grant and reconciliation SHALL precede their database transactions.

Upload-capable authority SHALL NOT satisfy management capability. The transaction SHALL independently require uploader/admin/owner for replay ingestion and admin/owner for ordinary management. Uploader permission changes SHALL lock and revalidate the issuing administrator or owner as well as the target.

#### Scenario: Mutation races revocation or daily suspension

- **WHEN** a mutation and administrator/uploader revocation or account suspension compete for authority locks
- **THEN** a mutation that acquired valid authority first SHALL commit before revocation/suspension completes, or revocation/suspension SHALL win and prevent the mutation; no old-session mutation SHALL newly commit after completed revocation/suspension

#### Scenario: Grant-time denial races administrator revocation

- **WHEN** a grant request discovers confirmed departure for an existing administrator while owner revokes that account
- **THEN** both operations SHALL lock target and actor accounts in the same UUID order before session/grant changes, including the actor lock required by revoked_by's foreign key; suspension and revocation SHALL serialize without a reversed account-lock order

#### Scenario: Departure is discovered before replay persistence

- **WHEN** daily reconciliation has suspended the account before a long replay operation reaches final persistence
- **THEN** persistence SHALL fail without committing business changes regardless of earlier upload authorization

#### Scenario: Administrator loses authority while granting uploader

- **WHEN** an uploader-grant request has completed membership lookup but the issuer is revoked before the transaction obtains authority
- **THEN** no uploader grant commits; the old administrator request cannot delegate its former authority

### Requirement: Member names are visible while birth years and role capabilities remain protected

Viewer and uploader SHALL receive original unmasked game-member names in member lists, history, game participant data and nickname-search results and selection lists. All four authenticated roles SHALL receive birth years on existing member-read surfaces that expose them to admin/owner, including their server payloads, HTML and client properties. Viewer and uploader SHALL NOT gain other privileged data or management capabilities. Nickname-only autocomplete SHALL expose only account ID, game name and tag line; unified member suggestions SHALL follow the member-name-search projection contract. Admin/owner SHALL retain full member data and existing upload/game/member management. Owner and admin SHALL manage uploader grants and read the bounded account list. Only owner SHALL manage administrator grants, query audits and read owner-only reconciliation status. Uploader SHALL have upload capability but no manual member/account/game management capability. Authentication separation SHALL NOT create a login-to-game-member mapping or expose unrelated privileged information through cache/client DTOs. Shared cache namespaces SHALL distinguish incompatible projection contracts.

#### Scenario: Viewer browses member data after Discord login

- **WHEN** viewer requests member lists, history, game participant data or nickname-search choices
- **THEN** original game-member names SHALL be returned without masking, birth years SHALL be available on the existing member-read surfaces but omitted from minimal nickname-search suggestions, and no login-to-member mapping SHALL be returned

#### Scenario: Uploader requests an admin-populated cache

- **WHEN** an uploader requests member or game data whose administrator result is already cached
- **THEN** authorization and the uploader-specific cache key return the uploader projection, including birth year wherever the existing member-read contract exposes it to admin/owner, without returning unrelated administrator-only data
