## ADDED Requirements

### Requirement: Uploader adds replay upload to shared member-read capabilities

The system SHALL support viewer, uploader, admin and owner with Korean labels `일반 사용자`, `업로더`, `관리자`, `서비스 오너`. All four authenticated roles SHALL receive birth years on existing member-read surfaces that expose them to admin/owner. Uploader SHALL retain the same member-read capabilities as viewer and gain web/desktop replay reservation, transfer, processing and own-upload status. Birth-year access SHALL NOT grant other privileged data or management capabilities. Existing minimal autocomplete and member-suggestion projections SHALL remain unchanged for all roles. Replay ingestion MAY perform its existing automatic game/participant/account persistence. Uploader SHALL NOT gain manual member/Riot-account mutations, game date/exclusion/deletion, login-account listing, grant management, audit access or owner-only maintenance reporting. Admin and owner SHALL retain their existing management and upload authority. Every capability guard SHALL use explicit allowed roles and reject unknown roles.

#### Scenario: Uploader bypasses hidden controls

- **WHEN** uploader directly calls a management Server Action, DAL operation or route
- **THEN** the server rejects the request before mutation or privileged data disclosure regardless of UI state

#### Scenario: Ingestion contains normal automatic persistence

- **WHEN** an uploader processes a valid replay containing participants not yet represented by replay-derived account records
- **THEN** the existing authorized ingestion behavior completes without granting separate manual member or Riot-account management authority

#### Scenario: Viewer and uploader read birth years without management capability

- **WHEN** viewer or uploader opens an existing member-read surface that returns birth years to admin/owner
- **THEN** birth years are available in that surface and its server payload, while manual edits and unrelated privileged information remain forbidden

### Requirement: Owner and administrator grant uploader to eligible registered viewers

Only current browser-authenticated owner or admin SHALL grant uploader to an existing active viewer account. The target SHALL be identified by its persisted login-account ID, not a game member or submitted Discord identity. The service SHALL freshly verify non-pending membership through the configured bot before acquiring transaction locks. A newer denial SHALL override an older positive lookup. No active target session or recent target login SHALL be required. Grant issuance SHALL create a new immutable uploader grant ID, permit at most one active uploader grant per account and atomically persist success audit. Administrator/uploader grants SHALL NOT coexist through ordinary transitions. Owner/admin targets and suspended accounts SHALL be ineligible; duplicate active grants SHALL return a conflict without another grant or success audit.

#### Scenario: Administrator grants an inactive but admitted viewer

- **WHEN** admin chooses an active registered viewer with no remaining login session and the bot confirms current membership
- **THEN** the grant commits and the next eligible login resolves uploader without a game-member link

#### Scenario: Target already has a browser session

- **WHEN** owner or admin grants uploader to an eligible viewer with a valid browser session
- **THEN** its next request derives uploader authority from the database without changing the v5 cookie or authorizing a desktop device automatically

#### Scenario: Invalid target or competing grants

- **WHEN** the target is suspended, already admin/owner/uploader, or concurrent administrator/uploader grants compete for one viewer
- **THEN** no unauthorized or duplicate grant commits and serialized revalidation permits only an eligible final transition

#### Scenario: Provider cannot confirm membership

- **WHEN** lookup returns an outage, rate limit, bot access/configuration error or malformed response
- **THEN** no new uploader grant commits and existing target authority remains unchanged; a confirmed departure follows atomic suspension instead

### Requirement: Owner and administrator can revoke uploader without delegating higher authority

Current browser-authenticated owner or admin SHALL revoke an uploader grant without a Discord lookup. The transaction SHALL revalidate issuer authority, reject current owner/admin targets, retire the grant, revoke all existing target browser/desktop sessions and device credentials, invalidate unfinished desktop authorizations and atomically record audit. Already revoked viewer targets SHALL yield an unchanged result without a duplicate success event. Next eligible login SHALL resolve viewer. Regrant SHALL create a new ID and SHALL NOT revive former sessions, approvals, reservations or devices. Uploader and viewer SHALL NOT grant or revoke any role. Admin SHALL NOT grant/revoke admin or modify owner.

#### Scenario: Different administrator revokes a grant

- **WHEN** a current admin revokes an uploader issued by another admin or owner during a Discord outage
- **THEN** the same local revocation rule applies independently of the original issuer and no provider lookup is required

#### Scenario: Administrator submits a privileged target

- **WHEN** admin submits its own account, another admin account or the configured owner to an uploader-management action
- **THEN** the server rejects the target without changing any role, session or grant

#### Scenario: Target is promoted while uploader membership lookup is pending

- **WHEN** the target becomes admin before an uploader grant's positive or negative membership response is applied
- **THEN** the uploader grant rejects the protected target without suspending it or revoking its administrator grant or sessions

#### Scenario: Issuer is revoked while a negative lookup is pending

