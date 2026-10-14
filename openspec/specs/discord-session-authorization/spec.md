# discord-session-authorization

## Purpose

Enforce current database authority, independent session revocation and membership reconciliation.

## Requirements

### Requirement: Sessions are server-stored independently revocable and bounded

The system SHALL issue a new v5 signed cookie containing only a cryptographically random session reference and lifecycle metadata. The reference SHALL contain at least 256 bits of randomness and only its hash SHALL be persisted. The cookie SHALL be HttpOnly, Secure in production, SameSite=Lax and Path=/. The database session SHALL identify the login account and authenticated guild, have a maximum absolute lifetime of 30 days and support revocation. Cookies SHALL NOT contain Discord tokens, profile data or authoritative role claims. Legacy v4 and older sessions SHALL be rejected. AUTH_SECRET rotation SHALL invalidate all existing cookies. User OAuth token expiry or Discord app disconnection alone SHALL NOT invalidate an already issued LLVY session.

#### Scenario: Legacy forged expired or revoked session

- **WHEN** a caller presents a legacy, tampered, expired, unknown or database-revoked session cookie
- **THEN** the request SHALL be unauthenticated regardless of route-level optimistic checks

#### Scenario: Guild setting or signing secret changes

- **WHEN** DISCORD_GUILD_ID no longer matches the session's admitted guild or AUTH_SECRET changes
- **THEN** the old session SHALL NOT grant protected access without a new eligible login

### Requirement: Existing protected requests depend on local account session and authority

Existing viewer/admin/owner protected reads and ordinary business mutations SHALL authorize through an active login account, active unexpired DB session, admitted guild matching current configuration and current owner identity or active admin grant as appropriate. These requests SHALL NOT perform Discord membership lookups, expire account admission based on membership-evidence age or become unavailable solely because Discord is unavailable or its circuit breaker is open. New login and administrator grant SHALL still require fresh eligible membership confirmation. A database authorization failure SHALL NOT permit protected access.

#### Scenario: Discord outage after old membership confirmation

- **WHEN** the account and session remain active but the last membership confirmation is older than one day and Discord is unavailable
- **THEN** existing protected requests SHALL use current DB authority without a Discord call or an evidence-age failure

#### Scenario: Owner revokes authority during Discord outage

- **WHEN** an owner with a valid active session revokes an administrator while Discord or the bot is unavailable
- **THEN** revocation SHALL proceed through local DB checks without requiring membership confirmation of the owner or target

### Requirement: Membership lookup results have version protection without user tokens

Session storage SHALL NOT contain user access/refresh tokens, provider token ciphertext, provider-expiry fields or refresh leases. Login, administrator grant and scheduled membership reconciliation SHALL use the configured server bot token and stable verified/persisted Discord account ID independently of individual sessions. Membership results SHALL be stored per account and configured guild with version protection so an obsolete result cannot overwrite a newer account admission/denial decision. Result storage SHALL NOT reactivate revoked sessions or grants. External calls SHALL NOT hold database row locks through network waits.

#### Scenario: Scheduled check has no user token or session

- **WHEN** daily reconciliation checks a registered active account whose user token was discarded and which has no active LLVY session
- **THEN** the bot SHALL perform membership lookup without user-token refresh or target re-login

#### Scenario: Obsolete response arrives

- **WHEN** an older positive or negative bot lookup completes after a newer admission/denial decision was stored
- **THEN** conditional storage SHALL reject the obsolete account-state update and SHALL NOT revive any revoked session or grant

#### Scenario: Bot token is rotated

- **WHEN** serving instances receive a valid replacement DISCORD_BOT_TOKEN
- **THEN** later permitted membership requests SHALL use it without replacing otherwise valid LLVY session cookies or bypassing shared rate-limit waits

### Requirement: Departed accounts are reconciled once daily

The system SHALL schedule a CRON_SECRET-authenticated membership reconciliation once per day across all registered active accounts, including accounts with no active session. It SHALL use bounded paginated individual-member lookups, shared rate controls and a database execution lease to prevent duplicate overlapping workers. It SHALL persist progress and complete/partial/error status, resume unprocessed accounts and expose the last full completion time and bounded status summary to owner. It SHALL NOT fetch the full guild roster or treat an unchecked account as absent. Scheduling delays, partial runs and provider outages MAY extend departure-detection time beyond one day; evidence age alone SHALL NOT enforce a deadline.

