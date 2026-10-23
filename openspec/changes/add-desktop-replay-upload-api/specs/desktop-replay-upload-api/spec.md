## ADDED Requirements

### Requirement: Versioned desktop endpoints preserve the web contracts

The system SHALL expose desktop authentication and upload operations under `/api/desktop/v1/` with dedicated bearer authentication, stable JSON errors and `private, no-store` responses. Each handler and underlying service SHALL enforce its own required authority/scope. Proxy routing SHALL explicitly delegate this namespace without exempting protected handlers from authentication. Existing web URLs, cookies, upload request/response DTOs and behaviors SHALL remain compatible. A capability/session response SHALL describe supported protocol, current account and upload constraints.

The session response SHALL include an advisory quota snapshot with `asOf` and account/global `limit`, `remaining` and `resetAt` values derived from the existing fixed-window counters. An inactive window SHALL have a null reset time and expired counters SHALL NOT reduce current availability. This read SHALL NOT consume quota or reserve capacity. Each reservation transaction SHALL remain authoritative under concurrent web/device traffic.

#### Scenario: Old web client uploads after deployment

- **WHEN** the existing browser uses `/api/uploads`, `/api/blob/upload` and `/api/process`
- **THEN** it completes with its existing cookie and DTO contracts without a desktop connection or client upgrade

#### Scenario: Missing bearer on a protected desktop route

- **WHEN** an anonymous caller reaches a desktop upload or status handler through Proxy
- **THEN** the handler rejects the request before protected reads, reservation or Blob authorization

#### Scenario: Another client consumes capacity after preview

- **WHEN** the app displays a positive quota snapshot and another web or device request consumes the last allowance
- **THEN** the reservation can return 429, the queue pauses and refreshes the advisory snapshot without treating the earlier display as a guaranteed slot

### Requirement: Reservations are idempotent and consume the shared account allowance once

Desktop reservation SHALL require filename, size, file modification time, client SHA-256 and an `Idempotency-Key`. Keys SHALL be scoped to the device session and bound to the canonical request fingerprint. A repeated identical request SHALL recover the same reservation and nonce without additional quota consumption; a changed request with that key SHALL return 409. Reusing a key SHALL not extend or recreate an expired reservation. The reservation, job and account/global budget debit SHALL commit atomically. Desktop and web SHALL use the existing account-level ten and global fifty reservations per 24-hour window. Rejected budget transactions SHALL create no reservation and consume no counters.

The device/key/fingerprint/upload-ID/reservation-expiry tombstone SHALL remain through device absolute expiry even after seven-day result cleanup. It MAY be removed earlier only after permanent device revocation makes all credentials unusable. Once detailed results are removed, the same key and input SHALL return `409 reservation_expired`, and changed input SHALL return `409 idempotency_conflict`, without a new reservation or budget debit.

Reservation SHALL lock current actor authority and serialize originating-device reservation writes before looking up the idempotency record. An existing key SHALL be resolved before budget consumption. The transaction-aware budget helper SHALL use the caller's transaction and acquire multiple counter locks in sorted key order shared with other callers. Budget rejection or later pending/job/audit failure SHALL roll back every counter change and reservation write; a partial debit SHALL NOT be committed by catching the budget failure inside that transaction. A successfully created reservation SHALL consume one allowance even if later processing finds a duplicate or fails.

#### Scenario: Reservation response is lost

- **WHEN** the app repeats the same request and key after losing the response
- **THEN** it obtains the original binding without creating another object path or consuming another reservation

#### Scenario: Web and app compete for the last allowance

- **WHEN** concurrent browser and device reservations exhaust an account or global window
- **THEN** shared counters enforce the original total allowance and rejected requests return 429

#### Scenario: Same key returns after detailed result retention

- **WHEN** an otherwise valid thirty-day device reuses a key on day eight after the job's detailed result has been cleaned
- **THEN** the retained tombstone rejects the expired reservation or conflicting input without creating another reservation or consuming quota

#### Scenario: Reservation insertion or audit fails after budget updates

- **WHEN** a new reservation reaches pending/job insertion or auditing and that operation fails after updating the shared counters
- **THEN** the transaction leaves no pending row, job or budget debit, and repeating the same key can create at most one reservation

#### Scenario: Concurrent first requests use the same device and key

- **WHEN** two requests start before either can observe an existing idempotency row
- **THEN** device-level serialization and uniqueness produce one reservation and one debit, and reversed input budget arrays still acquire counter locks in the same sorted order

### Requirement: Go uploads directly with exact short-lived Blob authority

The server SHALL issue a presigned PUT URL using the supported Blob SDK for exactly the pending reservation's configured store and pathname. It SHALL constrain the operation to PUT, expiry to the earlier of five minutes or reservation expiry, type to `application/octet-stream`, size to at most 64 MiB, and disable overwrites and random suffixes. The client SHALL stream file bytes directly to Blob using standard HTTP without forwarding its LLVY bearer or following credential-bearing redirects. Serverless application endpoints SHALL not receive replay bodies. Signing material and the store read/write token SHALL remain server-only.

