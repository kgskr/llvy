# web-analytics Specification

## Purpose

Connect Vercel Web Analytics across shared Next.js pages while preserving application authentication boundaries and documenting live collection verification.

## Requirements

### Requirement: Shared Next.js Web Analytics integration

The application SHALL mount exactly one `Analytics` component from `@vercel/analytics/next` in the shared root layout for login and authenticated pages. The root layout SHALL remain a Server Component. The integration SHALL use the SDK's default environment detection and SHALL NOT add custom events or user-identifying properties.

#### Scenario: Shared page coverage

- **WHEN** a login or authenticated page is rendered
- **THEN** its shared layout SHALL include the same Next.js Analytics integration without page-specific duplicate instances

#### Scenario: Development environment

- **WHEN** the application runs in development mode
- **THEN** the integration SHALL retain the SDK's development behavior without forcing production collection

### Requirement: Analytics endpoints bypass only the intended authentication boundary

The authentication Proxy matcher SHALL exclude `/_vercel/insights` and its descendants so requests can reach Vercel's Analytics handling without requiring an LLVY session. Similar prefixes and other protected application or API paths SHALL retain their existing authentication requirements.

#### Scenario: Anonymous analytics traffic

- **WHEN** an unauthenticated browser requests `/_vercel/insights/script.js` or `/_vercel/insights/view`
- **THEN** the LLVY authentication Proxy SHALL NOT intercept the request

#### Scenario: Similar prefixes remain protected

- **WHEN** a request targets `/_vercel/insights-private`, `/_vercel/other`, `/members`, or `/api/members`
- **THEN** the authentication Proxy SHALL still match the request

### Requirement: Deployment verification is documented separately

Deployment documentation SHALL describe enabling Vercel Web Analytics, deploying the integration, and checking browser requests and dashboard page views. It SHALL distinguish local validation from successful production collection.

#### Scenario: Operator enables Analytics

- **WHEN** an operator follows the deployment documentation
- **THEN** the instructions SHALL identify redeployment and live collection verification as required steps after dashboard activation
