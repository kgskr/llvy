# 개발·테스트

[프로젝트 README](../README.md) · [문서 목록](README.md)

## 개발 명령

Node.js 24.x에서 `npm ci`로 잠금 파일의 의존성을 설치합니다.
앱 실행에 필요한 환경변수는 [README](../README.md#로컬에서-시작하기)를 참고하세요.

| 명령                         | 용도                                                  |
| ---------------------------- | ----------------------------------------------------- |
| `npm run dev`                | 로컬 개발 서버                                        |
| `npm run check`              | 테스트 → ESLint → TypeScript → 빌드 → 포맷 검사       |
| `npm test`                   | 전체 단위·API·DB 통합 테스트                          |
| `npm run test:watch`         | 변경 시 테스트 재실행                                 |
| `npm run test:integration`   | 기본 저장·업로드 바인딩·경기 관리 DB 통합 테스트 묶음 |
| `npm run test:replay`        | 지정한 실제 리플레이의 통합 테스트                    |
| `npm run test:redis`         | 로컬 Podman Redis 7의 캐시·자동완성 통합 테스트       |
| `npm run test:auth-postgres` | 격리 PostgreSQL의 실제 연결 간 인증 잠금 경합 테스트  |
| `npm run format:write`       | Prettier 포맷 적용                                    |

`test:integration`은 `package.json`에 지정된 일부 DB 테스트를 실행합니다.
모임원 전적·만료 업로드 정리를 포함한 전체 회귀 검증에는 `npm test`나 `npm run check`를 사용하세요.

## DB 스키마 변경

스키마는 [`src/db/schema.ts`](../src/db/schema.ts), SQL 마이그레이션과 이력은
[`drizzle/`](../drizzle/)에 있습니다.

```bash
npm run db:generate   # 스키마 변경 후 마이그레이션 생성; DB 연결 불필요
npm run db:migrate    # 대상 DB에 생성된 마이그레이션 적용
npm run db:studio     # DB 조회·편집
```

마이그레이션 파일과 `drizzle/meta/`를 함께 검토하고 반영하세요. 기존 데이터가 있는 DB에
적용했을 때도 확인해야 합니다. `npm run db:push`는 개발용 일회성 DB의 빠른 동기화에만
사용하며, 운영에는 [배포 안내](deployment.md#마이그레이션과-업데이트)의 절차를 따릅니다.

## 테스트의 범위

기본 DB 테스트는 [`src/test/database.ts`](../src/test/database.ts)가 메모리에 PGlite를 만들고
`drizzle/`의 실제 SQL 마이그레이션을 적용합니다. 저장·조회, 외래키·고유키,
트랜잭션 롤백, 계정·모임원 연결과 경기 관리, 요청 제한·정리 작업을 검증합니다.
테스트 종료 시 DB를 닫습니다. 인증과 외부 요청은 테스트별로 모의 처리합니다.

`npm ci` 후 `npm run check`는 외부 서비스 자격증명 없이 실행할 수 있습니다.
인증 테스트는 정확한 Discord 문자열 ID, 독립 서명값과 실제 v5 쿠키·DB 세션을 사용합니다.
`discord-auth.integration.test.ts`는 OAuth 시작·콜백 handler의 state/binding·일회성 소비,
identify-only 교환·봇 membership·사용자 토큰 미저장, 공용 차단·일일 정리·재가입을 확인합니다.
Discord는 고정 URL에 대한 fetch 모의 응답입니다.
`account-administration.integration.test.ts`는 DB 권한·등록 계정 부여·활성 grant 고유 제약,
전체 세션 회수·owner/guild/secret 전환·업로드 grant 구분과 로그아웃을 검증합니다.
DB 트리거로 로그인·부여/회수·정지·데이터 변경의 감사 실패 rollback을 확인합니다.
직접 Action/API 호출 차단, 개인정보 투영과 세 역할 화면도 검증합니다.
`management-refinements.integration.test.ts`는 실제 삭제·Discord 계정 독립성·retired credential 이력 보존과 감사 롤백,
활성 경기 기반 미연결 목록·페이징, 코멘트 DB 제약을 검증합니다.
`game-calendar-migration.integration.test.ts`는 이전 스키마의 한국 자정 경계·수정 날짜를
마이그레이션하여 날짜만 저장되고 업로드 시각·진행 시간이 유지되는지 확인합니다.
로그인 테스트는 DB의 공유 요청 제한과 성공·실패 감사 기록을 검증합니다.
테스트는 운영 DB나 Blob을 사용하지 않습니다. 다만 PGlite는 단일 연결이므로 실제
다중 연결의 인증 잠금 경합은 아래 PostgreSQL 테스트로 별도 검증합니다. 운영 Neon 연결,
네트워크 장애, Vercel Blob 동작은 [별도 배포에서 확인](deployment.md#배포-후-확인)해야 합니다.

## PostgreSQL 인증 경합 테스트

`auth-concurrency.postgres.test.ts`는 실제 서비스 함수를 여러 PostgreSQL 연결에서 실행합니다.
가입 거절과 관리자 회수의 UUID 잠금 순서 두 경우, 만료 시도 정리의 `SKIP LOCKED`와
유효한 callback 보존을 검증합니다. 최초 가입 성공과 더 새로운 absent/pending 거절도
각각 먼저 커밋시키며 지연된 가입 차단·새 로그인 허용을 확인합니다. Discord 응답과 요청 쿠키만 모의 처리합니다.
또한 모임원 10,000명·계정 10,025개에서 실제 제출 쿼리의 `EXPLAIN ANALYZE`가 두 검색
인덱스를 사용하고 모임원/계정 전체 스캔 없이 최대 40개 페이지 행을 반환하는지 검사합니다.
Unicode 조합과 결합 순서도 PostgreSQL 17과 JavaScript 사이에서 비교합니다.
`pg` 드라이버는 이 검증의 개발 의존성입니다.

```bash
podman run --detach --rm --name llvy-auth-test-pg \
  -e POSTGRES_PASSWORD=local-test-only -e POSTGRES_DB=llvy_auth_test \
  -p 127.0.0.1:15439:5432 docker.io/library/postgres:17-alpine

# PostgreSQL이 연결을 받을 준비가 된 후 실행합니다.
LLVY_POSTGRES_TEST_URL=postgres://postgres:local-test-only@127.0.0.1:15439/llvy_auth_test \
  npm run test:auth-postgres

podman stop llvy-auth-test-pg
```

테스트는 migration을 적용하고 인증·모임원·계정·경기 테이블을 비우므로 위와 같은 폐기 가능한 DB만 사용합니다.
환경변수는 `127.0.0.1`의 `llvy_auth_test` DB만 허용하며 운영 `POSTGRES_URL`을 읽지 않습니다.
같은 변수를 `npm run check`에도 전달하면 전체 검사에 포함됩니다. 미지정 시 전체 검사에서
이 파일의 테스트 9개를 건너뛰고, 전용 명령은 설정 누락을 오류로 처리합니다.

## Redis 컨테이너 테스트

Redis의 실제 명령·TTL·무효화·검색·권한 검증은 [Podman 테스트](redis.md#podman-테스트)를
사용합니다. 이 테스트는 `LLVY_REDIS_TEST_URL`이 있을 때 실행하며 운영 `REDIS_URL`을 사용하지 않습니다.
기본 회귀 검사는 외부 Redis 없이도 실행할 수 있습니다.

메인 검색은 `/api/search/autocomplete?q=...`의 이름·Riot 후보를 사용합니다. 모든 등록 모임원의
이름을 접두어로 추천하며 Riot 계정은 연결과 활성 경기 조건을 유지합니다. `member`/`riot-account`
후보는 종류별 우선 5개, 합계 10개이고 모임원 계정 미리보기는 최대 2개입니다.
`/search?q=...` 제출은 현재 DB의 정확 이름·Riot ID 결과를 모임원별로 합친 뒤 20명씩 페이지를
나눕니다. 기존 `nickname` 요청은 Riot 검색·기존 API 응답 형태를 유지합니다.

`search-contract.test.ts`, `member-search.integration.test.ts`와 검색 화면/API 테스트에서 입력 정규화,
잘못된 Unicode·반복/혼합 파라미터, 역할별 최소 투영, 계정·전적 없는 모임원, 이름/닉네임 충돌,
동명이인 20명 초과·다계정 20개 초과의 결과를 검증합니다. 이름 후보는 UUID로 이동하고 상세에서
현재 이름·존재를 확인합니다. Riot 후보는 제출 시 현재 연결을 다시 판정합니다.

`review-regressions.integration.test.ts`는 실제 callback 경쟁, 과거·시각 불명 리플레이의
현재 이름 보존, 잘못된 Unicode의 422·Blob 정리와 모임원 입력 안내를 확인합니다.
깊이 제한을 직렬화 전에 적용하여 Node 24에서도 스택 오류 대신 파싱 오류로 거부하는지 검사합니다.
`review-migration.integration.test.ts`는 기존 행의 검색 키·가입 판정·이름 관측 시각 보강과
이름 수정 시 generated 컬럼 갱신을 검사합니다. SQL 함수는 고정된
`src/lib/search-unicode-data.json`에서 `searchNormalizationSql()`로 재생성해 migration과 비교합니다.
데이터 자체를 다시 만들 때만 Unicode 17 Node와 공식 `UnicodeData.txt`·`DerivedAge.txt`를
`searchNormalizationData()`에 전달합니다. 데이터 출처는 JSON에, 라이선스는
[`scripts/UNICODE-LICENSE.txt`](../scripts/UNICODE-LICENSE.txt)에 있습니다.

실제 Redis 회귀는 두 인덱스의 키 분리·cold/warm 조회·TTL·부분 eviction·원자 게시·동시 재구축·
커밋 후 세대 교체·롤백·DB 대체 조회를 확인합니다. API는 매 요청 인증하며 `private, no-store`,
401/400/503을 구분합니다. 브라우저에서는 한글 IME, 방향키/Enter/Escape·포인터 선택, 오류 안내와
JavaScript 없는 GET 제출을 확인합니다. 초성·유사어 검색은 범위 밖입니다.

실제 Upstash TLS와 Vercel의 여러 인스턴스·연결 수·휴면 복귀·브라우저 네트워크는
[배포 후 확인](redis.md#배포-후-확인)으로 구분합니다. 읽기 검색은 감사로그에 기록하지 않습니다.

## 챔피언 표시명 캐시

챔피언 표시명은 DataDragon 한국어 맵을 사용합니다. 성공한 비어 있지 않은 맵은 조회 완료부터
24시간 동안 프로세스 메모리에서 재사용하고, 만료 후 첫 조회에서 갱신합니다. 같은 인스턴스의
동시 최초 조회·갱신은 하나의 Promise를 공유합니다. 두 요청과 본문 처리를 합쳐 2초 안에
끝내며, 갱신 실패 시에도 내부 이름으로 폴백하고 다음 호출에서 다시 시도합니다.
Next.js fetch의 하루 재검증 설정은 별도로 유지하므로 메모리 만료가 외부 원본의 최신성을
24시간 이내로 보장하는 것은 아닙니다. 상세 계약은 [챔피언 캐시 변경](../openspec/changes/fix-champion-map-cache/)을 참고하세요.

`champions.test.ts`는 모의 fetch와 가상 시계로 만료 경계, 조회 완료 기준 수명, 동시 조회 공유,
결과 격리, 갱신 실패 후 복구와 타임아웃 이후 늦은 응답을 확인합니다. 이 검증은 실제 DataDragon
연결이나 여러 Vercel 인스턴스 사이의 외부 요청 수를 측정하지 않습니다.

## 실제 리플레이 테스트

```bash
LLVY_REPLAY_FILE="/absolute/path/to/match.rofl" npm run test:replay
```

원본 파일은 읽기만 하며 저장소에 복사하지 않습니다. 경로를 지정하지 않으면 실파일
테스트 4개는 건너뜁니다. 전체 검사에 포함하려면 같은 환경변수로 `npm run check`를 실행하세요.

이 테스트는 `/api/process`의 업로드 바인딩 검증부터 실제 파서·PGlite 저장·조회까지
실행합니다. 중복 처리, 바인딩 재사용 거부, 파일·업로드 시각의 한국 날짜 추출과 사후 모임원 연결을
확인합니다. 세션 인증과 Blob 다운로드·삭제는 모의 처리하므로 브라우저 업로드나
실제 서비스 연결의 검증 결과로 해석하지 마세요.

## 설계 문서

기능 요구사항·설계·작업 내역은 [`openspec/changes/`](../openspec/changes/)에서 관리합니다.
날짜별 검증 결과는 [`docs/validation/`](validation/)에 남깁니다.
기존 설계와 검증 자료의 목록은 [문서 안내](README.md)에 있습니다.
