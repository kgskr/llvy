## 1. Fast cache fallback

- [x] 1.1 Reduce connection/readiness/command deadlines to 100ms without weakening TLS, cooldown or DB fallback.
- [x] 1.2 Prove stalled readiness and established-connection command failure with deterministic and real Redis tests.

## 2. Request authentication

- [x] 2.1 Add separate read-only render/request memoization and preserve fresh mutation/upload guards.
- [x] 2.2 Use the shared read path in pages, read models, owner read DALs and the autocomplete handler.
- [x] 2.3 Verify one DB lookup, concurrent request isolation, null/errors, subsequent revocation and fresh guards.

## 3. Validation and rollout

- [x] 3.1 Update current docs and run Redis/PostgreSQL/replay full quality gate, React review and OpenSpec strict validation.
- [ ] 3.2 Publish and deploy the verified commit; confirm domain/SHA/region, authenticated reads, cache activity and logs.
- [ ] 3.3 Record measured results and verification boundaries, and synchronize main.
