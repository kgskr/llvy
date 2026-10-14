# discord-authentication

## Purpose

Admit verified Discord guild members through browser-bound OAuth and bounded provider access.

## Requirements

### Requirement: Discord authorization code login uses validated server configuration

The system SHALL use Discord OAuth2 Authorization Code login. It SHALL require server-only DISCORD_CLIENT_ID, DISCORD_CLIENT_SECRET, DISCORD_BOT_TOKEN, DISCORD_REDIRECT_URI, DISCORD_GUILD_ID, DISCORD_OWNER_USER_ID and an independent AUTH_SECRET of at least 32 UTF-8 bytes after trimming. User login SHALL request only identify, obtain the verified user ID from Discord's current-user endpoint, and treat Discord IDs as exact decimal strings. Guild membership SHALL use the configured bot's individual-member REST endpoint. Production callback URLs SHALL use HTTPS and SHALL be configured independently of caller-controlled Host or forwarding headers. Local HTTP SHALL be limited to explicitly registered localhost development URLs.

#### Scenario: Invalid core authority configuration

- **WHEN** AUTH_SECRET, DISCORD_GUILD_ID or DISCORD_OWNER_USER_ID is absent/malformed or the signing secret is too short
- **THEN** no login session or protected access SHALL be granted and the response SHALL disclose no secret values

#### Scenario: Invalid provider configuration with existing sessions

- **WHEN** bot/OAuth credentials or callback configuration is invalid but local authority configuration and an existing account/session remain valid
- **THEN** affected provider-dependent flows SHALL be unavailable without secret disclosure, while existing protected requests SHALL continue using local DB authority

#### Scenario: Provider user ID is authoritative

- **WHEN** a callback supplies a role, user ID, guild ID or profile values that differ from verified Discord responses and server settings
- **THEN** those supplied values SHALL NOT determine account identity, guild admission or role

### Requirement: Login attempts are browser-bound expiring and single-use

The login start SHALL create a cryptographically random state and independent browser binding, persist only their hashes and a sanitized internal destination, and expire the attempt after 10 minutes. The callback SHALL validate query structure, state, browser binding and expiry and atomically consume a matching attempt before exchanging the code. Missing, duplicate, mismatched, expired or consumed callback parameters SHALL NOT issue a session. Browser binding cookies SHALL be HttpOnly, SameSite=Lax and Secure in production.

#### Scenario: Forged or cross-browser callback

- **WHEN** a callback has an unknown state, a mismatching browser binding, duplicate security parameters or no matching login cookie
- **THEN** the system SHALL reject it without exchanging a code or creating an account/session

#### Scenario: Concurrent callback replay

- **WHEN** two callbacks try to consume the same valid attempt
- **THEN** at most one SHALL exchange the code and create a login session

#### Scenario: Expired or cancelled attempt

- **WHEN** the attempt has expired or the user declines Discord authorization
- **THEN** no account or session SHALL be created; cancellation SHALL receive a cancellation message and an authenticated matching attempt SHALL be consumed/cleared

#### Scenario: Sustained login starts exceed daily cleanup capacity

- **WHEN** permitted login starts continue without completed Discord authorization and earlier attempts expire
- **THEN** each new attempt SHALL atomically reclaim a bounded batch of expired attempts with capacity greater than its one inserted row, preserve unexpired attempts, and skip rows locked by other transactions; expired storage SHALL NOT grow with sustained starts solely because daily maintenance deletes fewer rows

#### Scenario: Attempt insertion fails after expiry reclamation

- **WHEN** storing a new attempt fails after expired rows were selected for deletion
- **THEN** the transaction SHALL roll back both reclamation and insertion without issuing a new browser binding

### Requirement: Only confirmed members of the configured guild are admitted

The system SHALL use the user's transient OAuth token only to obtain identity and SHALL use Authorization: Bot with DISCORD_BOT_TOKEN to call GET /guilds/{configured_guild_id}/members/{verified_user_id}. It SHALL validate identify scope, token response, identity and member response structures, including matching user IDs, before granting access. A member with pending equal to true SHALL NOT be admitted. Confirmed eligible membership SHALL precede account registration, including for the environment-designated owner. Account upsert, membership evidence, session creation and successful login audit SHALL commit atomically. Non-members SHALL NOT be automatically added to the Discord guild. No user access/refresh token SHALL be persisted or reused after the callback ends.

#### Scenario: First eligible login

- **WHEN** a new Discord account successfully authenticates and is a confirmed non-pending member of the configured guild
- **THEN** one independent login account and one new session SHALL be created, successful login SHALL be audited, and no game member or Riot account SHALL be created or linked

