## ADDED Requirements

### Requirement: Processing requires a pending upload binding
The system SHALL process a Blob URL only when it is bound to an active pending upload issued by authenticated `/api/uploads`. The binding MUST include an unguessable upload identifier and nonce and MUST constrain the accepted Blob object to the upload that was just authorized.

#### Scenario: Bound upload is processed
- **WHEN** an authenticated user completes a direct Blob upload and calls `/api/process` with the matching pending upload binding
- **THEN** the system accepts the Blob URL for replay processing

#### Scenario: Known Blob URL without binding is rejected
- **WHEN** an authenticated user calls `/api/process` with a same-store Blob URL but no valid pending upload binding
- **THEN** the system rejects the request before fetching or deleting that Blob

#### Scenario: Mismatched Blob URL is rejected
- **WHEN** an authenticated user calls `/api/process` with a valid pending upload binding but a different Blob URL
- **THEN** the system rejects the request before fetching or deleting that Blob

### Requirement: Cleanup deletes only the bound pending Blob
The system SHALL delete a Blob during duplicate, parse-error, or ingest-error cleanup only if that Blob is the exact object bound to the current pending upload. The system MUST NOT delete arbitrary caller-supplied Blob URLs, even when they are hosted on `*.blob.vercel-storage.com`.

#### Scenario: Duplicate replay cleanup removes only current upload
- **WHEN** a user processes a replay whose content hash already exists
- **THEN** the system may delete the current pending upload Blob but MUST NOT delete the canonical Blob URL stored for the existing game

#### Scenario: Parse failure cleanup removes only current upload
- **WHEN** processing fails because the current pending upload is not a supported replay
- **THEN** the system may delete only the Blob bound to that failed pending upload

### Requirement: Processed pending uploads cannot be replayed
The system SHALL mark a pending upload as consumed after successful processing, duplicate handling, or terminal failure. A consumed pending upload binding MUST NOT authorize a later `/api/process` request.

#### Scenario: Consumed binding is rejected
- **WHEN** a client reuses a pending upload binding after it has already reached a terminal state
- **THEN** the system rejects the request and does not fetch or delete the Blob again

### Requirement: Bound upload reservations with shared budgets
The system SHALL atomically consume Postgres reservation counters for the current signed session token and the whole application before creating an upload binding. Defaults SHALL permit ten reservations per session and fifty application-wide per 24-hour fixed window. An exhausted budget SHALL return HTTP 429. Abandoned uploads SHALL still consume reservations; a rejected budget transaction SHALL consume none. A new login session SHALL receive a distinct session counter while the global counter remains shared.

#### Scenario: Exhausted reservation budget
- **WHEN** either the session or global reservation budget is exhausted
- **THEN** `/api/uploads` returns HTTP 429 without creating a pending-upload row

### Requirement: Enforce exact pending token issuance
The system SHALL return `{uploadId, nonce, pathname, access}` from `/api/uploads`, store only the nonce hash, and reserve `replays/<uploadId>.rofl` for 30 minutes. `/api/blob/upload` SHALL verify the session and unexpired pending binding before issuing a token for that exact path, with overwrites and random suffixes disabled and a maximum size of 64MiB. `/api/process` SHALL canonicalize the validated store/path before reading or deleting; caller-provided query or fragment aliases SHALL NOT change the target.

#### Scenario: Expired binding
- **WHEN** a token or process request uses a binding after its 30-minute expiry
- **THEN** it is rejected without authorizing the requested object operation

### Requirement: Reconcile expired uploads through authenticated daily maintenance
The system SHALL schedule `/api/maintenance/uploads` daily at 03:00 UTC and require the exact Bearer CRON_SECRET. Missing or invalid credentials SHALL return HTTP 401. Each run SHALL reconcile at most fifty bindings more than 24 hours past expiry, atomically claim rows as `cleaning`, and permit reclaiming a claim older than ten minutes. It SHALL preserve every canonical Blob referenced by a stored game, delete only the exact reserved object in the configured store when unreferenced, remove successfully reconciled pending rows, and retain failed rows for retry. It SHALL also remove request-budget rows more than 24 hours past reset. Expiry SHALL be evaluated from timestamps rather than requiring a stored `expired` state.

#### Scenario: Committed original exists
- **WHEN** an expired binding's canonical URL is referenced by a stored game
- **THEN** maintenance preserves the Blob and removes the successfully reconciled binding

#### Scenario: Abandoned bound object
- **WHEN** an expired binding has an unreferenced exact Blob in the configured store
- **THEN** maintenance deletes only that object and then removes the pending row

#### Scenario: Cleanup failure or interrupted claim
- **WHEN** object listing or deletion fails, or a cleaning claim is interrupted
- **THEN** the row remains retryable, immediately after a successful failure reset or after the ten-minute claim timeout