The transfer response SHALL include `uploadUrl`, `method: PUT`, `headers: Record<string, string>` and `expiresAt`. A version-pinned server adapter SHALL supply the headers verified for the configured store; the client SHALL NOT hardcode Blob API versions or store identifiers. Shared fixtures SHALL define permitted headers and values from the real PUT spike, including public/private access. The client SHALL reject unrecognized or case-insensitively duplicated header names, CR/LF values and attempts to supply Authorization, Cookie, Host, hop-by-hop or framing headers. Content length SHALL come from the verified file size. Both sides SHALL allowlist the transfer HTTPS endpoint separately from the configured object's exact origin/path. A Control API transfer URL SHALL NOT be mistaken for a stored-object URL. Header-allowlist changes SHALL preserve supported-client compatibility.

#### Scenario: Malicious path or oversized body

- **WHEN** an app alters the authorized pathname, changes the signed operation or exceeds the permitted size
- **THEN** the storage authorization rejects the request and LLVY does not process an unrelated object

#### Scenario: Private configured store

- **WHEN** the server's configured Blob store is private
- **THEN** the app uploads with private access and the server reads only the exact bound object with server credentials

#### Scenario: Transfer URL belongs to the Blob Control API

- **WHEN** the adapter returns the verified Control API PUT endpoint and allowed headers for the configured store
- **THEN** the Go client applies that descriptor without constructing SDK headers, and any returned object URL is checked separately against the reserved store/path

#### Scenario: Transfer descriptor contains a forbidden header

- **WHEN** a descriptor attempts to set Authorization, Cookie, Host or an unknown header
- **THEN** the client rejects it before sending replay bytes or LLVY credentials

#### Scenario: Device is revoked after transfer authorization

- **WHEN** a previously issued PUT URL has not yet expired but the device is revoked
- **THEN** new transfer authorizations and final persistence are denied even if the old URL can still transfer bytes until expiry

### Requirement: Desktop jobs bind the originating device and immutable upload metadata

Each desktop job SHALL bind its reservation, originating device session, account, role/grant, file metadata and client hash. Other accounts, other devices or browser credentials SHALL not inspect or process the job through desktop routes. Transfer and process SHALL also validate the reservation nonce and exact store/path. Desktop process SHALL require the upload ID and nonce without a client-supplied Blob URL; the server SHALL derive the canonical object URL from the bound configured store/path and validate it using existing exact-object rules. The signed PUT request URL SHALL NOT be treated as the canonical object URL. Nonce plaintext SHALL not be stored. Recovery SHALL regenerate or return a binding only to the same valid device and idempotent request.

#### Scenario: Another device on the same account guesses a job ID

- **WHEN** a different device uses that job's identifier or nonce
- **THEN** it cannot inspect, transfer, process or delete the bound object

### Requirement: Shared ingestion owns validation deduplication and authoritative results

The desktop path SHALL reuse existing server-side size/ROFL validation, metadata and DB-work budgets, content-hash duplicate detection, exact-object cleanup, current-authority transaction checks and audit behavior. The server SHALL compute the received file hash itself and compare it with the declared client hash before committing new game data. Filename IDs SHALL not replace parsed data or database game IDs. Desktop modification time SHALL use the existing game-date fallback policy.

#### Scenario: Declared and received content differ

- **WHEN** the received bytes do not match the desktop reservation's declared hash or size
- **THEN** processing returns a stable validation failure and performs no game/participant write, with cleanup restricted to that bound object

#### Scenario: Duplicate uploaded from another client

- **WHEN** web or another authorized client already stored the same replay bytes
- **THEN** desktop processing returns the existing game and duplicate result while preserving its canonical replay object

### Requirement: Processing and status retrieval recover response loss without repeated ingestion

The system SHALL atomically claim each desktop processing job and persist its successful or duplicate result with the final database transaction. A repeated identical process request SHALL return in-progress status or the stored terminal result without re-ingesting or re-deleting. A GET status operation SHALL be authorized to the originating device and return bounded stable state, game ID/duplicate or error information. Terminal results SHALL remain queryable for seven days from reservation creation independently of earlier pending-upload cleanup. Processing claims SHALL expire at the earlier of two minutes after acquisition or reservation expiry, and final commits SHALL validate the current claim and expiry.

