## MODIFIED Requirements

### Requirement: Processing requires a pending upload binding

The system SHALL fetch and ingest a Blob for replay processing only when it is bound to an active pending upload issued through an authorized reservation endpoint. Browser processing at `/api/process` SHALL require the existing uploader/admin/owner-authorized `/api/uploads` binding and browser authentication. Desktop processing at `/api/desktop/v1/uploads/{id}/process` SHALL require a `/api/desktop/v1/uploads` binding owned by the currently authorized originating device, with the required upload scope and nonce. The binding MUST include an unguessable upload identifier and nonce and MUST constrain the accepted Blob object to the upload that was just authorized. Desktop processing SHALL derive the canonical object URL from the bound configured store/path without accepting a caller-supplied Blob URL. A binding from another channel or device MUST NOT authorize processing. Returning an already retained desktop result SHALL follow the terminal-result rules below and SHALL NOT authorize another Blob operation.

#### Scenario: Bound upload is processed

- **WHEN** an authenticated user completes a direct Blob upload and calls `/api/process` with the matching pending upload binding
- **THEN** the system accepts the Blob URL for replay processing

#### Scenario: Known Blob URL without binding is rejected

- **WHEN** an authenticated user calls `/api/process` with a same-store Blob URL but no valid pending upload binding
- **THEN** the system rejects the request before fetching or deleting that Blob

#### Scenario: Mismatched Blob URL is rejected

- **WHEN** an authenticated user calls `/api/process` with a valid pending upload binding but a different Blob URL
- **THEN** the system rejects the request before fetching or deleting that Blob

#### Scenario: Bound desktop upload is processed

- **WHEN** the currently authorized originating device calls its desktop process endpoint with the ID and nonce of its active desktop reservation
- **THEN** the system derives the canonical object URL from the reservation and applies the shared exact-object validation and ingestion rules

#### Scenario: Binding is presented through another channel or device

- **WHEN** a browser binding is presented to desktop processing, a desktop binding is presented to `/api/process`, or a different device presents a desktop binding
- **THEN** the system rejects the request before fetching, ingesting or deleting the bound Blob

### Requirement: Processed pending uploads cannot be replayed

The system SHALL mark a pending upload as consumed after successful processing, duplicate handling, or terminal failure. A consumed pending upload binding MUST NOT authorize a later `/api/process` request. Neither browser nor desktop processing SHALL use a consumed binding to fetch, ingest or delete the Blob again.

Within the desktop result-retention period, an identical desktop process retry or GET status request SHALL return the stored terminal result after validating the originating device's current authority and the credentials required by that endpoint, including the nonce for process retries. This read SHALL remain available independently of pending reservation expiry or cleanup, as specified by `desktop-replay-upload-api`, without reactivating the binding or repeating Blob operations. Result retention SHALL NOT bypass device expiry, revocation, scope checks or the desktop feature gate.

#### Scenario: Consumed binding is rejected

- **WHEN** a browser client reuses a pending upload binding at `/api/process` after it has already reached a terminal state
- **THEN** the system rejects the request and does not fetch or delete the Blob again

#### Scenario: Desktop process response is recovered

- **WHEN** the currently authorized originating device repeats the same desktop process request after the job has reached a terminal state and while its result is retained
- **THEN** the system validates that endpoint's credentials and returns the stored result without fetching, ingesting or deleting the Blob again

#### Scenario: Desktop result outlives the pending binding

- **WHEN** the original pending reservation has expired or been cleaned but the terminal desktop result remains retained and the originating device is currently authorized
- **THEN** the desktop process retry or GET status request can return that result after its endpoint-specific credential checks without recreating a reservation or authorizing any Blob operation

#### Scenario: Retained result does not restore device authority

- **WHEN** a device with expired or revoked authority requests a retained terminal result through desktop process or GET status
- **THEN** the system rejects the request without returning the protected result or performing any Blob operation

### Requirement: Enforce exact pending token issuance

The system SHALL return `{uploadId, nonce, pathname, access}` from `/api/uploads`, store only the nonce hash, and reserve `replays/<uploadId>.rofl` for 30 minutes. `/api/blob/upload` SHALL verify current uploader/admin/owner authority and the unexpired pending actor binding before issuing a token for that exact path, with overwrites and random suffixes disabled and a maximum size of 64MiB. `/api/process` SHALL canonicalize the validated store/path before reading or deleting; caller-provided query or fragment aliases SHALL NOT change the target.

Desktop transfer authorization SHALL follow the exact-object and short-lived PUT rules in `desktop-replay-upload-api`. An expired desktop reservation MUST NOT authorize a new transfer or processing operation; returning a retained terminal result under the rules above SHALL NOT extend the reservation or its transfer authority.

#### Scenario: Expired binding

- **WHEN** a token request at `/api/blob/upload` or process request at `/api/process` uses a binding after its 30-minute expiry
- **THEN** it is rejected without authorizing the requested object operation

#### Scenario: Expired desktop reservation cannot start object operations

- **WHEN** a desktop transfer request or a process request without a retained terminal result uses an expired reservation
- **THEN** the system rejects new object operations without issuing transfer authority, fetching or ingesting the Blob, or extending the reservation
