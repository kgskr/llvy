# game-detail-icons Specification

## Purpose
Provide authenticated game details with champion portraits and ordered final item icons while preserving safe replay-data projection, accessible fallbacks, and bounded patch-specific asset lookup.
## Requirements
### Requirement: Project final item slots

Authenticated game detail reads SHALL return seven ordered item slots from retained replay statistics. Nonnegative integer IDs up to int4 maximum, represented as numbers or decimal strings, SHALL be accepted. Zero SHALL mean empty; absent or invalid values SHALL be null. Raw statistics MUST NOT be exposed through the read model. Existing role projection and authorization SHALL remain in force.

#### Scenario: Mixed retained slot values

- **WHEN** retained slots contain numeric IDs, decimal strings, zero, missing fields and malformed values
- **THEN** the detail returns exactly seven slots in source order and preserves the distinction between empty and unknown

### Requirement: Display champion portraits and item icons

The game detail SHALL show a portrait beside each known champion name and an `아이템` column containing six item slots followed by a visually separated trinket slot. Item names SHALL be available as tooltips and accessible text without permanent visible item-name labels. Unknown slots and unavailable icons SHALL have stable placeholders. Champion text, participant links, position ordering and existing statistics SHALL remain available. Narrow viewports SHALL scroll within the table container.

#### Scenario: Items and portraits are available

- **WHEN** a participant has known champion and item assets
- **THEN** the champion portrait appears beside the localized name and all seven item positions retain their order with the trinket separated

#### Scenario: Missing data or failed images

- **WHEN** an item slot is empty, unknown, or its image fails to load
- **THEN** no broken-image glyph is displayed, slot dimensions remain stable, and accessible descriptions distinguish these states

### Requirement: Bound and validate external asset lookups

Assets SHALL use the first official DataDragon version matching the recorded major/minor patch, or the latest official version only when no game version is recorded. Missing patches SHALL fall back without substituting another patch. The complete catalog lookup SHALL be bounded to two seconds, coalesce concurrent same-patch calls, retain only successful nonempty catalogs for 24 hours from completion, and bound memory to eight entries. Failures and late responses MUST NOT poison subsequent retries. Only validated Riot CDN image paths SHALL be returned, and champion matching SHALL ignore case.

#### Scenario: Historical replay assets

- **WHEN** the replay build belongs to a supported older patch
- **THEN** the portrait, item names and images use that patch's official catalog

#### Scenario: Timeout and retry

- **WHEN** catalog loading times out and later completes
- **THEN** the page can render fallback content within the lookup limit and a later request can recover without being overwritten by the timed-out response
