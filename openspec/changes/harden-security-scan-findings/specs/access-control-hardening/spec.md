## ADDED Requirements

### Requirement: Authentication requests use a verified client identity

The system SHALL use Vercel's normalized x-vercel-forwarded-for IP only when VERCEL=1 and ignore raw x-forwarded-for. Production without a valid trusted identity SHALL reject authentication attempts. Non-production execution outside Vercel SHALL use the fixed local-development identity.

#### Scenario: Rotated raw forwarded headers

- **WHEN** a client changes raw x-forwarded-for while retaining the same normalized Vercel IP
- **THEN** authentication requests use the same IP budget

#### Scenario: Missing production identity

- **WHEN** production lacks VERCEL=1 or a valid normalized client IP
- **THEN** no login attempt or provider call is authorized

### Requirement: OAuth request budgets precede provider work

The system SHALL apply atomic PostgreSQL budgets shared across instances before login-start and callback work. Defaults SHALL allow ten requests per trusted IP and one hundred globally per 60-second window. All admitted requests SHALL consume their budgets. Failed login audit writes SHALL be separately bounded.

#### Scenario: Concurrent requests exceed the budget

- **WHEN** concurrent requests exceed the per-IP or global allowance
- **THEN** excess requests are rejected before creating an attempt or invoking Discord

#### Scenario: Independent IP with remaining global allowance

- **WHEN** one IP exhausts its allowance and another submits a request while global capacity remains
- **THEN** the second IP retains its independent allowance
