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

### Requirement: Enforce exact pending token issuance

The system SHALL return `{uploadId, nonce, pathname, access}` from `/api/uploads`, store only the nonce hash, and reserve `replays/<uploadId>.rofl` for 30 minutes. `/api/blob/upload` SHALL verify current uploader/admin/owner upload authority and the unexpired pending actor binding before issuing a token for that exact path, with overwrites and random suffixes disabled and a maximum size of 64MiB. `/api/process` SHALL canonicalize the validated store/path before reading or deleting; caller-provided query or fragment aliases SHALL NOT change the target.

Desktop transfer authorization SHALL follow the exact-object and short-lived PUT rules in `desktop-replay-upload-api`. An expired desktop reservation MUST NOT authorize a new transfer or processing operation; returning a retained terminal result under the rules above SHALL NOT extend the reservation or its transfer authority.

#### Scenario: Expired binding

- **WHEN** a token request at `/api/blob/upload` or process request at `/api/process` uses a binding after its 30-minute expiry
- **THEN** it is rejected without authorizing the requested object operation

#### Scenario: Expired desktop reservation cannot start object operations

- **WHEN** a desktop transfer request or a process request without a retained terminal result uses an expired reservation
- **THEN** the system rejects new object operations without issuing transfer authority, fetching or ingesting the Blob, or extending the reservation