Shared ingestion SHALL finalize desktop results within its transaction in all three success paths: pre-existing duplicate, new game insertion and duplicate discovered by unique-constraint contention. After taking authority and job/claim locks in the shared order, finalization SHALL check claim ownership and expiry against current time and persist `gameId`, duplicate status, server SHA-256, job/pending terminal state and audit together. New game/participant writes and cache revisions SHALL share that transaction. Finalization failure SHALL roll back its writes; a caller-side status update after ingestion returns SHALL NOT serve as desktop success finalization. External cleanup and cache notifications SHALL remain outside the transaction, and an uncertain COMMIT SHALL NOT trigger blind re-ingestion or canonical-object deletion.

#### Scenario: Successful processing response is lost

- **WHEN** a game commit succeeds but the app receives no response
- **THEN** status retrieval returns that committed result without a new reservation or upload

#### Scenario: Worker dies before a terminal result

- **WHEN** a processing claim expires without a confirmed result
- **THEN** the system reports an unknown outcome, prevents an expired claim from later committing, and does not automatically repeat ingestion

#### Scenario: Pending cleanup runs before result retention ends

- **WHEN** maintenance removes an expired pending binding whose desktop job is still within its retention period
- **THEN** the terminal job result remains available and canonical game Blobs remain protected

#### Scenario: Finalizer fails on a new or duplicate result

- **WHEN** any of the three ingestion success paths cannot validate its current claim or persist the desktop result/audit
- **THEN** that transaction commits neither new game/participant changes nor a success audit or terminal result, and an already existing canonical game remains intact

### Requirement: Client retries respect authorization object state and server budgets

The client SHALL bound retries to at most three attempts for safe transient operations and honor Retry-After. It SHALL reuse the reservation key after an uncertain reservation response, check the bound object through the server after an uncertain PUT response, and query status after uncertain processing. It SHALL not automatically overwrite objects, repeat refresh credentials or create fresh reservations to conceal uncertainty. Expired authorization SHALL cause at most one serialized refresh before retry; forbidden authority SHALL pause the queue. Exhausted daily budgets SHALL pause remaining reservations.

#### Scenario: PUT response is lost after storage accepted the object

- **WHEN** the app cannot determine whether PUT completed
- **THEN** it uses its upload ID and nonce to ask the server to process/check the exact bound object even if no PUT response bytes or object URL were received, and does not attempt an overwrite; retransfer occurs only after confirmed absence

#### Scenario: Object absence or temporary storage error

- **WHEN** the server checks the exact object before claiming a pending job
- **THEN** a confirmed 404 returns `object_not_uploaded` while keeping the unexpired reservation pending, and a timeout or storage 5xx returns a temporary error without treating it as object absence or consuming the job

#### Scenario: Daily limit is exhausted mid-batch

- **WHEN** reservation returns the shared budget error
- **THEN** previous results are preserved, remaining items are paused and the reset/retry information is displayed

### Requirement: Desktop feature rollout can be disabled independently

The server SHALL default `DESKTOP_UPLOADER_ENABLED` to false until required verification is complete. Disabled state SHALL reject new desktop connection, refresh and upload operations while preserving browser uploads, connection revocation and bounded cleanup. Releases SHALL document API-version compatibility and reject unsupported clients with an actionable error rather than changing successful v1 response meanings.

#### Scenario: Operator disables the desktop path

- **WHEN** the feature is disabled after a client release
- **THEN** desktop use receives an explicit unavailable response, web uploads continue, and cleanup and authorized device disconnection remain possible

### Requirement: Desktop support is independent of optional Worker integration

Desktop API support SHALL operate without a Cloudflare Worker deployment, Worker credentials or QStash configuration. `DESKTOP_UPLOADER_ENABLED` SHALL control the desktop path independently of any future Worker integration setting. Leaving desktop support disabled SHALL preserve existing browser operation without requiring an uploader checkout or executable.

#### Scenario: Only desktop support is enabled

- **WHEN** desktop support is configured and enabled while Worker integration is absent or disabled
- **THEN** authorized desktop operations use LLVY and the configured Blob store without requiring Worker or QStash resources

### Requirement: Quota retry delays reflect the rejecting window

A desktop quota rejection SHALL derive Retry-After from the rejecting fixed-window counter reset time, rounded up to whole seconds with a minimum of one. It SHALL NOT substitute a new 24-hour window for an existing window. If no reset time is available, the response SHALL omit Retry-After. This is a lower bound for retrying the rejected counter, not a reservation of capacity or a guarantee that other counters will allow the next request. Counter reads SHALL preserve transactional rollback and existing sorted write-lock ordering.

#### Scenario: Quota is exhausted shortly before reset

- **WHEN** the rejecting account or global counter resets in 10.5 seconds
- **THEN** the desktop response carries Retry-After 11 and no pending/job row or partial counter debit commits

#### Scenario: Reset time is unavailable or already elapsed at response time

- **WHEN** a quota error has no reset time or its recorded reset has elapsed before the response
- **THEN** the header is respectively omitted or bounded to one second instead of a fabricated 24-hour delay
