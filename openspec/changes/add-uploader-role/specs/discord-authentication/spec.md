## MODIFIED Requirements

### Requirement: Bot failures open a shared circuit breaker

All bot member lookups from login, administrator/uploader grant and reconciliation SHALL consult a PostgreSQL-backed circuit breaker before external calls. Bot 401 SHALL open the bot-authentication scope and bot 403 or Unknown Guild SHALL open the configured-guild scope for 60 seconds. A global 429 SHALL block all bot lookups for at least max(60 seconds, valid Retry-After); bucket limits SHALL respect Retry-After within their scope without being misclassified as global. These controls SHALL be shared across serving instances, use stable environment/application/guild/bucket keys and store no tokens or raw responses. Requests SHALL NOT retry the same bot configuration error within the current operation. An unavailable breaker store SHALL prevent new bot calls without treating accounts as absent. Existing locally authorized sessions SHALL NOT depend on the breaker.

#### Scenario: Repeated bot configuration failure across instances

- **WHEN** one instance records bot 401/403 or Unknown Guild and another instance tries a covered lookup before the shared deadline
- **THEN** the later lookup SHALL return a retryable unavailable result without calling Discord, creating a grant/session or classifying its target as absent

#### Scenario: Longer global rate-limit delay

- **WHEN** Discord returns a global 429 with a valid Retry-After greater than 60 seconds
- **THEN** all bot lookup paths SHALL remain blocked for the longer provider delay and token rotation SHALL NOT bypass it

#### Scenario: Open breaker during scheduled reconciliation

- **WHEN** the daily worker encounters an open breaker or opens one due to a bot failure
- **THEN** it SHALL stop covered remaining lookups, preserve incomplete progress and leave unresolved account authority unchanged

### Requirement: Healthy bot-call contention waits within a bounded operation

Shared bot concurrency SHALL remain bounded independently of circuit failure classification. A healthy in-flight call or exhausted local call budget SHALL NOT immediately fail another login, administrator/uploader grant or reconciliation lookup. The caller SHALL wait and recheck shared admission controls within a bounded deadline without retaining DB transactions or row locks while sleeping. Waiting SHALL NOT repeat OAuth code exchange, bypass an open circuit, retry provider configuration failures or create membership evidence before an actual validated response. A caller that exhausts its local wait budget SHALL return a retryable local-busy result without opening a circuit. A recovery lease released before any provider call SHALL NOT be recorded as a failed probe.

#### Scenario: Two valid login callbacks overlap

- **WHEN** independently browser-bound eligible login callbacks reach membership lookup while one healthy bot call is in flight and capacity becomes available within their wait budgets
- **THEN** both SHALL complete membership lookup and issue their sessions without asking either user to repeat OAuth authorization

#### Scenario: Waiting caller observes a provider block

- **WHEN** an in-flight lookup records 401/403 or a rate-limit block while another caller is waiting for capacity
- **THEN** the waiter SHALL stop without an external member call or retrying the failed configuration

#### Scenario: Capacity never becomes available

- **WHEN** a caller's local wait deadline expires before it can safely start a member request
- **THEN** it SHALL return a local-busy result without calling Discord, opening a circuit or changing account authority
