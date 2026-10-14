## ADDED Requirements

### Requirement: Viewer receives privacy-safe member data
Viewer SHALL see only games/members navigation and SHALL receive masked names everywhere member real names occur. Names of at least three graphemes SHALL retain first/last with all interior graphemes masked; two SHALL retain first plus *; one SHALL become *. Birth year SHALL be omitted from viewer payloads, HTML and client properties. Admin/owner SHALL receive full names and birth years. Riot IDs SHALL retain current display.

#### Scenario: Read-only browsing
- **WHEN** viewer views members, member history or game participants
- **THEN** no original real name or birth year SHALL occur in browser-delivered data and upload/management controls SHALL be absent

#### Scenario: Privileged browsing
- **WHEN** a currently authorized admin or owner views those pages
- **THEN** full name/birth year and permitted management controls SHALL appear without exposing data to other roles through a shared cache
