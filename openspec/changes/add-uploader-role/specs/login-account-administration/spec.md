## MODIFIED Requirements

### Requirement: Owner authority derives from the configured Discord user ID

After active account and valid local session/configured-guild checks without a per-request Discord call or membership-evidence expiry, the system SHALL assign owner only when the account's verified Discord user ID exactly matches current DISCORD_OWNER_USER_ID. Otherwise it SHALL assign admin for an active administrator grant, uploader for an active uploader grant and viewer for all other accounts. Owner takes precedence over admin, admin over uploader. Ordinary grant transitions SHALL prevent simultaneous active administrator and uploader grants under the common account lock. Discord guild ownership, Discord roles, submitted roles and game-member data SHALL NOT grant LLVY owner/admin/uploader authority. Owner authority SHALL NOT be assignable or removable through administrator-management actions.

#### Scenario: Environment-designated owner

- **WHEN** an eligible logged-in account matches DISCORD_OWNER_USER_ID
- **THEN** it SHALL receive owner authority without a password or administrator grant

#### Scenario: Discord server owner or client role claim

- **WHEN** an eligible non-designated account owns the Discord server, holds a Discord role or submits an owner role claim
- **THEN** it SHALL receive only its active LLVY administrator/uploader grant or the viewer role

#### Scenario: Owner environment changes

- **WHEN** a serving instance receives a new DISCORD_OWNER_USER_ID setting
- **THEN** its next protected request SHALL use that setting, and the previous owner's existing cookie SHALL NOT preserve owner authority; the previous account SHALL resolve to its current grant or viewer

#### Scenario: New role is derived from current database authority

- **WHEN** an active viewer receives an uploader grant
- **THEN** the next protected browser request resolves uploader without a new cookie, and no client role claim grants authority

### Requirement: Owner grants administrator authority to an eligible registered account

Only current owner SHALL grant admin to an existing active non-owner viewer or uploader login account. When promoting uploader, the transaction SHALL retire its uploader grant and revoke its existing browser/desktop sessions, device credentials and unfinished device authorizations atomically with the new admin grant and audit. Old upload bindings SHALL remain unusable; the target requires a new eligible login and new desktop approval. No hidden uploader grant SHALL survive promotion. Suspended accounts SHALL require a new eligible login before becoming grant targets. The system SHALL freshly verify the target's configured-guild membership using the configured bot token and the target's persisted Discord user ID; historical registration alone SHALL NOT qualify. Target session presence, user OAuth tokens, recent login and target re-login SHALL NOT be required to qualify an account that remains active for the grant. The post-promotion re-login requirement for an uploader SHALL still apply. The grant transaction SHALL verify that its fresh positive evidence is still current and SHALL NOT grant over a newer stored denial. Each grant SHALL have a new immutable ID, and a database constraint plus transaction locking SHALL allow at most one active grant per account. Grant and success audit SHALL commit atomically.

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

- **WHEN** concurrent requests try to grant the same account, an active administrator grant exists, or the target is current owner
- **THEN** no second active grant or owner authority change SHALL occur

#### Scenario: Membership denial races a grant

- **WHEN** a newer membership denial is stored after the target's fresh positive lookup and before the grant transaction
- **THEN** the grant SHALL be rejected without overwriting denial evidence or creating administrator authority

#### Scenario: Administrator attempts to promote an uploader

- **WHEN** admin calls the administrator-grant action directly for an uploader
- **THEN** the server denies the action before a membership lookup or grant mutation

### Requirement: Administrator revocation invalidates existing sessions

Only current owner SHALL revoke admin. Target membership/provider availability SHALL NOT be required for revocation. Revocation SHALL atomically retire the active grant, invalidate all of the target account's pre-existing sessions and record its audit. Revocation SHALL serialize with authorized mutations. Regrant SHALL create a new grant identity and SHALL NOT revive revoked sessions or reservations bound to the old grant. After a new eligible login the account SHALL be viewer; an uploader grant SHALL NOT be automatically created or restored. Owner or admin may subsequently make a distinct eligible uploader grant with a new identity.

#### Scenario: Revoked administrator retries privileged work

- **WHEN** revocation has completed and the target presents an old session
- **THEN** protected data/work SHALL be rejected even if its cookie signature and original expiry remain valid

#### Scenario: Revocation followed by regrant

- **WHEN** owner regrants the same account after revocation
- **THEN** the account SHALL have a new grant ID and old sessions SHALL remain invalid

## REMOVED Requirements

### Requirement: Only owner can list registered login accounts

**Reason**: Administrators need registered-account selection to manage uploader authority.

**Migration**: Replace the owner-only page/query rule with the owner/admin bounded list requirement, retaining owner-only administrator grants and audits.

## ADDED Requirements

### Requirement: Owner and administrators can list accounts for bounded permission management

The system SHALL provide /admin/users and a user-permissions menu to current owner and admin, exclusively for their permitted account-management operations. The list SHALL contain accounts that have completed eligible LLVY login, bounded search/pagination, Discord ID, display information, last login, derived role, active/suspended account status and membership evidence time/status. It SHALL NOT pretend to represent every Discord server member or expose tokens, session credentials or game-member mappings. A historical membership timestamp SHALL NOT be represented as permanent current membership.

#### Scenario: Uploader or viewer requests account data

- **WHEN** an uploader/viewer directly invokes the page, account query or related action
- **THEN** access SHALL be denied without returning account records or running a privileged account query

#### Scenario: Server member has never used LLVY

- **WHEN** a person belongs to the Discord server but has not completed an eligible LLVY login
- **THEN** the person SHALL NOT appear in the registered-account list

#### Scenario: Administrator opens permissions

- **WHEN** admin requests the registered-account list
- **THEN** the list is available with uploader controls only; administrator controls, audits and owner-only reconciliation operations are not exposed
