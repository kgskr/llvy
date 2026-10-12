# 2026-10-12 리뷰 수정과 DB 검색 인덱스

결과: **fixed**. 기존 리뷰 4건과 직접 검색의 전체 목록 조회를 수정했다.
[설계와 작업](../../openspec/changes/fix-review-findings-and-index-search/)

## 변경과 재현 차단

| 대상                                                                                    | 변경                                                                                                              | 확인한 회귀                                                                                                                                    |
| --------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| [인증 저장](../../src/lib/auth-store.ts)                                                | 계정 생성 전에도 guild·Discord ID별 최신 가입 판정 버전을 보존한다. 판정 행을 account보다 먼저 잠근다.            | 새 absent/pending 뒤 지연된 이전 성공 callback은 계정·세션을 만들지 못한다. 이후 새로운 정상 로그인은 viewer로 성공한다.                       |
| [리플레이 수집](../../src/lib/ingest.ts)                                                | PUUID upsert에서 파일 수정 시각을 비교해 표시 이름과 태그를 조건부 갱신한다.                                      | 최신 → 과거 → 시각 불명 업로드 후 현재 이름 검색과 동일 계정·모임원 연결을 유지하며 세 경기를 모두 저장한다.                                   |
| [파서](../../src/lib/rofl/parser.ts)                                                    | 저장 문자열의 NUL·고립 surrogate를 RoflParseError로 거부한다. 중첩 한도를 직렬화 전에 확인한다.                   | 원래 500이던 입력은 422·바인딩 Blob 정리·예약 실패로 처리하고 경기를 저장하지 않는다. Node 24의 깊은 JSON 스택 오류도 통제된 파싱 오류가 된다. |
| [이름 검증](../../src/lib/validation.ts), [mutation](../../src/lib/member-mutations.ts) | Action과 보호된 저장 함수 양쪽에서 잘못된 문자열을 거부한다.                                                      | NUL 입력은 한국어 오류 안내를 반환하고 저장하지 않는다. emoji·결합 문자는 허용한다.                                                            |
| [직접 검색](../../src/lib/nickname-search.ts)                                           | generated 정규화 컬럼·hash 인덱스에서 SQL 정확 일치 후보를 찾고 모임원 UUID로 UNION/count/20명 페이지를 계산한다. | 기존 q/nickname 계약·동명이인·다계정·활성 경기 조건을 유지한다. 페이지별 계정 미리보기는 최대 2개다.                                           |

인증은 기존 계정의 버전 검사, 정렬한 계정 잠금, session/grant 회수와 감사 원자성을 유지한다.
독립 읽기 전용 패치 검토에서 해당 범위의 남은 우회·회귀는 발견되지 않았다.

## 새 영구 테스트와 마이그레이션

- [review-regressions.integration.test.ts](../../src/lib/review-regressions.integration.test.ts): 실제 callback 순서 제어, 리플레이 이름 보존, Unicode·Blob 정리·모임원 입력과 Node 24 중첩 입력.
- [review-migration.integration.test.ts](../../src/lib/review-migration.integration.test.ts): 이전 데이터가 있는 PGlite에 0007을 적용하고 검색 키·가입 판정·이름 관측 날짜를 확인한다. 고정 데이터로 SQL 함수를 재생성해 일치 여부도 확인한다.
- [auth-concurrency.postgres.test.ts](../../src/lib/auth-concurrency.postgres.test.ts): 기존 잠금 회귀에 첫 가입 성공/거절 두 커밋 순서, 검색 실행 계획, Unicode 동등성을 추가했다.
- [0007_review_fixes_indexed_search.sql](../../drizzle/0007_review_fixes_indexed_search.sql), [schema.ts](../../src/db/schema.ts): 가입 판정 테이블, 이름 관측 시각, 정규화 함수·stored 컬럼·검색 인덱스와 기존 데이터 보강.
- [정규화 구현](../../src/lib/search-normalization.ts), [데이터](../../src/lib/search-unicode-data.json), [SQL 생성 도구](../../scripts/search-normalization.mjs): 고정한 Unicode 17 규칙을 사용한다. PostgreSQL 17의 이전 Unicode NFC 테이블과 최신 문자 조합·결합 순서 차이를 보완한다. [데이터 라이선스](../../scripts/UNICODE-LICENSE.txt)를 포함한다.

실제 PostgreSQL 17에서 모임원 **10,000명**, Riot 계정 **10,025개**의 선택적인 이름 및 Riot ID
검색을 `EXPLAIN (ANALYZE, FORMAT JSON)`으로 확인했다. 두 검색 인덱스를 사용했고 members와
riot_accounts의 Seq Scan은 없었다. 이는 해당 fixture와 쿼리의 증거이며 모든 데이터 분포에서
동일한 실행 계획을 보장하는 것은 아니다. 기존 canonical decomposition 13,253개와 신규 문자,
기존/신규 결합 문자 순서도 SQL·JavaScript 간 비교했다.

## 최종 검증

1. 타입 검사와 집중 회귀 통과. Node 24 집중 검사도 4개 파일·115개 테스트 통과.
2. 원래 callback 우회 재현 차단, absent/pending 대안 입력 차단과 새 정상 로그인 확인.
   실제 PostgreSQL에서 두 커밋 순서 및 기존 두 UUID 잠금 순서 모두 통과.
3. Node **24.21.0**, PostgreSQL **17**, Valkey **9**, 실제 로컬 리플레이를 지정한
   `npm run check`: **44개 파일·776개 테스트 통과, skipped 없음**. ESLint·TypeScript·
   Next.js production build·Prettier 모두 통과.
4. `openspec validate --all --strict`: **10개 변경 모두 통과**. `git diff --check` 통과.

최종 전체 검사 명령:

```bash
LLVY_POSTGRES_TEST_URL=postgres://postgres:review-local-only@127.0.0.1:15449/llvy_auth_test \
LLVY_VALKEY_TEST_URL=redis://127.0.0.1:16399 \
LLVY_REPLAY_FILE=/Users/gilsu/Downloads/TalkFile_KR-8390006818.rofl \
npx --yes --package=node@24 -c 'npm run check'

OPENSPEC_TELEMETRY=0 npx openspec validate --all --strict
git diff --check
```

연결값은 이번 검증 전용 로컬 fixture다. 로그는
`/private/tmp/llvy-fix-20261012-node24-check.log`에 남겼다. 컨테이너는 검증 후 제거했다.

## 적용과 검증 범위

새 앱을 배포하기 전에 `npm run db:migrate`로 0007을 적용해야 한다. 기존 계정의 관측 시각은
file_mtime 경기의 최근 한국 일자 00시로 보강하며 원래 파일 수정 시각을 복구하지는 못한다.
generated 컬럼·인덱스 생성 시 테이블 작업 시간은 Preview DB에서 확인한다.

운영 DB migration·배포·push는 수행하지 않았다. Discord·Neon·Layerbase TLS·Vercel Blob·
Cron의 실제 연동과 브라우저 조작은 이번에 검증하지 않았다. 리플레이는 실제 파일을 읽었으나
Blob I/O는 모의 처리하고 저장·조회는 PGlite를 사용했다. 따라서 위 결과는 운영 서비스 검증이 아니다.