#### Scenario: Non-member or pending member

- **WHEN** membership is explicitly absent or the member is pending screening, including when the user ID matches DISCORD_OWNER_USER_ID
- **THEN** no new account/session SHALL be issued and the login page SHALL explain that confirmed membership is required

#### Scenario: Unverified response or audit failure

- **WHEN** a required OAuth scope is absent, provider response data is invalid or inconsistent, or successful-login audit insertion fails
- **THEN** no login session cookie SHALL be issued and no partial account/session transaction SHALL commit

### Requirement: Provider outages are distinct from membership denial

The system SHALL distinguish confirmed non-membership, authorization cancellation, invalid/expired login authorization, bot/server configuration or access errors and temporary Discord/DB failures. Only an explicit member-absence response such as Unknown Member (10007), or a valid pending member response, SHALL determine membership denial. Bot authentication/access failures, Unknown Guild, timeout, 429, 5xx or invalid responses SHALL NOT classify users as non-members or permanently rejected. Discord requests SHALL use fixed HTTPS endpoints, no shared caching, bounded time and response sizes, no credential-bearing redirect following and bounded retry behavior respecting Retry-After.

#### Scenario: Discord temporarily unavailable

- **WHEN** token exchange or initial membership confirmation fails temporarily
- **THEN** no session SHALL be issued, no permanent rejection SHALL be recorded, and the user SHALL receive a retryable message without raw provider data

#### Scenario: Bot cannot access the configured guild

- **WHEN** the bot token is invalid, the bot was removed, guild access is denied or the configured guild cannot be found
- **THEN** admission SHALL fail with a configuration/access or unavailable result without registering a non-member rejection or granting a session

### Requirement: Bot failures open a shared circuit breaker

All bot member lookups from login, administrator grant and reconciliation SHALL consult a PostgreSQL-backed circuit breaker before external calls. Bot 401 SHALL open the bot-authentication scope and bot 403 or Unknown Guild SHALL open the configured-guild scope for 60 seconds. A global 429 SHALL block all bot lookups for at least max(60 seconds, valid Retry-After); bucket limits SHALL respect Retry-After within their scope without being misclassified as global. These controls SHALL be shared across serving instances, use stable environment/application/guild/bucket keys and store no tokens or raw responses. Requests SHALL NOT retry the same bot configuration error within the current operation. An unavailable breaker store SHALL prevent new bot calls without treating accounts as absent. Existing locally authorized sessions SHALL NOT depend on the breaker.

#### Scenario: Repeated bot configuration failure across instances

- **WHEN** one instance records bot 401/403 or Unknown Guild and another instance tries a covered lookup before the shared deadline
- **THEN** the later lookup SHALL return a retryable unavailable result without calling Discord, creating a grant/session or classifying its target as absent

#### Scenario: Longer global rate-limit delay

- **WHEN** Discord returns a global 429 with a valid Retry-After greater than 60 seconds
- **THEN** all bot lookup paths SHALL remain blocked for the longer provider delay and token rotation SHALL NOT bypass it

#### Scenario: Open breaker during scheduled reconciliation

- **WHEN** the daily worker encounters an open breaker or opens one due to a bot failure
- **THEN** it SHALL stop covered remaining lookups, preserve incomplete progress and leave unresolved account authority unchanged

### Requirement: Circuit recovery permits one shared probe

After a circuit deadline, at most one instance SHALL atomically acquire an expiring probe lease for the blocked scope. Other covered requests SHALL avoid external calls until the probe finishes or its lease expires. A valid member/pending response or explicit Unknown Member SHALL establish successful bot access for recovery without implying target eligibility. Repeated bot configuration/global-rate failure SHALL reopen the circuit. Probe completion SHALL use version checks so obsolete responses cannot clear a newer block. Shared request budgets and bounded in-flight concurrency SHALL remain in addition to the circuit.

#### Scenario: Many instances reach the recovery deadline

- **WHEN** multiple instances attempt to recover the same blocked scope concurrently
- **THEN** only one SHALL call Discord as its probe and others SHALL wait within their local operation budgets without external calls; successful recovery SHALL permit later ordinary calls, while a newly opened circuit SHALL stop waiting requests

#### Scenario: Probe process dies or old response arrives

- **WHEN** the lease holder dies or an obsolete probe succeeds after a newer block
- **THEN** lease expiry SHALL allow later recovery, but the obsolete response SHALL NOT clear the newer circuit state

