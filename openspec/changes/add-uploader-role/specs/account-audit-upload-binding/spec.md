## MODIFIED Requirements

### Requirement: Audit events identify independent login accounts

Authentication and authorized-work events SHALL identify the verified login account, Discord user ID, current role, display-name snapshot, applicable grant kind and ID, action/target/result/time and request correlation. Events SHALL NOT use a game-member ID as actor identity. Account IDs SHALL be distinct from business-target member/Riot/game IDs. Existing event coverage and transactional success auditing SHALL remain, including grant/revoke and replay outcomes; failed/cancelled login auditing SHALL be bounded. User OAuth tokens, bot tokens, credential hashes, codes, state, cookies and client secrets SHALL NOT be recorded. Historical audit snapshots SHALL remain readable without changing their original actor attribution. New desktop connection, revocation and upload events SHALL also identify the device session and client channel without replacing the login-account actor. LLVY device credentials, PKCE verifier and Blob signed URLs SHALL not be recorded; successful issuance/revocation and replay outcomes SHALL be transactionally audited.

Desktop audit metadata SHALL survive the typed audit projection and persistence allowlist: `deviceSessionId` and applicable `replacedSessionId` SHALL be validated UUIDs, `channel` and applicable `mode` SHALL use defined enums, and values SHALL come from verified server context. Existing before/after JSON storage SHALL retain those fields without accepting arbitrary credential-bearing metadata. Database readback SHALL verify preservation, rather than relying only on the event passed to the audit helper.

Uploader grant/revoke and uploader upload outcomes SHALL include the uploader grant identity in typed audit storage and readback, separate from administrator grant attribution. Authority changes and their success audits SHALL commit atomically. Cleanup SHALL preserve the original uploader snapshot after grant revocation; audits SHALL remain owner-only.

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

#### Scenario: Uploader grant audit fails

- **WHEN** an authorized grant/revoke operation cannot persist its audit
- **THEN** the uploader grant and associated session/device changes roll back together

### Requirement: Upload reservations bind current account and grant identity

Reservations SHALL bind the verified actor's login account, current role and current grant kind and identity when admin or uploader. Reservation/token/process endpoints SHALL require current uploader/admin/owner upload authority and match that identity before allowing work. The reservation SHALL NOT be bound to a game member or personal key. Final replay persistence SHALL independently revalidate current authority. Existing pending nonce binding, Blob callback signature, exact store/path constraints, state transitions, duplicate handling and bounded resource protections SHALL remain. Resource budget identity SHALL remain stable across repeated logins of one account and SHALL be shared across browser and desktop channels. Desktop reservations SHALL additionally bind their originating device session and required scope, and a desktop binding SHALL not be usable through web endpoints or a different device. Existing admin/owner web reservations SHALL retain their account/grant binding behavior. Uploader reservations SHALL use a separate uploader grant binding rather than overloading administrator grant fields. Role changes SHALL NOT reinterpret an earlier reservation under a new role or grant.

#### Scenario: Another account or grant processes a reservation

- **WHEN** a caller uses a reservation issued to another login account or another administrator or uploader grant
- **THEN** processing SHALL be denied without ingesting or deleting a Blob through the mismatched reservation

#### Scenario: Regrant does not revive an old upload

- **WHEN** an administrator or uploader is revoked and subsequently regranted a new grant ID
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

#### Scenario: Uploader is promoted during a transfer

- **WHEN** owner promotes uploader to admin before its reservation reaches final persistence
- **THEN** the old uploader reservation and device authority fail even though the account now has broader privileges; a new login and reservation are required

#### Scenario: Already issued Blob authority outlives revocation

- **WHEN** a direct PUT or Blob callback completes after uploader revocation
- **THEN** the object cannot authorize final ingestion and remains subject to existing bounded expiry cleanup without reviving the revoked grant

## ADDED Requirements

### Requirement: Replay audit identifies the submitted file and resulting game

For every accepted web or desktop upload reservation, the system SHALL record the verified submitting account ID, Discord ID, display-name/role snapshot, applicable grant kind and ID, server upload ID, channel, applicable device session ID and event time. Reservation acceptance SHALL NOT be represented as completed file transfer or successful game ingestion. Processing outcomes SHALL correlate to that upload ID and SHALL retain the validated original filename basename when available, the server-computed SHA-256 when computed, success/duplicate/failure result, safe failure reason when applicable and resulting game ID for success or duplicate. Missing metadata before processing SHALL remain explicitly absent rather than fabricated. Caller-supplied hashes SHALL NOT be presented as verified server hashes. Filename values SHALL follow existing bounded storage-text limits, exclude local directory paths/control characters and be safely rendered. Audit types, storage allowlists and query DTOs SHALL preserve these fields on database readback. Raw replay contents, local full paths, session credentials, Blob URLs and signed URLs SHALL NOT be recorded.

