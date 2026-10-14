## 1. Persistence and correctness

- [x] 1.1 Add membership decision persistence and reject stale registration evidence without changing account lock ordering.
- [x] 1.2 Persist replay display-name observation time and prevent older or unknown observations replacing newer names.
- [x] 1.3 Validate stored replay Unicode and member input at the shared boundaries.

## 2. Indexed search

- [x] 2.1 Add reproducible normalization SQL, generated search columns, indexes and existing-data migration.
- [x] 2.2 Use indexed exact SQL matches, member-level union/count/pagination and bounded page previews.

## 3. Verification and documentation

- [x] 3.1 Add permanent tests for every reported issue, Unicode compatibility, migration and query plans.
- [x] 3.2 Verify authentication commit orders and existing lock regressions on isolated PostgreSQL.
- [x] 3.3 Run the independent security patch review and address confirmed regressions.
- [x] 3.4 Update docs and run the full quality gate, real Valkey/replay checks and strict OpenSpec validation.
