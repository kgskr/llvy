## 1. Redis connection and deployment configuration

- [x] 1.1 Create Singapore Upstash Redis on the Free plan and connect only Vercel Production.
- [x] 1.2 Rename the connection module and switch callers to REDIS_URL/REDIS_KEY_PREFIX with the existing ioredis safeguards.
- [x] 1.3 Add regression coverage for retired URL isolation and connection replacement; move integration fixtures to disposable Redis.

## 2. Documentation and local validation

- [x] 2.1 Update environment examples, Redis deployment/runbook and developer commands; preserve historical document links.
- [x] 2.2 Run real local Redis cache/search regressions and the complete quality gate.
- [x] 2.3 Validate OpenSpec strictly and review the final diff against the production base.

## 3. Production rollout

- [ ] 3.1 Publish the verified commit and deploy it to Production in sin1.
- [ ] 3.2 Verify domain/commit/region, authenticated cold/warm reads, Redis cache activity and runtime warnings; record the production verification boundaries.