#### Scenario: Daily run includes inactive users

- **WHEN** an authorized daily worker enumerates registered active accounts
- **THEN** it SHALL check both accounts with sessions and accounts with no sessions through bounded bot lookups

#### Scenario: Duplicate or interrupted maintenance

- **WHEN** workers overlap or a run exhausts its time/request budget or stops on a shared circuit breaker
- **THEN** only a current lease holder SHALL advance that run, its remaining cursor and partial status SHALL be preserved, and later maintenance SHALL resume without suspending unprocessed accounts

#### Scenario: Login and daily maintenance compete for bot capacity

- **WHEN** a healthy login or administrator lookup temporarily holds the shared bot permit while reconciliation has remaining execution time
- **THEN** reconciliation SHALL wait for the same target and continue within the current run after capacity becomes available rather than recording a provider failure or postponing that target solely due to transient contention

#### Scenario: Maintenance wait consumes its execution budget

- **WHEN** shared local contention lasts until reconciliation cannot safely start another bounded member request within its execution budget
- **THEN** the run SHALL preserve the unchecked target and partial cursor without increasing the provider/DB failure count or suspending that target

#### Scenario: Invalid scheduler credential

- **WHEN** a caller invokes membership maintenance without a valid CRON_SECRET
- **THEN** no bot lookup, account suspension or privileged maintenance SHALL occur

### Requirement: Confirmed departure revokes account sessions and grants atomically

An explicit Unknown Member (10007) response or a valid pending-membership response obtained during login, administrator grant or reconciliation SHALL atomically suspend an existing account, store denial, revoke all its active sessions and active administrator grant, and record a system/authorized-operation audit under the common account lock. This SHALL apply to owner accounts as well. Account records, game data and historical grants/audits SHALL be retained. Bot authentication/access failure, Unknown Guild, timeout, rate limit, server error or malformed responses SHALL NOT suspend an account, revoke its grant or extend its last successful membership time. Provider failure SHALL leave unresolved accounts available through their existing valid local authority and prevent new login/grant based on an unconfirmed result.

#### Scenario: Daily check confirms administrator departure

- **WHEN** the bot explicitly confirms that an administrator has left or is pending
- **THEN** account suspension, all existing-session revocations, active-grant revocation and audit SHALL commit together and its next protected request SHALL be rejected

#### Scenario: Bot configuration or provider failure

- **WHEN** membership lookup returns bot 401/403, Unknown Guild, timeout, 429, 5xx or invalid data
- **THEN** the account and its existing sessions/grant SHALL remain unchanged, membership success time SHALL NOT advance, and pending reconciliation SHALL be skipped or marked partial according to the shared controls

### Requirement: Rejoining requires fresh login and does not restore old authority

A suspended account SHALL become active only after a new eligible login verifies non-pending membership and atomically creates a new session with current membership evidence and login audit. Successful background checks or administrator grant requests SHALL NOT reactivate a suspended account. Old sessions, revoked grants and prior upload authority SHALL remain invalid. Rejoining non-owner accounts SHALL be viewer until owner explicitly creates a new admin grant. The configured owner SHALL derive owner authority from the current environment after a new eligible login.

#### Scenario: Former administrator rejoins

- **WHEN** a suspended former administrator rejoins and completes a new eligible login
- **THEN** the same account SHALL become active with a new viewer session, while old sessions and its former grant SHALL remain revoked

### Requirement: Every protected entry point derives current authority

The data-access layer, each Server Action and each Route Handler SHALL enforce current local account/session/guild/owner/grant authority. Proxy SHALL use only optimistic cookie checks and SHALL NOT be the sole authority. Long-lived shared caches SHALL NOT store account authorization or provider/session secrets. Role-partitioned business caches SHALL be accessed only after current authorization. APIs SHALL distinguish unauthenticated, forbidden and temporarily unavailable results.

#### Scenario: Viewer mutation and admin owner-only access

- **WHEN** viewer directly invokes uploads or management mutations, or admin directly invokes account-permission/audit queries or actions
- **THEN** access SHALL be denied before protected data is returned or business mutation is attempted

#### Scenario: Privilege change with cached business data

- **WHEN** an account's current privileges differ from a previously rendered role or shared business-cache key
- **THEN** each new protected request SHALL use current privileges and SHALL NOT disclose a prior role's data

### Requirement: Authorized mutations serialize with revocation and suspension

