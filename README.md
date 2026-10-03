# LLVY

리그 오브 레전드 소모임의 **내전 전적**을 모으는 웹 서비스. League 클라이언트가 저장하는
`.rofl` 리플레이 파일을 업로드하면 게임 정보와 참가자 전적을 추출해 Postgres에 보관합니다.
Riot API를 사용하지 않고 `.rofl` 메타데이터를 직접 파싱합니다.

## 기술 스택

- **Next.js (App Router) + TypeScript** — Vercel 배포
- **Postgres (Neon / 기존 Vercel Postgres)** + **Drizzle ORM** (`drizzle-kit` 마이그레이션)
- **Vercel Blob** — 큰 `.rofl`(10~30MB)을 4.5MB 함수 본문 제한 없이 클라이언트가 직접 업로드
- **Vitest + PGlite** — 파서·인증·API 회귀 테스트와 PostgreSQL 엔진 기반 통합 테스트

## 완성 상태

리플레이 파싱·저장·조회, 모임원 생성·수정·계정 연결과 페이지별 전적 조회를 구현했습니다.
로컬 통합 테스트는 실제 SQL 마이그레이션, 중복 저장 방지, 트랜잭션 롤백, 과거 게임의
모임원 연결을 검증합니다. 외부 서비스 자격증명 없이 `npm ci && npm run check`로 실행됩니다.

### 경기 관리와 모임원 전적

- `/games`에서 기본 경기 목록과 **제외된 경기** 목록을 전환합니다. 경기 상세에서 제외·복구할 수
  있으며, 제외해도 원본 파일과 참가자는 보존됩니다. 같은 파일을 다시 올려도 중복 생성하거나 자동 복구하지 않습니다.
- 경기 상세에서 **한국 시간(UTC+09:00)** 기준으로 경기 날짜를 수정합니다. 원래 파일/업로드 시각과
  출처를 보존하며, **원본 날짜로 되돌리기**가 가능합니다. 목록에는 추정 날짜인지 직접 수정한 날짜인지 표시합니다.
- `/members`에서 모임원을 선택하면 연결된 부계정까지 합친 경기 수·승패·승률·평균 K/D/A와
  25건 단위 전적을 확인합니다. 관리 화면과 경기 상세의 모임원 이름에서도 이동할 수 있습니다.
- 제외된 경기는 모임원 전적에서 빠집니다. 승률은 승패가 결정된 경기만, 평균은 해당 값이 있는
  경기만 계산합니다. 같은 경기에 한 모임원의 계정이 여러 개 연결되면 한 경기로 세고
  **계정 중복 연결 확인**을 표시하며 승패·평균 계산에서 제외합니다. 연결을 바로잡으면 즉시 재집계됩니다.

추가 마이그레이션은 `games.excluded_at`과 `games.played_at_override`를 추가합니다.
기존 기록은 활성 상태와 원래 날짜를 유지합니다. 새 앱 배포 전에 `npm run db:migrate`를 적용하세요.

