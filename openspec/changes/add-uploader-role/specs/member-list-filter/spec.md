## MODIFIED Requirements

### Requirement: Filtering stays local and preserves existing information boundaries

Typing, clearing or pressing Enter in the list search SHALL NOT issue a search request, invoke a Server Action, query the database, change the URL or navigate. Initial page loading SHALL retain the existing authenticated role-specific read model. Result links SHALL avoid automatic prefetch so newly visible cards do not cause server requests. Existing member details and administrative actions SHALL remain reachable by explicit links. All authenticated roles SHALL receive recorded birth years in the loaded member data; viewer and uploader SHALL not receive administrative controls. Search SHALL continue to use only names and linked Riot IDs.

#### Scenario: Change the query repeatedly

- **WHEN** a user types, replaces or clears a query or presses Enter
- **THEN** only the local card list SHALL update without additional requests or navigation

#### Scenario: Viewer filters an already loaded list

- **WHEN** a viewer searches for a member
- **THEN** the member's original name, recorded birth year and linked Riot IDs SHALL remain visible while administrative controls remain absent