### Requirement: Healthy bot-call contention waits within a bounded operation

Shared bot concurrency SHALL remain bounded independently of circuit failure classification. A healthy in-flight call or exhausted local call budget SHALL NOT immediately fail another login, administrator grant or reconciliation lookup. The caller SHALL wait and recheck shared admission controls within a bounded deadline without retaining DB transactions or row locks while sleeping. Waiting SHALL NOT repeat OAuth code exchange, bypass an open circuit, retry provider configuration failures or create membership evidence before an actual validated response. A caller that exhausts its local wait budget SHALL return a retryable local-busy result without opening a circuit. A recovery lease released before any provider call SHALL NOT be recorded as a failed probe.

#### Scenario: Two valid login callbacks overlap

- **WHEN** independently browser-bound eligible login callbacks reach membership lookup while one healthy bot call is in flight and capacity becomes available within their wait budgets
- **THEN** both SHALL complete membership lookup and issue their sessions without asking either user to repeat OAuth authorization

#### Scenario: Waiting caller observes a provider block

- **WHEN** an in-flight lookup records 401/403 or a rate-limit block while another caller is waiting for capacity
- **THEN** the waiter SHALL stop without an external member call or retrying the failed configuration

#### Scenario: Capacity never becomes available

- **WHEN** a caller's local wait deadline expires before it can safely start a member request
- **THEN** it SHALL return a local-busy result without calling Discord, opening a circuit or changing account authority

### Requirement: Bot membership lookup uses minimal credentials and no background bot service

The bot SHALL be added to the configured guild with no additional administration, role-management, message or moderation permissions requested. The service SHALL use individual-member REST lookups from its existing backend and SHALL NOT require a persistent Gateway connection or separate running bot process. DISCORD_BOT_TOKEN SHALL be read only from server environment configuration and SHALL NOT be stored in the database, cookies, client DTOs, shared caches, application logs or audit records. The service SHALL NOT expose an unauthenticated arbitrary-member lookup or fetch the entire guild roster. User identify-only login and operator bot installation SHALL remain separate authorization flows.

#### Scenario: REST-only member confirmation

- **WHEN** an eligible user logs in and the configured bot has been added to the guild without any running Gateway process
- **THEN** individual-member REST confirmation SHALL suffice for admission without requiring a guilds.members.read user scope or message/administration permissions

#### Scenario: Credentials stay separated

- **WHEN** the backend performs identity and membership calls
- **THEN** the user token SHALL authenticate only the current-user identity call and the configured bot token SHALL authenticate only bot-member lookup; neither SHALL be disclosed to the browser or logs

### Requirement: Login routes preserve request budgets and internal destinations

Login start and callback SHALL use the existing trusted client identity and shared request-budget protections before expensive provider or storage work. Failure audit frequency SHALL be bounded. Only the exact login start/callback routes SHALL be added as public authentication exceptions. Login responses SHALL be no-store. Provider tokens, session credentials and client secrets SHALL NOT appear in client DTOs, application logs or audit records. Code/state SHALL be used only in the OAuth protocol and SHALL NOT be rendered as application data or logged. Successful login SHALL default to / and SHALL accept only sanitized internal destinations allowed by the current role.

#### Scenario: Exhausted login budget

- **WHEN** a trusted client or global login budget is exhausted
- **THEN** no new attempt, provider code exchange or session issuance SHALL occur beyond bounded failure auditing

#### Scenario: Unsafe or unauthorized return path

- **WHEN** redirectTo is external, normalizes outside the site, or names a path disallowed for the resulting role
- **THEN** successful login SHALL redirect to / without weakening that path's authorization

#### Scenario: Authentication prefix is not a blanket bypass

- **WHEN** a caller requests a protected path merely sharing the /api/auth prefix with a public login route
- **THEN** the caller SHALL still require the endpoint's normal authentication

### Requirement: Membership decisions precede registration

The system SHALL retain the newest membership decision by guild and Discord ID before account registration and SHALL reject older or repeated login evidence. It SHALL preserve existing account lock ordering, deny-only first-login behavior and atomic login/audit commits.

#### Scenario: Newer denial precedes delayed first login

- **WHEN** an absent or pending decision commits before an older eligible callback registers the same identity
- **THEN** no account, session or successful login audit SHALL be created by the older callback; a newer eligible login SHALL remain possible

#### Scenario: Login commits before newer denial

- **WHEN** concurrent transactions commit the eligible login before a newer denied decision
- **THEN** the denied decision SHALL suspend the account and revoke the session before it completes without a deadlock
