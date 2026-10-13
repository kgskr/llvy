## Why

운영 캐시의 원격 연결 실패로 조회가 캐시 대기 후 PostgreSQL로 전환된다. Vercel 함수와 Neon이 있는 싱가포르에 Upstash Redis를 배치해 캐시 통신 거리를 줄인다.

## What Changes

- Upstash Redis의 싱가포르 primary와 Vercel Production 연결을 구성한다.
- **BREAKING**: 캐시 설정을 `VALKEY_URL`/`VALKEY_KEY_PREFIX`에서 `REDIS_URL`/`REDIS_KEY_PREFIX`로 전환하고 기존 환경변수를 자동 대체값으로 사용하지 않는다.
- Redis 클라이언트인 `ioredis`를 유지하고 연결 모듈·테스트·운영 문서를 Redis 기준으로 정리한다.
- 권한 확인, 60초 TTL, 세대 무효화, 원자적 검색 인덱스, 장애 시 DB 대체 계약을 유지한다.
- 실제 로컬 Redis에서 회귀 검사하고 운영 배포의 리전·연결·응답 시간을 확인한다.

## Capabilities

### New Capabilities

- `redis-cache-deployment`: 싱가포르 Upstash 연결, 환경변수 전환 및 배포 검증 계약. 기존 query-cache change의 캐시 동작 계약을 유지하면서 제공자 설정을 대체한다.

### Modified Capabilities

없음. 현재 `openspec/specs`에 통합된 기존 capability는 없다.

## Impact

`src/lib/valkey.ts`와 캐시 호출부, 캐시 테스트·스크립트, `.env.example`, Vercel 설정, 캐시·배포 문서에 영향을 준다. 사용자 API DTO와 PostgreSQL 스키마는 유지한다. Redis 자격증명은 서버 환경변수에만 저장한다.
