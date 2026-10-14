## ADDED Requirements

### Requirement: Login accounts are independent of game members
The system SHALL persist a unique Discord user ID and bounded username/display information in a dedicated login-account model for successfully admitted users. Login accounts, administrator grants and sessions SHALL NOT contain a game-member/Riot-account relationship. The system SHALL NOT infer or expose such a relationship from names or Discord identity. Concurrent first logins and display-name changes SHALL retain one stable account per Discord user ID.

#### Scenario: Display-name match or change
- **WHEN** a login account has the same name as a game member, or its Discord name changes
- **THEN** it SHALL remain an independent login account, SHALL NOT be linked to that member, and a name change SHALL NOT create a second account

#### Scenario: Simultaneous account registration
- **WHEN** two eligible first-login attempts use the same Discord user ID
- **THEN** they SHALL resolve one account through a database uniqueness constraint without duplicate membership/role data

### Requirement: Owner authority derives from the configured Discord user ID
After active account and valid local session/configured-guild checks without a per-request Discord call or membership-evidence expiry, the system SHALL assign owner only when the account's verified Discord user ID exactly matches current DISCORD_OWNER_USER_ID. Otherwise it SHALL assign admin for an active account grant and viewer for all other accounts. Discord guild ownership, Discord roles, submitted roles and game-member data SHALL NOT grant LLVY owner/admin authority. Owner authority SHALL NOT be assignable or removable through administrator-management actions.

#### Scenario: Environment-designated owner
- **WHEN** an eligible logged-in account matches DISCORD_OWNER_USER_ID
- **THEN** it SHALL receive owner authority without a password or administrator grant

#### Scenario: Discord server owner or client role claim
- **WHEN** an eligible non-designated account owns the Discord server, holds a Discord role or submits an owner role claim
- **THEN** it SHALL receive only its active LLVY administrator grant or the viewer role

#### Scenario: Owner environment changes
- **WHEN** a serving instance receives a new DISCORD_OWNER_USER_ID setting
- **THEN** its next protected request SHALL use that setting, and the previous owner's existing cookie SHALL NOT preserve owner authority; the previous account SHALL resolve to its current grant or viewer

### Requirement: Only owner can list registered login accounts
The system SHALL provide /admin/users and a user-permissions menu exclusively to current owner. The list SHALL contain accounts that have completed eligible LLVY login, bounded search/pagination, Discord ID, display information, last login, derived role, active/suspended account status and membership evidence time/status. It SHALL NOT pretend to represent every Discord server member or expose tokens, session credentials or game-member mappings. A historical membership timestamp SHALL NOT be represented as permanent current membership.

#### Scenario: Administrator or viewer requests account data
- **WHEN** an admin/viewer directly invokes the page, account query or related action
- **THEN** access SHALL be denied without returning account records or running a privileged account query

#### Scenario: Server member has never used LLVY
- **WHEN** a person belongs to the Discord server but has not completed an eligible LLVY login
- **THEN** the person SHALL NOT appear in the registered-account list

### Requirement: Owner grants administrator authority to an eligible registered account
Only current owner SHALL grant admin to an existing active non-owner login account. Suspended accounts SHALL require a new eligible login before becoming grant targets. The system SHALL freshly verify the target's configured-guild membership using the configured bot token and the target's persisted Discord user ID; historical registration alone SHALL NOT qualify. Target session presence, user OAuth tokens, recent login and target re-login SHALL NOT be required for an account that remains active. The grant transaction SHALL verify that its fresh positive evidence is still current and SHALL NOT grant over a newer stored denial. Each grant SHALL have a new immutable ID, and a database constraint plus transaction locking SHALL allow at most one active grant per account. Grant and success audit SHALL commit atomically.

#### Scenario: Eligible target already logged in as viewer
- **WHEN** owner grants admin after fresh confirmation of the target's membership
- **THEN** one active grant SHALL commit and the target's next protected request SHALL resolve as admin without a game-member link or issued key

#### Scenario: Target has no active login session
- **WHEN** a registered eligible target has been inactive for longer than its LLVY session lifetime and owner requests an admin grant
- **THEN** fresh bot-member confirmation SHALL allow the grant without asking the target to log in again, and its next eligible login SHALL resolve as admin

#### Scenario: Stale membership or unavailable bot lookup
- **WHEN** the target is suspended, has left, is pending or cannot be confirmed due to bot/API failure or an open shared breaker
- **THEN** no grant SHALL commit and membership denial SHALL be distinguished from configuration/access or temporary failure

#### Scenario: Duplicate grant or owner target
- **WHEN** concurrent requests try to grant the same account, an active grant exists, or the target is current owner
- **THEN** no second active grant or owner authority change SHALL occur

#### Scenario: Membership denial races a grant
- **WHEN** a newer membership denial is stored after the target's fresh positive lookup and before the grant transaction
- **THEN** the grant SHALL be rejected without overwriting denial evidence or creating administrator authority

### Requirement: Administrator revocation invalidates existing sessions
Only current owner SHALL revoke admin. Target membership/provider availability SHALL NOT be required for revocation. Revocation SHALL atomically retire the active grant, invalidate all of the target account's pre-existing sessions and record its audit. Revocation SHALL serialize with authorized mutations. Regrant SHALL create a new grant identity and SHALL NOT revive revoked sessions or reservations bound to the old grant. After a new eligible login without a grant the account SHALL be viewer.

#### Scenario: Revoked administrator retries privileged work
- **WHEN** revocation has completed and the target presents an old session
- **THEN** protected data/work SHALL be rejected even if its cookie signature and original expiry remain valid

#### Scenario: Revocation followed by regrant
- **WHEN** owner regrants the same account after revocation
- **THEN** the account SHALL have a new grant ID and old sessions SHALL remain invalid

### Requirement: Game-member administration does not control login authority
Member listings SHALL NOT derive administrator flags from authentication credentials, and member forms SHALL NOT offer administrator-key issuance/revocation. Game-member deletion SHALL NOT be blocked because a login account is administrator and SHALL NOT revoke or alter login-account roles. Existing Riot unlinking and historical game/audit preservation SHALL remain. Legacy credential references SHALL NOT obstruct member deletion.

#### Scenario: Game member deletion after authentication separation
- **WHEN** an authorized administrator deletes a game member while an independent login account remains administrator
- **THEN** normal validated member deletion/unlinking SHALL proceed without changing that account's authority or deleting historical audit snapshots
