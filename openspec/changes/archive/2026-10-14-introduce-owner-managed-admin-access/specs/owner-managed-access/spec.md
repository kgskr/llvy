## ADDED Requirements

### Requirement: Three server-derived roles
The system SHALL derive viewer/admin/owner solely from one submitted secret key. Viewer and owner keys SHALL be distinct required environment secrets and AUTH_SECRET SHALL remain independently required. Admin keys SHALL resolve active member credentials. Legacy sessions SHALL be rejected; throttling and generic wrong-key responses SHALL remain.

#### Scenario: Viewer cannot mutate
- **WHEN** a viewer directly invokes an upload or management endpoint or Action
- **THEN** it SHALL be rejected without a business data mutation

#### Scenario: Owner and administrator powers
- **WHEN** an admin or owner uses existing upload/member/game management
- **THEN** access SHALL be permitted but only owner SHALL grant/revoke administrators or read audit logs

### Requirement: One-time member credential issuance
Only owner SHALL grant a member a 16-character cryptographically random uppercase/lowercase/digit key containing every category. Only SHA-256 SHALL be persisted. The plaintext SHALL be returned only by the successful initial issuance response and SHALL NOT be retrievable or editable.

#### Scenario: Duplicate issuance
- **WHEN** a member already has an active key, including concurrent grant requests
- **THEN** no second active key or plaintext redisplay SHALL occur

#### Scenario: Lost credential
- **WHEN** owner revokes and grants again
- **THEN** a new key and credential ID SHALL be issued and all old keys/sessions SHALL remain invalid

### Requirement: Current authorization governs protected work
Admin data access SHALL verify the current credential. Mutations SHALL serialize authority checks with revocation. Uploads SHALL bind the server-derived actor and check authority again inside final persistence.

#### Scenario: Revoked session
- **WHEN** revocation has completed and an old session reads privileged data or commits a change
- **THEN** no privileged data or mutation SHALL be allowed
