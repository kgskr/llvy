# Upstash Redis 전환 검증

## 로컬 검증

Node.js 24.21.0에서 실제 Redis 7·PostgreSQL 17 컨테이너와 실제 리플레이 파일을 지정해
`npm run check`를 실행했다. 44개 파일의 테스트 778개를 건너뛰지 않고 통과했으며,
ESLint·TypeScript·프로덕션 빌드·Prettier 검사를 통과했다.

`npm run test:redis`의 연결·캐시·검색 테스트 47개와
`openspec validate --all --strict`의 변경 11개도 통과했다.
이전 `VALKEY_URL`을 읽지 않는 것과 Redis URL 교체 시 연결을 다시 만드는 회귀를 추가했다.

## 운영 연결

Upstash Redis Free를 싱가포르에 생성하고 Vercel Production에만 연결했다.
자동 요금제 업그레이드는 꺼져 있다. `REDIS_URL`은 sensitive 환경변수로 주입했고
기존 Redis SDK인 `ioredis`를 유지했다. 함수 실행 리전은 `vercel.json`의 `sin1`로 고정한다.

운영 배포와 실제 캐시 조회 확인은 별도로 기록한다. 로컬 컨테이너 통과만으로
Upstash TLS·Vercel 실행이나 실제 외부 서비스 동작이 검증된 것은 아니다.
