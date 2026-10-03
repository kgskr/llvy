## ADDED Requirements

### Requirement: Login throttling uses a non-spoofable key
The system SHALL enforce failed-login throttling using a key that is not solely derived from attacker-controlled request headers. The login flow MUST include a stable pre-auth throttle bucket that cannot be bypassed by rotating `x-forwarded-for` or similar forwarded-header values.

#### Scenario: Rotated forwarded headers do not bypass throttling
- **WHEN** an unauthenticated client repeatedly submits wrong passwords while varying `x-forwarded-for`
- **THEN** the system applies the same effective pre-auth throttle budget and blocks attempts after the configured limit

#### Scenario: Missing trusted client identity still throttles
- **WHEN** the app cannot derive a deployment-verified trusted client identity
- **THEN** the system falls back to a stable global or otherwise non-spoofable pre-auth login bucket

### Requirement: Login throttle runs before password verification
The system SHALL check the login throttle before verifying the submitted shared password so excessive attempts do not repeatedly reach password comparison.

#### Scenario: Over-limit request does not verify password
- **WHEN** the effective login throttle bucket is over its configured limit
- **THEN** the system returns a throttle error without evaluating the submitted password

### Requirement: Login throttle has spoofing regression coverage
The system SHALL include automated coverage proving that attacker-controlled forwarded-header rotation does not create independent login buckets.

#### Scenario: Regression test models header rotation
- **WHEN** the test submits failed login attempts with different forwarded-header values
- **THEN** the test observes the same blocking behavior as a stable client identity after the configured limit