앱은 [llvy.vercel.app](https://llvy.vercel.app)에 배포했고 로그인 화면 응답을 확인했습니다.
**서비스 전체 검증은 아직 끝나지 않았습니다.** Neon·Blob 연결, 공유 비밀번호 설정,
운영 DB 마이그레이션과 실제 업로드 검증이 남아 있습니다. 실제 솔랭 `.rofl` 샘플은 확보했으며,
30MB 브라우저 직접 업로드와 배포 환경의 전체 흐름은 아래 절차로 확인해야 합니다.
현재 증거는 [운영 배포 확인 기록](docs/validation/2026-10-04-production-deployment.md),
남은 항목은 OpenSpec `replay-ingestion-mvp/tasks.md`에서 관리합니다.

## 환경 변수

`.env.example`를 복사해 `.env.local`을 만들고 값을 채웁니다.

| 변수                    | 필수 | 설명                                                                                                                                                             |
| ----------------------- | ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `UPLOAD_PASSWORD`       | ✅   | 업로드·조회·관리 접근을 막는 공유 비밀번호. 충분히 긴 값을 쓰세요.                                                                                               |
| `POSTGRES_URL`          | ✅   | Neon의 pooled Postgres 연결 문자열(기존 Vercel Postgres 호환).                                                                                                   |
| `BLOB_READ_WRITE_TOKEN` | ✅   | Vercel Blob 읽기/쓰기 토큰.                                                                                                                                      |
| `AUTH_SECRET`           | 권장 | 세션 쿠키 서명용 고엔트로피 시크릿. 설정 시 로그인 비밀번호와 서명 키가 분리됩니다(미설정 시 `UPLOAD_PASSWORD`에서 HKDF 파생). `openssl rand -base64 32`로 생성. |
| `POSTGRES_*` (그 외)    | —    | Vercel이 함께 주입하는 값들(선택).                                                                                                                               |

`drizzle.config.ts`가 `@next/env`로 `.env.local`을 자동으로 읽습니다. 셸 환경에 설정한
값이 파일보다 우선합니다. 마이그레이션에는 `POSTGRES_URL_NON_POOLING`이 있으면 우선
사용하고, 없으면 `POSTGRES_URL`을 사용합니다. 연결 문자열이나 토큰을 커밋하지 마세요.

## 로컬 개발

```bash
npm ci
cp .env.example .env.local      # 값 채우기

# 스키마를 DB에 반영 (둘 중 하나)
npm run db:push                 # 빠른 동기화 (개발용)
npm run db:migrate              # drizzle/ 의 마이그레이션 적용

npm run dev                     # http://localhost:3000
```

첫 화면에서 `UPLOAD_PASSWORD`를 입력하면 업로드/게임/관리 화면에 접근할 수 있습니다.

## 데이터베이스

스키마 정의: [`src/db/schema.ts`](src/db/schema.ts) — `members`, `riot_accounts`, `games`,
`game_participants`, `pending_uploads`(업로드 바인딩, 아래 보안 섹션 참고).

```bash
npm run db:generate   # 스키마 변경 후 SQL 마이그레이션 생성 (DB 불필요)
npm run db:migrate    # 생성된 마이그레이션 적용 (POSTGRES_URL 필요)
npm run db:push       # 스키마를 DB에 직접 동기화 (POSTGRES_URL 필요)
npm run db:studio     # Drizzle Studio
```

계정은 PUUID를 우선 사용하고, 없는 리플레이는 Riot ID(이름·태그)로 식별합니다.
처음 보는 계정은 **미연결(member 없음)** 로 저장됩니다. 동일 Riot ID의 구버전 계정이
하나뿐이면 PUUID를 추가해 계정·모임원 연결을 유지하며, 여러 신원이 같은 이름을 쓰는
모호한 경우 자동 병합하지 않습니다. `/admin`에서 모임원을 생성·수정하고 계정을 연결하면
과거 게임에도 즉시 반영됩니다(재수집 불필요).

## 테스트

```bash
npm run check      # 테스트 → lint → TypeScript → 빌드 → 포맷 검사
npm test           # 단위/API/DB 통합 테스트 전체
npm run test:integration # 로컬 PostgreSQL 엔진 기반 DB 통합 테스트만
npm run test:watch
```

실제 파일을 검증하려면 원본 경로를 지정합니다. 파일은 읽기만 하며 저장소에 복사하지 않습니다.

```bash
LLVY_REPLAY_FILE="/absolute/path/to/match.rofl" npm run test:replay
```

이 테스트는 `/api/process`의 업로드 바인딩부터 실제 파서·PGlite 저장·조회까지 실행하고,
중복 처리, 바인딩 재사용 거부, 파일 시각/업로드 시각과 사후 모임원 연결을 확인합니다.
세션 인증과 Blob 다운로드·삭제는 모의 처리하므로 브라우저 업로드나 외부 서비스 연결 검증은
아닙니다. 경로를 지정하지 않으면 실파일 테스트 4개는 건너뜁니다.
실제 솔랭 파일의 검증 결과는 [2026-10-03 실파일 검증 기록](docs/validation/2026-10-03-real-replay.md)을 참고하세요.
경기 관리·모임원 전적의 통합 테스트와 브라우저 검증 결과는
[2026-10-04 MVP 추가 기능 검증 기록](docs/validation/2026-10-04-mvp-features.md)에 정리했습니다.

Codex Security 스캔 발견사항 3건(포워디드 헤더 회전, same-store Blob URL 삭제, 초대형
`statsJson`)은 각각 회귀 테스트로 고정되어 있습니다 — `src/lib/login.test.ts`,
`src/lib/pending-upload.test.ts`, `src/lib/rofl/parser.test.ts`.

DB 테스트는 [`src/test/database.ts`](src/test/database.ts)가 메모리에 PGlite를 만들고
`drizzle/`의 실제 SQL 마이그레이션을 적용합니다. 게임·참가자 SQL, 외래키·고유키,
중간 저장 실패 시 롤백, 계정 이름 변경, 모임원 수정·연결·해제와 업로드 바인딩을 검증합니다.
테스트 종료 시 DB를 닫으며 운영 DB나 Blob에는 접근하지 않습니다. PGlite는 단일 연결이므로
실제 다중 연결의 잠금 경합, 네트워크 장애, Vercel Blob 동작은 스테이징 검증이 필요합니다.

## 업로드 처리와 보안

업로드 파이프라인은 **pending upload 바인딩**으로 보호됩니다
([`src/lib/pending-upload.ts`](src/lib/pending-upload.ts), `pending_uploads` 테이블):

1. 클라이언트가 `POST /api/uploads`로 업로드를 시작하면 서버가 추측 불가능한
   `{ uploadId, nonce }`(nonce는 해시로만 저장)와 예약된 Blob 경로
   `replays/<uploadId>.rofl`을 발급합니다.
2. `/api/blob/upload`는 유효한 바인딩이 제시된 경우에만, **정확히 그 경로**에 대한
   업로드 토큰을 발급합니다 (랜덤 접미사 없음, 덮어쓰기 금지, 바인딩과 동일한 만료 시각).
3. `/api/process`는 Blob URL이 현재 `BLOB_READ_WRITE_TOKEN`의 public 스토어와
   활성 바인딩의 경로에 정확히 일치할 때만 파일을 가져오고,
   중복/오류 정리 시에도 **그 바인딩에 묶인 Blob만** 삭제합니다. 임의의 same-store
   URL(예: 기존 게임의 원본 리플레이)을 넘겨도 fetch/삭제 전에 거부됩니다.
   다른 Blob 스토어의 동일 경로도 거부하며, query/fragment는 제거한 URL로
   다운로드·저장·삭제합니다. 다운로드 리다이렉트는 허용하지 않습니다.
4. 저장 성공 후 바인딩 상태 기록이 실패해도 원본 Blob을 보존합니다. 상태 기록은
   한 번 재시도하고, 계속 실패하면 로그를 남기며 바인딩은 `processing` 상태로 소비됩니다.
   DB 커밋 결과가 불확실한 오류에서도 파일을 보존합니다. 해당 파일은 게임 저장 여부를
   확인한 후 정리해야 합니다.
5. 바인딩은 한 번 처리되면(성공·중복·실패 모두) 소비되어 재사용할 수 없고,
   30분(`PENDING_UPLOAD_TTL_MS`) 후 만료됩니다. 만료된 행은 새 업로드 시작 시
   자동으로 정리됩니다.

리플레이 파싱/저장에는 파일 크기 제한과 별개로 **의미론적 예산**이 적용됩니다
([`src/lib/limits.ts`](src/lib/limits.ts)의 `REPLAY_INGEST_LIMITS`):

| 예산                  | 기본값 | 초과 시                     |
| --------------------- | ------ | --------------------------- |
| 참가자 수             | 10명   | "지원 불가" 파싱 오류 (422) |
| 메타데이터 크기       | 4MB    | 〃                          |
| `statsJson` 크기      | 256KB  | 〃 (JSON.parse 이전에 거부) |
| 참가자 객체 크기      | 32KB   | 〃                          |
| 참가자 객체 중첩 깊이 | 4      | 〃                          |

예산 검증은 파서에서 1차, [`ingestReplay()`](src/lib/ingest.ts)의 **트랜잭션 시작 전**에
2차로 수행되어, 예산 초과 리플레이는 어떤 DB 쓰기도 발생시키지 않습니다. 참가자
`raw_stats`와 게임 `raw_metadata`는 임의 JSON이 아니라 **스칼라 allowlist**로 축소해
저장합니다(알 수 없는 키·중첩 값·과대 문자열은 저장 전 제거).

로그인은 비밀번호 검증 **이전에** 이중 버킷 스로틀을 통과해야 합니다
(`LOGIN_THROTTLE_LIMITS`): 전역 분당 30회 + 클라이언트 힌트당 분당 10회.
`x-forwarded-for`는 힌트로만 쓰이므로 헤더를 회전해도 전역 버킷을 우회할 수 없습니다.
전역 제한에 걸린 요청은 새 클라이언트 버킷을 만들지 않습니다. 만료 버킷은 새 버킷
생성 시 정리하며, 저장소는 최대 1,024개로 제한하고 활성 카운터는 임의로 버리지 않습니다.

동시 수집 시 계정 갱신 순서를 신원 기준으로 고정합니다. PostgreSQL이 교착 상태 또는
직렬화 실패(`40P01`/`40001`)로 롤백한 트랜잭션만 최대 3회 실행하며, 커밋 결과를
알 수 없는 연결 오류는 자동 재시도하지 않습니다. 잘못된 참가자 필드 타입은 파싱 오류
(422)로 거부하고 해당 업로드 Blob을 정리합니다.

경기 상세의 DataDragon 챔피언 이름 조회는 응답 본문을 포함한 전체 조회를 2초로
제한합니다. 실패하거나 시간이 초과되면 리플레이의 내부 이름을 그대로 표시합니다.

## 배포 (Vercel)

신규 Vercel Postgres 생성은 제공되지 않으며, 현재는 Marketplace에서 Postgres 서비스를
연결합니다([Vercel 공식 문서](https://vercel.com/docs/postgres)). 이 앱의 기존
`@vercel/postgres` 클라이언트에는 Neon 연결을 사용합니다.

1. 저장소를 연결해 Vercel 프로젝트를 만들고 빌드 명령을 `npm run build`로 설정합니다.
2. Marketplace에서 **Neon**을 연결하고, **Blob** public 스토어를 연결합니다.
   Neon pooled 연결 문자열을 `POSTGRES_URL`, direct 연결 문자열을
   `POSTGRES_URL_NON_POOLING`으로 설정합니다. `BLOB_READ_WRITE_TOKEN`,
   `UPLOAD_PASSWORD`, `AUTH_SECRET`도 설정하며 Preview/Production 대상을 구분합니다.
3. 먼저 별도 Preview DB에 `npm run db:migrate`를 적용하고 아래 스모크 테스트를 진행합니다.
4. 프로덕션 연결을 설정한 뒤 `npm run db:migrate`로 스키마를 적용합니다.
   `pending_uploads` 테이블을 만드는 `drizzle/0001_*.sql`과 경기 제외·날짜 보정 컬럼을
   추가하는 `drizzle/0002_match_management.sql`을 포함합니다. 새 앱 실행 전에 모두 적용합니다.
5. 배포 후 실제 `.rofl`을 업로드해 업로드 → 파싱 → 저장 → 조회를 확인합니다.

### 스테이징 검증 절차 (보안 하드닝)

Blob 삭제/readback과 Postgres 롤백은 로컬에서 완전히 재현되지 않으므로, 일회용
리소스(프리뷰 배포 + 별도 Blob 스토어/Postgres 브랜치)에서 아래를 확인한 뒤
프로덕션에 반영합니다:

1. **마이그레이션**: `npm run db:migrate` 후 `pending_uploads` 테이블 생성 확인.
2. **정상 경로**: `.rofl` 업로드 → 게임 상세 표시, `pending_uploads.state`가
   `processed`로 종결되는지 확인.
3. **중복 정리**: 같은 파일을 다시 업로드 → "이미 저장된 리플레이" 응답 후 Blob
   대시보드에서 **새 blob은 삭제**되고 **기존 게임의 blob은 그대로**인지 readback.
4. **파싱 실패 롤백**: 손상된 파일(예: 텍스트 파일을 `.rofl`로 개명) 업로드 → 422
   응답, 해당 blob 삭제, `games`/`game_participants`에 행이 남지 않는지 확인.
5. **바인딩 재사용 거부**: 같은 `{uploadId, nonce}`로 `/api/process`를 다시 호출
   (개발자 도구에서 요청 재전송) → 409 응답, blob 재삭제/재처리 없음.
6. **타임아웃 동작**: Blob 다운로드가 지연되면 서버의 다운로드 시간 제한으로 실패하고,
   클라이언트는 전체 처리 요청에 70초 가드를 적용합니다. 함수가 강제 종료되면 상태 갱신은
   보장되지 않으므로 `processing`에 남은 바인딩과 게임 저장 여부를 확인합니다.
7. **관리·조회**: 모임원을 생성·수정하고 계정 연결/해제 후 과거 게임에 반영되는지 확인합니다.
   전적이 25건을 넘으면 다음 페이지에서 나머지 게임에 접근합니다.

## 메모

- `.rofl` 파일에는 **게임 날짜가 없습니다.** 업로드 파일의 `lastModified`(저장 시각 근사치)를
  쓰고, 없으면 업로드 시각으로 폴백하며 출처를 `games.played_at_source`에 기록합니다.
- 포지션은 리플레이 메타데이터의 역할 값을 표시하며, 역할 값이 없거나 알 수 없으면
  "불명"으로 표시합니다. 실제 내전·오프롤 조합에서의 포지션 정확도는 아직 검증하지 않았습니다.
- 패치 13.20(2023-10) 무렵 일부 구버전 리플레이는 참가자 통계가 비어 있어 "지원 불가"로
  거부됩니다. 제공된 패치 `16.19.821.7343`의 솔랭 샘플 1개는 정상 처리했으며,
  다른 패치와 사용자설정 게임의 호환성은 별도 검증이 필요합니다.
- 업로드된 .rofl은 Vercel Blob에 **public**(URL을 아는 사람은 접근 가능)으로,
  추측 불가능한 UUID가 포함된 경로 `replays/<uploadId>.rofl`에 저장됩니다. 다른
  게임의 blob URL은 화면에 노출되지 않습니다. 완전 비공개가 필요하면 인증된
  스트리밍 라우트로 다운로드를 제공하도록 바꿔야 합니다.
- 로그인 스로틀(전역 + 클라이언트 힌트별)과 실패 지연은 **서버리스 인스턴스별
  인메모리 상태**입니다. 인스턴스가 여러 개면 그 수만큼 예산이 늘어나므로, 운영
  강화 시 같은 키 구조 그대로 Vercel KV/Upstash 등 공유 스토어로 교체하세요
  ([`src/lib/rate-limit.ts`](src/lib/rate-limit.ts)).
- `UPLOAD_PASSWORD` 또는 `AUTH_SECRET` 교체 시 기존 세션은 무효화됩니다. 이번 세션 키
  파생 방식 보완이 처음 배포될 때도 기존 사용자는 한 번 다시 로그인해야 합니다.
- 보안 한도·예산 값은 전부 [`src/lib/limits.ts`](src/lib/limits.ts)에 모여 있고,
  각 검증 함수는 테스트에서 작은 값을 주입할 수 있게 파라미터로 받습니다.

설계 배경은 [`openspec/changes/replay-ingestion-mvp/`](openspec/changes/replay-ingestion-mvp/)의
proposal / design / specs 문서를, 보안 하드닝(업로드 바인딩·스로틀·파싱 예산)의 배경은
[`openspec/changes/harden-security-scan-findings/`](openspec/changes/harden-security-scan-findings/)를
참고하세요.
