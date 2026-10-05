## ADDED Requirements

### Requirement: Two distinct shared keys determine the authenticated role
The system SHALL authenticate `UPLOAD_PASSWORD` as `uploader` and `ADMIN_PASSWORD` as `admin` through one login form. The server SHALL derive the role exclusively from the matching key and SHALL NOT trust a submitted role. Both keys SHALL be nonblank and distinct. The system SHALL retain the trusted-IP throttle before credential verification, sharing the same budget across both keys, and use the same wrong-key message and default 400ms failure delay for either role.

#### Scenario: Uploader login
- **WHEN** a permitted login attempt submits the upload key, including a caller-supplied admin role
- **THEN** the issued session has only the uploader role

#### Scenario: Administrator login
- **WHEN** a permitted login attempt submits the admin key
- **THEN** the issued session has the admin role, including upload and read permissions

#### Scenario: Invalid key and exhausted budget
- **WHEN** a submitted key matches neither role or the trusted-IP budget is exhausted
- **THEN** no session is issued, wrong keys receive the same generic error and delay, and exhausted budgets are rejected before either key is compared

#### Scenario: Shared attempt budget
- **WHEN** attempts using uploader and admin keys together exhaust one trusted IP's budget
- **THEN** further attempts from that IP are rejected while another IP retains its own budget

### Requirement: Session signatures require a separate server secret
The system MUST require `AUTH_SECRET` as an independent server-only secret of at least 32 UTF-8 bytes after trimming. It SHALL reject missing or blank login keys, identical login keys, missing or short signing secrets, and a signing secret equal to either login key. It MUST NOT derive signatures from a login key without the independent secret. Configuration errors SHALL NOT expose credential values or issue sessions, and session verification under invalid configuration SHALL fail.

#### Scenario: Missing or insecure configuration
- **WHEN** a required key is missing, keys are identical, or the signing secret is missing, too short, or equal to a login key
- **THEN** login issues no cookie and returns a generic configuration error, and protected requests accept no session

#### Scenario: Uploader knows their login key
- **WHEN** someone possessing only the upload key crafts a signed admin token using that key as signing material
- **THEN** session verification rejects the token

### Requirement: Sessions carry a signed role and enforce lifecycle rules
The system SHALL sign version, role, issuance timestamp and a random per-login nonce in a v3 session. It SHALL accept only `uploader` and `admin`, reject malformed or modified tokens, noncanonical base64url signatures and all legacy v1/v2 tokens, and retain a 30-day lifetime with at most 60 seconds of future-clock tolerance. Repeated logins at the same time SHALL produce distinct session identities. The payload SHALL NOT contain credentials. Changing a role's key SHALL revoke that role's sessions while preserving the other role; rotating `AUTH_SECRET` SHALL revoke all sessions.

#### Scenario: Role tampering or unknown role
- **WHEN** an uploader token is modified to claim admin, or a token carries an unknown role or malformed payload
- **THEN** it is rejected without granting access

#### Scenario: Old or expired session
- **WHEN** a legacy v1/v2 session, expired v3 session, or v3 session issued more than 60 seconds in the future is presented
- **THEN** the request is treated as unauthenticated

#### Scenario: Role key rotation
- **WHEN** the uploader key or admin key changes
- **THEN** previously issued sessions for that role fail verification and sessions for the other role remain valid

#### Scenario: Signing secret rotation
- **WHEN** the independent signing secret changes
- **THEN** all previously issued sessions fail verification

### Requirement: Both roles retain upload and read access
The system SHALL allow both roles to reserve uploads, obtain Blob upload tokens and process replays under existing binding, request-budget and validation rules. Both roles SHALL be able to read games, including excluded games, registered members, linked accounts and member statistics. Upload processing SHALL retain automatic account discovery, account display-name refresh and game/statistics ingestion, but SHALL NOT provide manual member registration or reassignment to uploaders. The maintenance endpoint SHALL retain its independent `CRON_SECRET` authentication.

#### Scenario: Authenticated upload and browsing
- **WHEN** either role presents a valid session to existing upload or read routes
- **THEN** authorization permits the request and existing resource, ownership and validation checks remain in force

#### Scenario: New replay participant
- **WHEN** an uploader processes a replay containing a previously unseen account
- **THEN** ingestion may create an unlinked account but does not register a member or assign that account to a member

### Requirement: Member and game management is administrator-only
The system SHALL require a currently valid admin session before member creation or update, account linking or unlinking, game date correction or original-date restoration, and game exclusion or restoration. Every mutation Server Action SHALL perform its own check before processing input or writing data. An uploader SHALL receive a permission-denied result, while unauthenticated callers SHALL receive a re-login result. Neither case SHALL perform a database mutation or cache revalidation.

#### Scenario: Direct uploader mutation request
- **WHEN** an uploader directly invokes any member or game management action, regardless of the page or client UI used
- **THEN** the action returns an administrator-required error without modifying data or revalidating caches

#### Scenario: Unauthenticated or forged mutation request
- **WHEN** a missing, expired, legacy or tampered session directly invokes a management action
- **THEN** the action requests re-login without modifying data or revalidating caches

#### Scenario: Administrator mutation request
- **WHEN** an admin invokes a management action with valid input
- **THEN** the action applies the existing validated operation and revalidates affected views

### Requirement: Admin page access is checked independently of the proxy
The system SHALL protect `/admin` and its subpaths from uploader access. The Proxy SHALL redirect uploader requests for those paths to `/members`. The admin page SHALL verify the role before querying management data, independently of Proxy execution. Unauthenticated pages SHALL retain login redirects and unauthenticated API routes SHALL return 401. Login completion SHALL redirect an uploader requesting an admin path to `/members` while retaining existing internal-URL sanitization for other destinations.

#### Scenario: Uploader opens admin URL
- **WHEN** an uploader requests `/admin` or a subpath, or the admin page is invoked without the Proxy
- **THEN** they are redirected to `/members` and the page does not load management data

#### Scenario: Administrator opens admin URL
- **WHEN** an admin requests `/admin`
- **THEN** the management page loads

#### Scenario: Login destination is admin-only
- **WHEN** an uploader logs in with a requested admin destination
- **THEN** login completes at `/members` instead of showing the management page

### Requirement: The UI reflects the verified role
The system SHALL display the current uploader or admin role. It SHALL show the admin navigation entry, member-management links, game date correction/restoration forms and game exclusion/restoration controls only to admins. Registered-member pages and game read content SHALL remain available to both roles. UI visibility SHALL NOT substitute for server authorization.

#### Scenario: Uploader UI
- **WHEN** an uploader views navigation, game details or the excluded-game list
- **THEN** read content is visible, but the admin link and all game mutation controls are absent

#### Scenario: Administrator UI
- **WHEN** an admin views those pages
- **THEN** the admin link and existing management controls are available

### Requirement: Role separation is documented and verified
The system SHALL document the permission matrix, all required secrets, re-login of legacy sessions, per-role key rotation, deployment verification and shared-key limitations. Automated regressions SHALL exercise real session signatures and management-action authorization, route/page checks and UI visibility for both roles. The change SHALL pass strict OpenSpec validation and the repository's complete quality gate.

#### Scenario: Local implementation verification
- **WHEN** the role separation change is marked implemented
- **THEN** its requirements, design and tasks exist, strict OpenSpec validation and the complete quality gate pass, and local verification is distinguished from production deployment evidence
