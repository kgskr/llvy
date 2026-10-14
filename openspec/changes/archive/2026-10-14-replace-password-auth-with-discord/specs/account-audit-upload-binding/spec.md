## ADDED Requirements

### Requirement: New audit events identify independent login accounts
New authentication and authorized-work events SHALL identify the verified login account, Discord user ID, current role, display-name snapshot, applicable grant ID, action/target/result/time and request correlation. New events SHALL NOT use a game-member ID as actor identity. Account IDs SHALL be distinct from business-target member/Riot/game IDs. Existing event coverage and transactional success auditing SHALL remain, including grant/revoke and replay outcomes; failed/cancelled login auditing SHALL be bounded. User OAuth tokens, bot tokens, credential hashes, codes, state, cookies and client secrets SHALL NOT be recorded. Existing legacy audit snapshots SHALL remain readable and SHALL NOT be rewritten as guessed Discord accounts.

#### Scenario: Administrator changes a game member
- **WHEN** an authenticated administrator updates a game member
- **THEN** actor SHALL identify the login account/current grant and target SHALL identify the game member; no identity link SHALL be created between them

#### Scenario: Success audit insertion fails
- **WHEN** audit insertion for a business change or administrator grant/revoke fails
- **THEN** the associated database change SHALL roll back in the same transaction

#### Scenario: Legacy audit display
- **WHEN** owner reads a pre-transition member/credential-based audit event
- **THEN** its original snapshot SHALL remain available and SHALL be distinguished from a new login-account actor

### Requirement: Scheduled suspension is audited without erasing history
Membership-based account suspension SHALL record a bounded system-maintenance or authorized-operation audit with target account/grant, reason and correlation, atomically with account suspension and session/grant revocation. Maintenance events SHALL NOT impersonate a logged-in owner/user. Account, game and prior audit history SHALL remain preserved. Suspended accounts SHALL fail existing upload processing and final persistence authorization, and rejoining SHALL NOT restore revoked grants or prior reservation authority.

#### Scenario: Suspension audit fails
- **WHEN** a daily worker confirms departure but cannot insert the suspension audit
- **THEN** suspension and session/grant revocation SHALL roll back together, the run SHALL record failure/partial progress, and no unaudited partial authority change SHALL commit

#### Scenario: Departure during upload
- **WHEN** the account is suspended before replay final persistence
- **THEN** processing SHALL reject its old authority, retain business/audit history and leave abandoned uploads eligible for existing bounded expiry cleanup

### Requirement: Audit reads remain exclusively owner-authorized
Only current owner SHALL query or receive audit records. Menus, pages and underlying queries SHALL enforce that rule independently. No account SHALL gain application audit-edit/delete functions through this transition, and audit DTOs SHALL exclude session/provider credentials.

#### Scenario: Admin directly requests audit records
- **WHEN** admin directly accesses an audit page or query
- **THEN** no audit query or record disclosure SHALL occur

### Requirement: Upload reservations bind current account and grant identity
New reservations SHALL bind the verified actor's login account, current role and current grant when admin. Reservation/token/process endpoints SHALL require current admin/owner authority and match that identity before allowing work. The reservation SHALL NOT be bound to a game member or personal key. Final replay persistence SHALL independently revalidate current authority. Existing pending nonce binding, Blob callback signature, exact store/path constraints, state transitions, duplicate handling and bounded resource protections SHALL remain. Resource budget identity SHALL remain stable across repeated logins of one account.

#### Scenario: Another account or grant processes a reservation
- **WHEN** a caller uses a reservation issued to another login account or another administrator grant
- **THEN** processing SHALL be denied without ingesting or deleting a Blob through the mismatched reservation

#### Scenario: Regrant does not revive an old upload
- **WHEN** an administrator is revoked and subsequently regranted a new grant ID
- **THEN** a reservation bound to the prior grant SHALL remain unusable by that account

#### Scenario: Owner designation changes
- **WHEN** the configured owner changes to another Discord account
- **THEN** the new owner SHALL NOT process the previous owner's reservation as its bound actor, and the previous account SHALL NOT preserve owner processing authority

#### Scenario: Repeated login preserves limits
- **WHEN** the same account creates multiple eligible sessions while consuming upload/ingestion request budgets
- **THEN** new sessions SHALL NOT reset its stable account resource allowance or bypass existing global limits

### Requirement: Transition rejects old authority while preserving business history
Migration SHALL add new account/grant/session/attempt models, shared circuit controls and reconciliation state and nullable new audit/upload actor fields without deleting or linking existing game members, Riot accounts, games or audit snapshots. Existing personal credentials SHALL be retired at cutover and SHALL NOT be automatically mapped into account grants. Their historical references SHALL NOT block game-member deletion. Legacy sessions and legacy upload actor bindings SHALL NOT authorize new user processing; expired legacy reservations SHALL remain eligible for the existing exact-Blob maintenance cleanup.

#### Scenario: Old key session or pending reservation after cutover
- **WHEN** a caller submits a shared/password key, a legacy session or a legacy member/credential-bound reservation to user endpoints
- **THEN** it SHALL NOT authorize a login or replay processing and no account mapping SHALL be inferred

#### Scenario: Legacy reservation expires
- **WHEN** independently authorized maintenance encounters an expired legacy reservation
- **THEN** it SHALL apply the existing exact store/path cleanup and retain appropriate legacy audit attribution without inventing an account actor

#### Scenario: First owner starts assigning administrators
- **WHEN** the configured owner logs in after cutover and eligible former administrators log in
- **THEN** their accounts SHALL be selectable for explicit new grants while prior keys and revoked sessions SHALL remain invalid
