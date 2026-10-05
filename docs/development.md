# 개발·테스트

[프로젝트 README](../README.md) · [문서 목록](README.md)

## 개발 명령

Node.js 24.x에서 `npm ci`로 잠금 파일의 의존성을 설치합니다.
앱 실행에 필요한 환경변수는 [README](../README.md#로컬에서-시작하기)를 참고하세요.

| 명령                       | 용도                                                  |
| -------------------------- | ----------------------------------------------------- |
| `npm run dev`              | 로컬 개발 서버                                        |
| `npm run check`            | 테스트 → ESLint → TypeScript → 빌드 → 포맷 검사       |
| `npm test`                 | 전체 단위·API·DB 통합 테스트                          |
| `npm run test:watch`       | 변경 시 테스트 재실행                                 |
| `npm run test:integration` | 기본 저장·업로드 바인딩·경기 관리 DB 통합 테스트 묶음 |
| `npm run test:replay`      | 지정한 실제 리플레이의 통합 테스트                    |
| `npm run format:write`     | Prettier 포맷 적용                                    |

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

테스트는 [`src/test/database.ts`](../src/test/database.ts)가 메모리에 PGlite를 만들고
`drizzle/`의 실제 SQL 마이그레이션을 적용합니다. 저장·조회, 외래키·고유키,
트랜잭션 롤백, 계정·모임원 연결과 경기 관리, 요청 제한·정리 작업을 검증합니다.
테스트 종료 시 DB를 닫습니다. 인증과 외부 요청은 테스트별로 모의 처리합니다.

`npm ci` 후 `npm run check`는 외부 서비스 자격증명 없이 실행할 수 있습니다.
인증 테스트는 테스트 전용의 업로더·관리자 키와 서버 서명 비밀값을 사용합니다.
실제 서명 세션으로 역할 변조·키 교체·기존 세션 거부를 검증하고, 쿠키를 읽는 실제
관리자 검사로 관리 Action 직접 호출 차단과 두 역할의 업로드 인증·화면 표시를 검증합니다.
DB 쓰기와 외부 요청은 해당 권한 테스트에서 모의 처리합니다.
테스트는 운영 DB나 Blob을 사용하지 않습니다. 다만 PGlite는 단일 연결이므로 실제
다중 연결의 잠금 경합과 네트워크 장애, Vercel Blob 동작은
[별도 배포에서 확인](deployment.md#배포-후-확인)해야 합니다.

## 실제 리플레이 테스트

```bash
LLVY_REPLAY_FILE="/absolute/path/to/match.rofl" npm run test:replay
```

원본 파일은 읽기만 하며 저장소에 복사하지 않습니다. 경로를 지정하지 않으면 실파일
테스트 4개는 건너뜁니다. 전체 검사에 포함하려면 같은 환경변수로 `npm run check`를 실행하세요.

이 테스트는 `/api/process`의 업로드 바인딩 검증부터 실제 파서·PGlite 저장·조회까지
실행합니다. 중복 처리, 바인딩 재사용 거부, 파일·업로드 시각과 사후 모임원 연결을
확인합니다. 세션 인증과 Blob 다운로드·삭제는 모의 처리하므로 브라우저 업로드나
실제 서비스 연결의 검증 결과로 해석하지 마세요.

## 설계 문서

기능 요구사항·설계·작업 내역은 [`openspec/changes/`](../openspec/changes/)에서 관리합니다.
날짜별 검증 결과는 [`docs/validation/`](validation/)에 남깁니다.
기존 설계와 검증 자료의 목록은 [문서 안내](README.md)에 있습니다.
