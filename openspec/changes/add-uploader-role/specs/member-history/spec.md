## MODIFIED Requirements

### Requirement: Present member information with one detail link

The member-list page SHALL use the heading ‘모임원 정보’. Each member's name SHALL link to the member-detail page and display as `name(birthYear)` when any authenticated viewer, uploader, admin or owner views a recorded birth year, or as the name alone otherwise. All four roles SHALL receive the recorded birth year in the list payload and HTML. The member card SHALL NOT include a separate ‘전적 보기’ link to the same page.

#### Scenario: Member has a birth year

- **WHEN** an authenticated viewer, uploader, admin or owner views a member named 민수 with birth year 1997 in the list
- **THEN** the name link displays `민수(1997)` and opens that member's detail page

#### Scenario: Member has no birth year

- **WHEN** a member has no recorded birth year
- **THEN** the name link displays only the member's name

## REMOVED Requirements

### Requirement: Viewer member links omit birth years

**Reason**: Birth-year reads are permitted for every authenticated role.

**Migration**: Use the updated member-list presentation requirement for viewer/uploader/admin/owner; preserve the name-only fallback when birth year is absent and retain management restrictions.
