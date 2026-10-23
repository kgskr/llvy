## MODIFIED Requirements

### Requirement: Current administrator authority controls uploads

The system SHALL require current uploader, admin or owner authority before reserving uploads, issuing transfer authority or processing replays. Existing web endpoints SHALL continue to require the existing Discord browser login session. New desktop endpoints SHALL accept only an active, upload-scoped LLVY desktop session delegated through that browser identity. Each endpoint SHALL enforce this independently of UI controls; desktop credentials SHALL not become general web credentials.

#### Scenario: Unauthorized upload request

- **WHEN** an unauthenticated caller or viewer invokes an upload endpoint directly
- **THEN** the system rejects the request before granting Blob access or creating game data

#### Scenario: Desktop session has no current upload authority

- **WHEN** a device has an expired or revoked session, a viewer account or a different current grant from its delegated authority
- **THEN** desktop upload requests are rejected before Blob authorization or persistence

### Requirement: Large replay upload via direct Blob upload

The system SHALL upload `.rofl` files directly from the browser or authorized desktop client to Vercel Blob storage so that files larger than the 4.5MB serverless function body limit (typically 10–30MB) can be accepted. The file MUST NOT be sent as a request body to a serverless function.

#### Scenario: A 30MB replay is uploaded successfully

- **WHEN** an authorized user selects a 30MB `.rofl` file and confirms upload
- **THEN** the file is uploaded directly to Blob storage and a Blob URL is returned without hitting the function body-size limit

#### Scenario: Non-rofl file is rejected

- **WHEN** an authorized user selects a file that is not a `.rofl` file
- **THEN** the system rejects the file before or during upload and informs the user that only `.rofl` replays are accepted

#### Scenario: A replay is uploaded to a private store

- **WHEN** the connected store is private and the server is configured with `BLOB_ACCESS=private`
- **THEN** the browser uses private access for the direct upload and the server authenticates reads of the exact bound object without exposing the read/write token to the browser
- **AND** a URL outside the configured store or reserved pathname is rejected before any authenticated read or deletion

#### Scenario: Desktop sends a large replay

- **WHEN** an authorized Go client uploads a valid replay larger than the serverless body limit
- **THEN** it uses an exact-path short-lived presigned PUT URL and sends bytes directly to Blob without changing the browser upload-token flow

### Requirement: Capture the replay's source timestamp for the game date

The system SHALL capture the uploaded file's last-modified time (the browser `File.lastModified` or the desktop file system modification time expressed as Unix milliseconds) at upload and pass it to processing so it can supply the game's Asia/Seoul calendar date, with the server time at ingestion as a fallback.

#### Scenario: File last-modified time is forwarded for dating

- **WHEN** a user uploads a replay whose file has a last-modified time
- **THEN** the system forwards that last-modified time to processing to be stored as the game's play date

#### Scenario: Missing or invalid file time falls back to ingestion time

- **WHEN** the uploaded file has no usable last-modified time
- **THEN** the system uses the Asia/Seoul calendar date of the server time at ingestion as the game's play date

#### Scenario: Desktop modification time is preserved

- **WHEN** the Go client sends the selected file modification time
- **THEN** processing applies the same validation and Asia/Seoul date fallback as browser uploads and does not claim that file time proves the actual match start

## ADDED Requirements

### Requirement: Existing browser upload remains independently available

The system SHALL preserve `/upload`, the Discord login callback, browser session format and the public contracts of `/api/uploads`, `/api/blob/upload` and `/api/process`. Desktop rollout, feature disablement and device logout SHALL not require browser clients to connect a device or change their authentication or upload DTOs.

#### Scenario: Desktop feature is disabled

- **WHEN** desktop rollout is disabled or a user disconnects a device
- **THEN** an otherwise authorized browser session continues the existing upload workflow
