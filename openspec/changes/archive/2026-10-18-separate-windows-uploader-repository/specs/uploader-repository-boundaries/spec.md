## ADDED Requirements

### Requirement: Server and Windows client plans have independent ownership

LLVY SHALL own the pending desktop server API and authorization change. The separate `llvy-uploader` repository SHALL own the pending Go Windows application and release change with its own OpenSpec configuration and contributor instructions. The separation SHALL preserve the original task and review history and MUST NOT mark unimplemented application or server work complete.

#### Scenario: Read the separated plans

- **WHEN** a contributor inspects both repositories
- **THEN** server and client implementation tasks have explicit owners and remain incomplete
- **AND** all 61 original task identifiers can be traced to their current owners and original review record

### Requirement: Desktop contracts have one source and an independent consumer

The documented contract policy SHALL name LLVY as the source of `/api/desktop/v1/` schemas and fixtures and require the uploader to consume a commit-pinned, checksum-verified copy for independent builds. Planning documents SHALL preserve existing web behavior, keep the desktop flag off by default, and distinguish desktop support from optional Worker integration. This separation SHALL NOT add runtime code, actual flags, schema migrations or provider configuration.

#### Scenario: Work on one checkout

- **WHEN** a contributor reads the implementation and release procedures
- **THEN** neither repository requires a sibling checkout for ordinary builds and the uploader protocol connects directly to LLVY without requiring a Worker
- **AND** the API contract and feature-flag behavior are clearly identified as planned until implemented

### Requirement: Extension documentation links authoritative repository plans

The wiki SHALL cover Worker and uploader project context while keeping LLVY implementation requirements in LLVY OpenSpec. It SHALL provide working links to the new repository and both pending changes and distinguish historical monorepo design from the current repository boundary.

#### Scenario: Find the Windows uploader from the wiki

- **WHEN** a reader follows the uploader entry
- **THEN** it can find client plans, server API ownership, contract version policy and implementation status without treating a historical plan as current behavior
