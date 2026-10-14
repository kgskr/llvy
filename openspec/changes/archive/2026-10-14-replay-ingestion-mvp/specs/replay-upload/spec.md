## ADDED Requirements

### Requirement: Shared-password access control for uploads

The system SHALL verify a single shared password at login and issue a signed session cookie. Upload reservation, token issuance, and processing SHALL require a valid session; unauthenticated requests MUST NOT initiate upload or storage. Passwords SHALL NOT be sent in upload or processing request bodies.

#### Scenario: Correct password grants upload access
- **WHEN** a user submits the correct shared password
- **THEN** the system grants access to the upload flow for that session

#### Scenario: Incorrect or missing password is rejected
- **WHEN** a user attempts to upload without a valid session, including after an unsuccessful password login
- **THEN** the system rejects the request, returns an authorization error, and does not create any Blob object or database record

### Requirement: Large replay upload via direct Blob upload

The system SHALL upload `.rofl` files directly from the browser to Vercel Blob storage so that files larger than the 4.5MB serverless function body limit (typically 10–30MB) can be accepted. The file MUST NOT be sent as a request body to a serverless function.

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

### Requirement: Duplicate replay prevention

The system SHALL compute a content hash of each uploaded replay and SHALL prevent the same replay from being ingested more than once.

#### Scenario: Same replay uploaded twice
- **WHEN** a user uploads a replay whose content hash matches an already-stored game
- **THEN** the system does not create a duplicate game record and informs the user that the replay already exists

### Requirement: Capture the replay's source timestamp for the game date

Because a `.rofl` file contains no play date, the system SHALL capture the uploaded file's last-modified time (the browser `File.lastModified`) at upload and pass it to processing so it can serve as the game's play date, with the server time at ingestion as a fallback.

#### Scenario: File last-modified time is forwarded for dating
- **WHEN** a user uploads a replay whose file has a last-modified time
- **THEN** the system forwards that last-modified time to processing to be stored as the game's play date

#### Scenario: Missing or invalid file time falls back to ingestion time
- **WHEN** the uploaded file has no usable last-modified time
- **THEN** the system uses the server time at ingestion as the game's play date

### Requirement: Trigger parsing and storage after upload

After a successful upload, the system SHALL trigger parsing of the uploaded replay and storage of the extracted match data.

#### Scenario: Successful upload starts ingestion
- **WHEN** a replay finishes uploading to Blob storage
- **THEN** the system parses the replay metadata and persists the resulting game and participant records, then reports success or a descriptive failure to the user
