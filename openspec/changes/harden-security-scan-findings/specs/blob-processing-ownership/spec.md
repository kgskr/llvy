## ADDED Requirements

### Requirement: Processing requires a pending upload binding
The system SHALL process a Blob URL only when it is bound to an active pending upload issued by the app. The binding MUST include an unguessable upload identifier or nonce and MUST constrain the accepted Blob object to the upload that was just authorized.

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
