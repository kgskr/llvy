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

## 운영 조회 검증

애플리케이션 변경 커밋 `8921996`의 Production 배포가 READY에 도달하고 운영 도메인과
싱가포르 함수 리전에 연결된 것을 확인했다. 로그인된 일반 사용자로 자동완성 API와 모임원 목록의
첫 조회·반복 조회가 HTTP 200을 반환했다. 비로그인 자동완성 요청은 401로 차단되었다.

Upstash 데이터 브라우저에서 운영 세대 키, 이름·Riot 자동완성 인덱스와 viewer 모임원 목록 캐시가
생성되는 것을 확인했다. 만료된 키가 사라지고 다음 조회에서 다시 생성되는 것도 확인했다.
검증 구간의 새 배포 로그에서는 캐시 연결 실패 경고가 조회되지 않았다.

이 확인은 실제 Upstash 연결과 읽기 캐시 경로를 검증한다. 오너·관리자 역할 변경, 실제 데이터 변경에
따른 여러 인스턴스의 무효화, 강제 장애·휴면 복귀, Discord 재로그인, Blob 업로드와 Cron은 이번 운영
확인에 포함하지 않았다. 이러한 경로의 로컬 회귀 통과를 운영 실행 증거로 해석하지 않는다.
