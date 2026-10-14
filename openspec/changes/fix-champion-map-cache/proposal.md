## Why

성공한 DataDragon 챔피언 맵이 프로세스 수명 동안 만료되지 않아 새 챔피언이나 표시명 변경을 다시 조회하지 않는다. 최초 조회가 겹치면 동일한 버전·챔피언 맵 조회도 중복 실행된다.

## What Changes

- 성공한 메모리 맵을 조회 완료 시점부터 24시간 동안 재사용하고 만료 후 다시 조회한다.
- 같은 인스턴스에서 진행 중인 조회 Promise를 공유하며 성공·실패·타임아웃 후 해제한다.
- 전체 2초 제한, 원격 응답 검증, 내부 이름 폴백과 Next.js fetch 하루 재검증 설정을 유지한다.
- 만료 경계, 동시 최초 조회·갱신, 실패 후 재시도와 늦은 응답 격리를 회귀 테스트로 검증한다.

## Capabilities

### New Capabilities

- `champion-name-cache`: 프로세스 내 챔피언 표시명 캐시의 만료, 동시 조회 공유와 실패 복구 계약.

### Modified Capabilities

없음.

## Impact

- `src/lib/champions.ts`, `src/lib/champions.test.ts`, 개발 안내와 검증 기록.
- 외부 API, DB 스키마, Redis 조회 캐시와 화면 무효화 방식은 변경하지 않는다.