- **WHEN** the issuer loses administrator authority before its uploader grant receives a membership denial
- **THEN** the operation rejects the stale issuer without applying that denial to the target

#### Scenario: Revocation races upload persistence

- **WHEN** uploader revocation and final replay persistence compete for authority locks
- **THEN** persistence either commits before revocation completes or fails after revocation wins; no former uploader mutation newly commits after completed revocation

### Requirement: Promotion and demotion do not retain hidden upload authority

Only owner SHALL promote a viewer or uploader to admin after existing fresh-membership checks. Promotion from uploader SHALL atomically retire the uploader grant, revoke its existing sessions, devices and unfinished approvals, issue a new administrator grant and record audit. New eligible login and desktop approval SHALL be required for that promoted account. Administrator revocation SHALL return the account to viewer after new login and SHALL NOT restore or create uploader authority. A later uploader grant SHALL be a separate explicit operation. Existing accounts SHALL NOT be automatically promoted by migration.

#### Scenario: Uploader becomes administrator and later loses admin

- **WHEN** owner promotes uploader and later revokes its admin grant
- **THEN** both former grants remain retired, previous upload bindings stay invalid, and the next eligible login resolves viewer until an explicit new grant

### Requirement: Permissions UI exposes only authorized role transitions

The system SHALL make `/admin/users` and `사용자 권한` navigation available to owner/admin, using the bounded registered-account listing. Viewer rows SHALL offer `업로더 권한 부여`; uploader rows SHALL offer `업로더 권한 회수`. Only owner SHALL receive administrator controls. Owner/admin rows SHALL NOT offer uploader controls, and suspended targets SHALL NOT offer enabled grant controls. Successful revocation and uploader-to-admin promotion SHALL explain that existing logins and device connections require renewal. Audit and reconciliation reporting SHALL remain owner-only. Each underlying action and query SHALL independently enforce these capabilities.

#### Scenario: Administrator opens the user list

- **WHEN** admin visits `/admin/users`
- **THEN** it can search registered users and grant/revoke uploader on eligible rows, with no administrator controls, audit data or owner-only maintenance reports

#### Scenario: Uploader visits administrative URLs

- **WHEN** uploader opens `/admin`, `/admin/users` or `/admin/audit` or submits their backing calls
- **THEN** the page denies or redirects without privileged data and backing queries/actions reject access; `/upload` remains accessible

### Requirement: Desktop delegates the same uploader grant with existing limited scopes

When desktop is enabled, active uploader SHALL be eligible for the existing browser-approved desktop connection, code exchange, refresh, session query and upload flow. Approval, exchange, refresh, reservation, transfer, status and final persistence SHALL verify current account/session/guild, original role and matching uploader grant as applicable. Approved requests and device sessions SHALL bind uploader grants separately from administrator grants. Device credentials SHALL retain only existing replay upload/status and own-device management scope, lifetimes, quotas and revocation rules. Browser and device credentials SHALL remain non-interchangeable, and desktop disablement SHALL NOT disable authorized web uploads.

#### Scenario: Uploader revoked after browser approval

- **WHEN** uploader approval has occurred but its grant is revoked before code exchange
- **THEN** the exchange issues no device credentials and a subsequent regrant does not revive the approved request

#### Scenario: Old uploader device refreshes after regrant

- **WHEN** an uploader receives a new grant and presents a refresh/access credential bound to its earlier grant
- **THEN** refresh and protected desktop operations fail without restoring old authority; a new browser-approved connection is required

#### Scenario: Desktop token reaches management

- **WHEN** an upload-scoped device belonging to uploader, admin or owner calls permission or member/game management
- **THEN** its credential supplies no authorization to that operation regardless of account role

### Requirement: Contract rollout and validation cover all four roles

The desktop-v1 role enum and fixtures SHALL include uploader, preserving existing fields, routes, scopes and admin/owner response semantics. Windows client role validation, fixed contract copy and user-facing role handling SHALL support uploader before uploader desktop usage is released. Validation SHALL cover positive and negative entry-point access for all four roles, birth-year access for all four roles and exclusion of unrelated privileged data for viewer/uploader with warm caches, grant concurrency and revocation during web/device uploads. Required actual browser/Discord/Blob/Windows verification SHALL remain separate from local or mocked results. Additive migrations SHALL preserve existing accounts, historical grants/audits and browser sessions; rollback SHALL drain and revoke new-role authority before serving incompatible old code.

#### Scenario: Existing client supports only two uploading roles

- **WHEN** a supported client rejects uploader in the session response
- **THEN** rollout records that incompatibility and updates/verifies the client contract and parser before claiming uploader desktop support; the server does not mislabel uploader as admin

#### Scenario: Local tests pass while real environments are untested

- **WHEN** automated tests and strict OpenSpec validation pass but required browser or external acceptance is incomplete
- **THEN** remaining tasks stay unchecked and the change stays active without claiming rollout completion
