## MODIFIED Requirements

### Requirement: Current administrator authority controls uploads

The system SHALL require current uploader, admin or owner authority before reserving uploads, issuing transfer authority or processing replays. Existing web endpoints SHALL continue to require the existing Discord browser login session. New desktop endpoints SHALL accept only an active, upload-scoped LLVY desktop session delegated through that browser identity. Each endpoint SHALL enforce this independently of UI controls; desktop credentials SHALL not become general web credentials.

#### Scenario: Unauthorized upload request

- **WHEN** an unauthenticated caller or viewer invokes an upload endpoint directly
- **THEN** the system rejects the request before granting Blob access or creating game data

#### Scenario: Desktop session has no current upload authority

- **WHEN** a device has an expired or revoked session, a viewer account or a different current grant from its delegated authority
- **THEN** desktop upload requests are rejected before Blob authorization or persistence

#### Scenario: Uploader uses either supported channel

- **WHEN** an active uploader with its current grant uses the web upload flow or approves an upload-scoped desktop session
- **THEN** the channel permits reservation, direct Blob transfer and processing with the same validation, duplicate rules, quotas and final persistence checks as admin/owner; manual game management remains forbidden
