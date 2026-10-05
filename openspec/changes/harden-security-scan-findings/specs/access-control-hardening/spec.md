## ADDED Requirements

### Requirement: Login throttling uses a verified client identity
The system SHALL use Vercel's normalized `x-vercel-forwarded-for` IP only when `VERCEL=1`, ignore raw `x-forwarded-for`, and enforce an atomic Postgres counter shared across server instances. The default SHALL permit ten login attempts per IP in a 60-second fixed window. All admitted attempts SHALL consume the budget, including successful and empty-password attempts. A global login bucket SHALL NOT be applied.

#### Scenario: Rotated raw forwarded headers do not bypass throttling
- **WHEN** a client repeatedly submits passwords while varying raw `x-forwarded-for` but retaining the same Vercel-normalized IP
- **THEN** all attempts consume the same shared IP budget and attempts beyond the limit are rejected

#### Scenario: Independent client IPs
- **WHEN** one verified IP exhausts its budget and a different verified IP submits a password
- **THEN** the second IP retains its independent login budget

#### Scenario: Missing production client identity
- **WHEN** production lacks `VERCEL=1` or a valid normalized client IP
- **THEN** login is rejected before password verification without creating a global fallback bucket

#### Scenario: Local development
- **WHEN** the app is not in production and is running outside Vercel
- **THEN** login throttling uses the fixed `local-development` identity

### Requirement: Login throttle runs before password verification
The system SHALL check the login budget before comparing the shared password. Wrong-password responses SHALL include a 400ms delay by default.

#### Scenario: Over-limit request does not verify password
- **WHEN** the effective IP budget is exhausted
- **THEN** the system returns a throttle error without evaluating the submitted password

### Requirement: Login identity and budget regressions are covered
The system SHALL include automated tests for trusted-header selection, missing-identity rejection, IP isolation, atomic concurrent attempts, and pre-verification rejection.

#### Scenario: Concurrent login attempts
- **WHEN** concurrent attempts for one IP exceed its configured budget
- **THEN** no more than the allowed number proceed to password verification
