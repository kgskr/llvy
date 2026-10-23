## MODIFIED Requirements

### Requirement: Audit events identify independent login accounts

Authentication and authorized-work events SHALL identify the verified login account, Discord user ID, current role, display-name snapshot, applicable grant ID, action/target/result/time and request correlation. Events SHALL NOT use a game-member ID as actor identity. Account IDs SHALL be distinct from business-target member/Riot/game IDs. Existing event coverage and transactional success auditing SHALL remain, including grant/revoke and replay outcomes; failed/cancelled login auditing SHALL be bounded. User OAuth tokens, bot tokens, credential hashes, codes, state, cookies and client secrets SHALL NOT be recorded. Historical audit snapshots SHALL remain readable without changing their original actor attribution. New desktop connection, revocation and upload events SHALL also identify the device session and client channel without replacing the login-account actor. LLVY device credentials, PKCE verifier and Blob signed URLs SHALL not be recorded; successful issuance/revocation and replay outcomes SHALL be transactionally audited. Replay outcomes SHALL retain upload ID, submitted basename, server-verified SHA-256 when available, outcome and resulting game ID independently of pending/game deletion; duplicate submissions SHALL retain their own submitter and filename.

Desktop audit metadata SHALL survive the typed audit projection and persistence allowlist: `deviceSessionId` and applicable `replacedSessionId` SHALL be validated UUIDs, `channel` and applicable `mode` SHALL use defined enums, and values SHALL come from verified server context. Existing before/after JSON storage SHALL retain those fields without accepting arbitrary credential-bearing metadata. Database readback SHALL verify preservation, rather than relying only on the event passed to the audit helper.

#### Scenario: Administrator changes a game member

- **WHEN** an authenticated administrator updates a game member
- **THEN** actor SHALL identify the login account/current grant and target SHALL identify the game member; no identity link SHALL be created between them

#### Scenario: Success audit insertion fails

- **WHEN** audit insertion for a business change or administrator grant/revoke fails
- **THEN** the associated database change SHALL roll back in the same transaction

#### Scenario: Historical audit display

- **WHEN** owner reads a historical audit event
- **THEN** its original snapshot SHALL remain available without guessing a different actor identity

#### Scenario: Device connection audit fails

- **WHEN** a desktop session cannot be transactionally audited at issuance
- **THEN** neither that session nor its credentials are committed or returned

#### Scenario: Desktop audit metadata passes through the storage filter

- **WHEN** a connection, replacement, revocation or upload event is saved through the shared audit helper
- **THEN** reading the persisted audit preserves its device/channel and applicable mode/replacement identifiers while excluding raw credentials, credential hashes, verifier, signed URLs and unknown fields

### Requirement: Upload reservations bind current account and grant identity

Reservations SHALL bind the verified actor's login account, current role and current grant when uploader or admin. Reservation/token/process endpoints SHALL require current uploader/admin/owner authority and match that identity before allowing work. The reservation SHALL NOT be bound to a game member or personal key. Final replay persistence SHALL independently revalidate current authority. Existing pending nonce binding, Blob callback signature, exact store/path constraints, state transitions, duplicate handling and bounded resource protections SHALL remain. Resource budget identity SHALL remain stable across repeated logins of one account and SHALL be shared across browser and desktop channels. Desktop reservations SHALL additionally bind their originating device session and required scope, and a desktop binding SHALL not be usable through web endpoints or a different device. Existing web reservations SHALL retain their account/grant binding behavior. Uploader bindings SHALL use a distinct uploader grant ID and SHALL not reinterpret admin grant IDs.

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

#### Scenario: Browser or another device uses a desktop reservation

- **WHEN** a browser or a different device on the same account presents a desktop reservation
- **THEN** processing and object cleanup through that binding are rejected without changing normal web reservation ownership rules

#### Scenario: Account alternates between browser and app

- **WHEN** one account reserves files across web sessions and multiple devices
- **THEN** all reservations share the original account and global counters and no session or channel creates a new allowance
