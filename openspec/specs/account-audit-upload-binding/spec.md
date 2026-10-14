# account-audit-upload-binding

## Purpose

Attribute audited work and upload ownership to the verified login account and current grant.

## Requirements

### Requirement: Audit events identify independent login accounts

Authentication and authorized-work events SHALL identify the verified login account, Discord user ID, current role, display-name snapshot, applicable grant ID, action/target/result/time and request correlation. Events SHALL NOT use a game-member ID as actor identity. Account IDs SHALL be distinct from business-target member/Riot/game IDs. Existing event coverage and transactional success auditing SHALL remain, including grant/revoke and replay outcomes; failed/cancelled login auditing SHALL be bounded. User OAuth tokens, bot tokens, credential hashes, codes, state, cookies and client secrets SHALL NOT be recorded. Historical audit snapshots SHALL remain readable without changing their original actor attribution.

#### Scenario: Administrator changes a game member

- **WHEN** an authenticated administrator updates a game member
- **THEN** actor SHALL identify the login account/current grant and target SHALL identify the game member; no identity link SHALL be created between them

#### Scenario: Success audit insertion fails

- **WHEN** audit insertion for a business change or administrator grant/revoke fails
- **THEN** the associated database change SHALL roll back in the same transaction

#### Scenario: Historical audit display

- **WHEN** owner reads a historical audit event
- **THEN** its original snapshot SHALL remain available without guessing a different actor identity

### Requirement: Scheduled suspension is audited without erasing history

Membership-based account suspension SHALL record a bounded system-maintenance or authorized-operation audit with target account/grant, reason and correlation, atomically with account suspension and session/grant revocation. Maintenance events SHALL NOT impersonate a logged-in owner/user. Account, game and prior audit history SHALL remain preserved. Suspended accounts SHALL fail existing upload processing and final persistence authorization, and rejoining SHALL NOT restore revoked grants or prior reservation authority.

#### Scenario: Suspension audit fails

- **WHEN** a daily worker confirms departure but cannot insert the suspension audit
- **THEN** suspension and session/grant revocation SHALL roll back together, the run SHALL record failure/partial progress, and no unaudited partial authority change SHALL commit

#### Scenario: Departure during upload

- **WHEN** the account is suspended before replay final persistence
- **THEN** processing SHALL reject its old authority, retain business/audit history and leave abandoned uploads eligible for existing bounded expiry cleanup

### Requirement: Audit reads remain exclusively owner-authorized

Only current owner SHALL query or receive audit records. Menus, pages and underlying queries SHALL enforce that rule independently. No account SHALL gain application audit-edit/delete functions, and audit DTOs SHALL exclude session/provider credentials.

#### Scenario: Admin directly requests audit records

- **WHEN** admin directly accesses an audit page or query
- **THEN** no audit query or record disclosure SHALL occur

### Requirement: Upload reservations bind current account and grant identity

Reservations SHALL bind the verified actor's login account, current role and current grant when admin. Reservation/token/process endpoints SHALL require current admin/owner authority and match that identity before allowing work. The reservation SHALL NOT be bound to a game member or personal key. Final replay persistence SHALL independently revalidate current authority. Existing pending nonce binding, Blob callback signature, exact store/path constraints, state transitions, duplicate handling and bounded resource protections SHALL remain. Resource budget identity SHALL remain stable across repeated logins of one account.

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
