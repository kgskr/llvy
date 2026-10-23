## ADDED Requirements

### Requirement: Change types identify documentation owners and targets

The documentation workflow SHALL map API and authorization changes, configuration and environment variables, execution and release commands, architecture and implementation status, and document additions or moves to their owning repository and affected documentation. LLVY, Worker and uploader SHALL retain usable local instructions without requiring sibling checkouts. Source contracts SHALL be updated before derived summaries or pinned consumer copies; unrelated LLVY internals SHALL NOT be copied into the extension wiki.

#### Scenario: A desktop API contract changes

- **WHEN** a contributor changes the desktop API contract
- **THEN** the instructions identify LLVY OpenSpec and contract sources, the uploader's separately reviewed pinned copy, and the relevant wiki summaries
- **AND** schema or fixture availability is not assumed before implementation

#### Scenario: An execution setting changes

- **WHEN** a command or environment variable changes
- **THEN** the instructions identify the owning README or development/deployment guide, applicable example configuration, and affected wiki instructions

### Requirement: Document lifecycle keeps navigation and evidence current

The wiki workflow SHALL cover new topics, file renames, heading changes and deletion, including README, llms.txt, source listings, inbound links and material change logs where affected. Editors SHALL distinguish planned behavior, implemented behavior and external verification. Fact verification dates SHALL advance only after rechecking the stated evidence, not merely editing prose. Historical evidence SHALL remain distinguishable from current guidance.

#### Scenario: A wiki topic moves

- **WHEN** a topic file or heading is renamed or removed
- **THEN** the editor checks affected indexes, inbound links and anchors and records the material change

#### Scenario: Only wording changes

- **WHEN** wording changes without rechecking an external fact
- **THEN** its verification date and verification status remain unchanged

### Requirement: Public documentation contains project facts rather than private context

Contributor instructions SHALL prohibit personal home paths and account examples, private tool policies, copied global agent instructions, conversation or request provenance, and agent permission or sandbox approval narratives in public documentation. Documentation SHALL preserve technical decisions, rationale, generic prerequisites and reproducible verification scope using fictional examples or repository-relative paths. Necessary runtime and dependency versions SHALL remain valid evidence.

#### Scenario: A design decision is documented

- **WHEN** an editor records a design decision or validation outcome
- **THEN** the document describes the technical choice, reason and evidence without attributing it to a private conversation or individual workstation procedure

### Requirement: Documentation completion has explicit checks and pending work

The workflow SHALL require applicable source-to-document comparison, link and anchor checks, documented command and configuration checks, formatting and whitespace checks, OpenSpec validation for affected specifications, and public-content review. Missing cross-repository updates SHALL identify the target repository, document and required change and SHALL NOT be reported as completed synchronization. This workflow SHALL NOT require siblings for runtime builds or imply automatic documentation synchronization.

#### Scenario: A related repository is unavailable

- **WHEN** an editor cannot update a related repository
- **THEN** local documentation work can proceed and the remaining target and change are recorded explicitly without claiming all documentation is synchronized