#### Scenario: Uploader processes a new file

- **WHEN** uploader successfully processes a replay through the browser or desktop client
- **THEN** persisted audit links that uploader's verified account and grant snapshot to the upload ID, filename, computed file hash, channel, time and newly created game ID

#### Scenario: Another uploader submits identical content

- **WHEN** another authorized account submits the same replay under a new upload reservation
- **THEN** its own audit records duplicate with that submitting account, upload ID and filename and links to the existing game ID without rewriting the first submitter's audit

#### Scenario: Parsing fails or a reservation expires

- **WHEN** the server observes a parsing failure, authority-revoked processing attempt on an identified reservation or abandoned reservation expiry
- **THEN** a failure audit retains the original reservation's submitting identity, upload ID, available validated file metadata and safe reason without claiming game creation or inventing an unobserved client-cancellation cause

### Requirement: Replay outcomes and retained audit remain consistent

Successful and duplicate replay processing SHALL commit their audit in the same transaction as the game/result persistence, including duplicate results found before insertion or through uniqueness contention. Failed success auditing SHALL roll back that transaction. Retries and later cleanup SHALL NOT create multiple terminal outcome events for the same completed upload. Failure auditing SHALL preserve observable failure information independently of a rolled-back ingestion transaction; temporary audit-storage failure SHALL NOT be reported as successful ingestion and SHALL leave unfinished processing eligible for existing bounded recovery/reconciliation. Display-name changes, grant revocation/regrant, pending-upload cleanup and game deletion SHALL NOT rewrite or cascade-delete historical upload audit snapshots. Existing audit retention policy SHALL remain unchanged.

#### Scenario: Audit write fails during successful processing

- **WHEN** a new game or duplicate result cannot be transactionally audited
- **THEN** its associated transaction does not commit unaudited business/result changes or report successful completion

#### Scenario: Process result is retried after response loss

- **WHEN** a terminal upload is retried or reconciled after its original response was lost
- **THEN** the original persisted outcome remains the authoritative audit and the retry does not create another terminal event for that upload

#### Scenario: Account or game changes after upload

- **WHEN** an uploader changes display name, loses its grant, has its pending reservation cleaned or its uploaded game is later deleted
- **THEN** existing audit retains the original uploader/file/upload/game identifiers and outcome according to the existing audit retention policy

#### Scenario: Desktop authority is revoked after transfer begins

- **WHEN** an already authorized processing claim receives bytes and observes authority revocation before final persistence
- **THEN** no game is committed and failure bookkeeping retains the original reservation identity, observed reason and computed hash without requiring the revoked authority again

#### Scenario: Failure audit insertion temporarily fails

- **WHEN** failure observation metadata can be stored but terminal audit insertion fails
- **THEN** later reconciliation uses the persisted original reason and computed hash instead of replacing the observation with a generic expiry; an existing terminal success or duplicate remains unchanged

#### Scenario: Browser omits its optional processing filename

- **WHEN** a browser reservation has a filename and its processing request omits the optional original filename
- **THEN** success, duplicate and failure audit preserve the reservation basename

### Requirement: Owner can inspect upload attribution

The owner-only audit page and its underlying query SHALL expose upload attribution with account snapshot, filename when available, upload ID, channel, timestamp, outcome and game ID when present. Existing games SHALL be reachable through their game link; deleted games SHALL retain historical identifiers and a clear unavailable state without a misleading live link. Viewer, uploader and admin SHALL NOT receive audit records through pages or direct queries. Granting birth-year reads SHALL NOT change audit authorization.

#### Scenario: Owner inspects an upload outcome

- **WHEN** owner opens an upload audit event
- **THEN** the page identifies who submitted which file and the resulting game or failure without requiring a surviving pending reservation or active uploader grant

#### Scenario: Uploader requests its own audit event

- **WHEN** uploader directly requests audit records even for its own uploaded file
- **THEN** the server denies audit access while separately authorized own-upload status remains governed by the existing upload contract
