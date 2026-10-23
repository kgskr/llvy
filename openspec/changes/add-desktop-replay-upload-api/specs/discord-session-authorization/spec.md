## MODIFIED Requirements

### Requirement: Sessions are server-stored independently revocable and bounded

For browser sessions, the system SHALL issue a new v5 signed cookie containing only a cryptographically random session reference and lifecycle metadata. The reference SHALL contain at least 256 bits of randomness and only its hash SHALL be persisted. The cookie SHALL be HttpOnly, Secure in production, SameSite=Lax and Path=/. The database session SHALL identify the login account and authenticated guild, have a maximum absolute lifetime of 30 days and support revocation. Cookies SHALL NOT contain Discord tokens, profile data or authoritative role claims. Legacy v4 and older sessions SHALL be rejected. AUTH_SECRET rotation SHALL invalidate all existing cookies. User OAuth token expiry or Discord app disconnection alone SHALL NOT invalidate an already issued LLVY session.

The session store SHALL distinguish browser and desktop kinds, default existing rows to browser and keep browser cookie acceptance limited to that kind. Desktop sessions SHALL follow desktop-device-authorization, share the same login account and guild, and be independently revocable with a maximum absolute lifetime of thirty days. Device tokens SHALL not be converted into browser cookies.

#### Scenario: Legacy forged expired or revoked session

- **WHEN** a caller presents a legacy, tampered, expired, unknown or database-revoked session cookie
- **THEN** the request SHALL be unauthenticated regardless of route-level optimistic checks

#### Scenario: Guild setting or signing secret changes

- **WHEN** DISCORD_GUILD_ID no longer matches the session's admitted guild or AUTH_SECRET changes
- **THEN** the old session SHALL NOT grant protected access without a new eligible login

#### Scenario: Device credential is presented to a browser route

- **WHEN** a caller supplies a desktop token as a browser cookie or bearer to a cookie-only protected route
- **THEN** it does not authenticate that route, while existing valid v5 browser cookies remain accepted

### Requirement: Membership lookup results have version protection without user tokens

Session storage SHALL NOT contain Discord user access/refresh tokens, provider token ciphertext, provider-expiry fields or provider refresh leases. Hashes and lifecycle fields for LLVY-issued desktop credentials SHALL remain distinct from provider credentials and SHALL NOT introduce Discord token persistence or provider refresh. Login, administrator grant and scheduled membership reconciliation SHALL use the configured server bot token and stable verified/persisted Discord account ID independently of individual sessions. Membership results SHALL be stored per account and configured guild with version protection so an obsolete result cannot overwrite a newer account admission/denial decision. Result storage SHALL NOT reactivate revoked sessions or grants. External calls SHALL NOT hold database row locks through network waits.

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

An explicit Unknown Member (10007) response or a valid pending-membership response obtained during login, administrator grant or reconciliation SHALL atomically suspend an existing account, store denial, revoke all its active browser and desktop sessions, associated desktop credentials and active administrator grant, and record a system/authorized-operation audit under the common account lock. This SHALL apply to owner accounts as well. Account records, game data and historical grants/audits SHALL be retained. Bot authentication/access failure, Unknown Guild, timeout, rate limit, server error or malformed responses SHALL NOT suspend an account, revoke its grant or extend its last successful membership time. Provider failure SHALL leave unresolved accounts available through their existing valid local authority and prevent new login/grant based on an unconfirmed result.

#### Scenario: Daily check confirms administrator departure

- **WHEN** the bot explicitly confirms that an administrator has left or is pending
- **THEN** account suspension, all existing-session revocations, active-grant revocation and audit SHALL commit together and its next protected request SHALL be rejected

#### Scenario: Bot configuration or provider failure

- **WHEN** membership lookup returns bot 401/403, Unknown Guild, timeout, 429, 5xx or invalid data
- **THEN** the account and its existing sessions/grant SHALL remain unchanged, membership success time SHALL NOT advance, and pending reconciliation SHALL be skipped or marked partial according to the shared controls

#### Scenario: Departed account has connected upload devices

- **WHEN** confirmed departure suspends an account with desktop sessions and pending desktop jobs
- **THEN** the same account-locked transaction revokes device authority and invalidates unfinished upload authority, and neither refresh nor final replay persistence restores it

### Requirement: Every protected entry point derives current authority

The data-access layer, each Server Action and each Route Handler SHALL enforce current local account/session/guild/owner/grant authority. For browser routes, Proxy SHALL use only optimistic cookie checks and SHALL NOT be the sole authority. The separate desktop namespace SHALL use explicit bearer-aware handlers and service scope checks; routing past the browser cookie check SHALL not grant access. An actor delegated for upload SHALL not gain management or audit permissions from its account role alone. Long-lived shared caches SHALL NOT store account authorization or provider/session secrets. Role-partitioned business caches SHALL be accessed only after current authorization. APIs SHALL distinguish unauthenticated, forbidden and temporarily unavailable results.

#### Scenario: Viewer mutation and admin owner-only access

- **WHEN** viewer directly invokes uploads or management mutations, or admin directly invokes account-permission/audit queries or actions
- **THEN** access SHALL be denied before protected data is returned or business mutation is attempted

#### Scenario: Privilege change with cached business data

- **WHEN** an account's current privileges differ from a previously rendered role or shared business-cache key
- **THEN** each new protected request SHALL use current privileges and SHALL NOT disclose a prior role's data

#### Scenario: Desktop owner token reaches a management service

- **WHEN** an upload-scoped desktop actor is presented to a management operation
- **THEN** the operation rejects its scope even if the associated account is owner