Mutation transactions SHALL revalidate active account and session, current guild and current owner identity or active grant inside the transaction without Discord calls or membership-evidence TTL checks. They SHALL retain authority locks through commit using a consistent order shared with session/grant revocation and scheduled account suspension. Completed revocation/suspension SHALL prevent subsequent old-session mutations from committing. Replay final persistence SHALL perform the same local checks even after earlier upload authorization. Required external lookup for login, administrator grant and reconciliation SHALL precede their database transactions.

#### Scenario: Mutation races revocation or daily suspension

- **WHEN** a mutation and administrator revocation or account suspension compete for authority locks
- **THEN** a mutation that acquired valid authority first SHALL commit before revocation/suspension completes, or revocation/suspension SHALL win and prevent the mutation; no old-session mutation SHALL newly commit after completed revocation/suspension

#### Scenario: Grant-time denial races administrator revocation

- **WHEN** a grant request discovers confirmed departure for an existing administrator while owner revokes that account
- **THEN** both operations SHALL lock target and actor accounts in the same UUID order before session/grant changes, including the actor lock required by revoked_by's foreign key; suspension and revocation SHALL serialize without a reversed account-lock order

#### Scenario: Departure is discovered before replay persistence

- **WHEN** daily reconciliation has suspended the account before a long replay operation reaches final persistence
- **THEN** persistence SHALL fail without committing business changes regardless of earlier upload authorization

### Requirement: Member names are visible while birth years and role capabilities remain protected

Viewer SHALL receive original unmasked game-member names in member lists, history, game participant data and nickname-search results and selection lists. Birth year SHALL remain omitted from viewer server payloads, HTML and client properties. Nickname-only autocomplete SHALL expose only account ID, game name and tag line; unified member suggestions SHALL follow the member-name-search projection contract. Admin/owner SHALL retain full member data and existing upload/game/member management. Only owner SHALL manage login-account privileges and query audits. Authentication separation SHALL NOT create a login-to-game-member mapping or expose birth years through cache/client DTOs. Shared cache namespaces SHALL distinguish incompatible projection contracts.

#### Scenario: Viewer browses member data after Discord login

- **WHEN** viewer requests member lists, history, game participant data or nickname-search choices
- **THEN** original game-member names SHALL be returned without masking, birth years SHALL remain omitted and no login-to-member mapping SHALL be returned

### Requirement: Logout and expired session cleanup remain operational

Logout SHALL attempt server-side session revocation and SHALL always clear the local cookie even if the DB/audit is unavailable. Logout SHALL NOT require a Discord call or provider-token deletion. Expired/revoked sessions and expired/consumed login attempts SHALL be removed through bounded maintenance work independently of membership reconciliation success or an open bot circuit. Maintenance SHALL retain independent CRON_SECRET authentication and SHALL NOT require Discord login.

#### Scenario: Logout during outage

- **WHEN** logout occurs while DB, Discord or audit storage is unavailable
- **THEN** local logout SHALL complete without displaying tokens or retaining the browser session cookie

#### Scenario: Local maintenance despite provider failure

- **WHEN** maintenance has a valid CRON_SECRET but bot reconciliation is unavailable or blocked
- **THEN** bounded cleanup of expired/revoked sessions and login attempts SHALL still proceed independently

### Requirement: Read authentication is scoped to one request

The system SHALL share the authentication promise within a React render or an explicitly scoped read handler. It MUST perform fresh database authentication on the next request and MUST isolate concurrent requests and users. Route and DAL authorization checks SHALL remain in place.

#### Scenario: API and DAL authenticate the same request

- **WHEN** the autocomplete handler and its DAL both require authentication
- **THEN** one database session lookup serves both checks

#### Scenario: Parallel requests and authority revocation

- **WHEN** multiple requests run concurrently or a session is revoked between requests
- **THEN** requests do not share authentication results and the next request observes revocation

#### Scenario: Authentication fails

- **WHEN** authentication returns null or throws
- **THEN** duplicate checks in that read scope share that result and no stale successful authority is used

### Requirement: Mutation authority remains fresh

The system MUST keep fresh authentication for mutation guards and upload token issuance, including when called inside a read scope. Transactional authority locks SHALL remain unchanged.

#### Scenario: Authority changes after a read

- **WHEN** a session is revoked after a read authentication result has been memoized
- **THEN** a mutation guard or explicit fresh session lookup rejects the revoked session
