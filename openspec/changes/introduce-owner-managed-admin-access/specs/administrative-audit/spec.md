## ADDED Requirements

### Requirement: Attributed changes and authentication events
The system SHALL record login success/failure/logout and admin/owner mutations including member changes, account links, game management, grants/revocations and replay processing outcomes. Logs SHALL carry actor identity/role/name snapshot, action, target, result, timestamp and request correlation. Credentials, credential hashes and session cookies SHALL NOT be logged.

#### Scenario: Transactional mutation
- **WHEN** a DB mutation succeeds
- **THEN** its success audit SHALL commit in the same transaction, and an audit insertion failure SHALL roll back the mutation

#### Scenario: Replay outcomes
- **WHEN** a replay is processed, duplicated or fails
- **THEN** the event SHALL identify its bound actor and upload request without secrets

### Requirement: Audit access is owner-only
Only owner SHALL query audit logs. Admin/viewer direct access SHALL be blocked and audit menus SHALL be absent. Application users SHALL NOT have audit modification or deletion functions.

#### Scenario: Administrator requests logs
- **WHEN** admin directly invokes the audit page or query
- **THEN** access SHALL fail without querying or returning log records
