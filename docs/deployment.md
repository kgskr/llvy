# Vercel 첫 배포

[프로젝트 README](../README.md) · [문서 목록](README.md)

새 Vercel 프로젝트와 빈 데이터베이스를 기준으로 설명합니다.
PostgreSQL, Vercel Blob, Discord 애플리케이션과 서버에 설치한 봇이 필요합니다.
Redis 캐시는 선택 사항입니다.

## 1. Vercel 프로젝트 만들기

Vercel에서 **Add New → Project**로 저장소를 연결하고 다음과 같이 설정합니다.

| 항목             | 값              |
| ---------------- | --------------- |
| Framework Preset | Next.js         |
| Root Directory   | 저장소 루트     |
| Install Command  | `npm ci`        |
| Build Command    | `npm run build` |
| Node.js Version  | `24.x`          |

프로젝트의 운영 도메인을 확인합니다. 기본 `*.vercel.app` 주소나 연결한 커스텀 도메인을
사용할 수 있습니다. 이 주소는 Discord 로그인 콜백 설정에도 사용합니다.
서비스 연결과 아래 설정을 마친 뒤 다시 배포합니다.

## 2. 데이터베이스와 파일 저장소 준비

### PostgreSQL

빈 PostgreSQL 데이터베이스를 만들고 연결 문자열을 준비합니다.
[Neon](https://vercel.com/marketplace/neon)은 Vercel Marketplace에서 연결할 수 있는 제공자 중 하나입니다.
Neon을 사용한다면 pooled 연결 문자열을 `POSTGRES_URL`에, direct 연결 문자열을
`POSTGRES_URL_NON_POOLING`에 사용합니다.

현재 [DB 연결 코드](../src/db/index.ts)는 Neon 기반의 `@vercel/postgres`를 사용합니다.
다른 PostgreSQL 제공자를 사용하려면 해당 제공자에 맞는 드라이버와 Drizzle 어댑터로
변경해야 합니다. 연결 문자열만 바꾸면 모든 PostgreSQL 서비스에 접속되는 구성은 아닙니다.

### Vercel Blob

프로젝트의 Storage에서 [Blob 스토어](https://vercel.com/docs/vercel-blob/using-blob-sdk)를
만들어 연결합니다. 리플레이를 비공개로 보관하려면 **private**을 선택하고
`BLOB_ACCESS=private`로 설정합니다. 연결된 스토어의 `BLOB_READ_WRITE_TOKEN`도 필요합니다.

public 스토어를 선택했다면 `BLOB_ACCESS=public`으로 맞춥니다.
이 환경변수는 스토어 자체의 공개 범위를 바꾸지 않습니다.

### 리전과 선택 사항

데이터베이스와 Vercel 함수는 가능한 한 가까운 리전에 배치하세요.
[`vercel.json`](../vercel.json)의 `regions`에는 현재 `sin1`이 들어 있으므로,
사용할 데이터베이스 위치에 맞는 [Vercel 리전 코드](https://vercel.com/docs/functions/configuring-functions/region)로
변경합니다. 특정 리전을 사용해야 하는 것은 아닙니다.

Redis 캐시는 선택 사항입니다. 사용할 기능과 Upstash 연결 방법은 [Redis 안내](redis.md)를 참고하세요.

## 3. Discord와 환경변수 설정

[Discord 안내](discord-auth.md)에 따라 애플리케이션·봇·운영 도메인의 콜백을 준비합니다.

Vercel 프로젝트의 **Settings → Environment Variables**에서 **Production**을 대상으로
Discord 안내에서 준비한 환경변수와 다음 값을 설정합니다.
서비스 연결로 자동 생성된 값도 이름과 대상 환경을 확인하세요.

| 환경변수                | 값                                    |
| ----------------------- | ------------------------------------- |
| `POSTGRES_URL`          | 앱에서 사용할 PostgreSQL 연결 문자열  |
| `BLOB_READ_WRITE_TOKEN` | 연결한 Blob 스토어의 read-write 토큰  |
| `BLOB_ACCESS`           | 스토어에 맞춰 `private` 또는 `public` |
| `AUTH_SECRET`           | 세션 서명용 난수                      |
| `CRON_SECRET`           | 예약 작업 인증용 난수                 |

`AUTH_SECRET`과 `CRON_SECRET`은 아래 명령을 각각 실행해 서로 다른 값으로 생성합니다.

```bash
openssl rand -base64 32
```

이 값들은 서버 전용입니다. `NEXT_PUBLIC_` 접두사를 붙이거나 Git에 올리지 마세요.
Preview 배포도 사용할 경우 별도 DB·Blob과 해당 도메인의 Discord 콜백을 설정합니다.

## 4. 데이터베이스 초기화

로컬에 Node.js 24.x를 준비하고 저장소 루트에서 `npm ci`를 실행합니다.
`.env.local`이 없다면 [`.env.example`](../.env.example)을 복사한 뒤,
앞에서 만든 DB의 `POSTGRES_URL`과 `POSTGRES_URL_NON_POOLING`을 입력합니다.
별도 direct URL을 사용하지 않으면 `POSTGRES_URL_NON_POOLING`은 비워 둡니다.

```bash
npm run db:migrate
```

이 명령이 저장소의 스키마 이력을 적용해 필요한 테이블과 인덱스를 만듭니다.
[`drizzle.config.ts`](../drizzle.config.ts)는 `.env.local`을 읽고,
`POSTGRES_URL_NON_POOLING`이 있으면 우선 사용합니다. 셸에 같은 환경변수가 설정되어
있으면 파일보다 우선하므로, 실행 전 대상이 새로 만든 DB인지 확인하세요.

## 5. 배포

리전을 변경했다면 저장소에 반영하고, Vercel의 **Deployments**에서 해당 커밋을 배포합니다.
환경변수만 설정했다면 **Redeploy**로 다시 배포합니다. 배포가 **Ready** 상태가 되면
운영 도메인으로 접속합니다.

## 배포 후 확인

1. 지정한 Discord 서버의 멤버 계정으로 로그인합니다. 가입 심사가 있다면 완료한 계정을 사용하세요.
2. `DISCORD_OWNER_USER_ID`로 지정한 계정에서 **관리 → 사용자 권한**이 보이는지 확인합니다.
   다른 관리자가 필요하면 해당 사용자가 한 번 로그인한 뒤 지정합니다.
3. 업로더·관리자·오너 계정으로 `.rofl` 파일을 업로드하고 경기 목록·상세에 표시되는지 확인합니다.
4. **관리**에서 모임원을 만들고 Riot 계정을 연결한 뒤, 검색과 모임원 전적을 확인합니다.
5. Vercel의 **Settings → Cron Jobs**에서 아래 예약 작업이 등록되어 있는지 확인합니다.

### Web Analytics

앱은 `@vercel/analytics/next`를 루트 레이아웃에 연결해 로그인 페이지와 로그인 후
화면의 기본 페이지 조회를 수집합니다. 별도 API 키나 환경변수를 추가할 필요는 없습니다.

1. Vercel 프로젝트의 **Analytics**에서 Web Analytics를 활성화합니다.
2. 패키지와 레이아웃 변경이 포함된 코드를 배포합니다. 대시보드 활성화만으로 기존 배포에
   SDK가 추가되지는 않습니다.
3. 운영 사이트의 로그인 페이지와 로그인 후 화면을 방문합니다. 브라우저 Network에서
   Analytics 스크립트와 페이지 조회 요청이 성공하는지 확인합니다. 기본 경로는
   `/_vercel/insights/script.js`, `/_vercel/insights/view`이며 Vercel 설정에 따라 별도 수집
   경로를 사용할 수도 있습니다.
4. Vercel의 **Analytics**에서 페이지 조회가 표시되는지 확인합니다.

로컬 개발은 SDK 기본 개발 모드를 사용합니다. 로컬 테스트·빌드 통과는 운영 수집 완료를
뜻하지 않으므로 배포 후 위 확인을 별도로 수행하세요. 설치와 수집 확인에 관한 자세한 내용은
[Vercel Web Analytics 안내](https://vercel.com/docs/analytics/quickstart)를 참고하세요.

### 예약 작업

[`vercel.json`](../vercel.json)에 두 작업이 하루 한 번 실행되도록 설정되어 있습니다.

- `/api/maintenance/uploads`: 만료된 업로드 예약과 사용하지 않는 파일 정리
- `/api/maintenance/auth`: Discord 서버 가입 상태 확인과 만료된 인증 데이터 정리

Production 배포에서 실행되며, Vercel이 `CRON_SECRET`을 인증 헤더에 자동으로 담아 보냅니다.
설정 방법은 [Vercel Cron 안내](https://vercel.com/docs/cron-jobs/manage-cron-jobs#securing-cron-jobs)를
참고하세요. 첫 실행 후 Cron 로그에서 처리 결과를 확인합니다.

## 데스크톱 업로더 활성화

`DESKTOP_UPLOADER_ENABLED`는 미지정/false가 기본이다. true일 때만 새 기기 발급·갱신·업로드를 허용한다. 기존 웹 업로드와 기기 해제·maintenance는 별개다. schema-first 적용과 실제 연동 검사 후 활성화한다. [배포 순서 및 owner 변경 회수 절차](desktop-uploader.md#배포-순서와-운영-회수)를 따른다.

전체 기기의 영구 회수에는 [운영 CLI](desktop-uploader.md#전체-기기-회수-명령)를 사용한다. 기본 `npm run desktop:revoke-all`은 무접속 계획 출력이다. 모든 serving version 차단과 발급 drain을 실제로 확인한 뒤에만 명시적 대상 DB와 `--apply`로 실행한다. `.env*`는 자동으로 로드하지 않는다.

## 업로더 역할 적용

2026-10-23 운영 DB에 `0008`~`0010` migration을 적용했다. 백업·검증 범위와 코드 배포 상태는 [운영 검증 기록](validation/2026-10-23-uploader-deployment.md)을 따른다.

`0010_uploader_role.sql`은 `0009_desktop_uploader.sql` 다음에 적용하는 additive migration이다. `npm run db:migrate`로 journal에 따라 한 번 적용하며 SQL 파일을 수동 반복 실행하지 않는다. 기존 계정·admin grant·세션·감사 행의 역할을 변경하지 않고 nullable uploader snapshot, 예약 감사 복구용 `audit_metadata`와 새 grant table을 추가한다. 새 코드가 이 스키마를 읽으므로 schema-first 순서를 지킨다.

1. 호환 계약 원본 commit과 앱 사본/hash 및 검사를 확정한다. 현재 계약은 로컬 `fe32e8a93a426b0446338d24c201c5b778dab682`로 고정했으며 원격 공개와 호환 배포는 남아 있다.
2. 기존 코드 상태에서 DB backup·migration 적용을 검증한다. 새 스키마를 남겨도 기존 admin/owner 행의 의미는 유지된다.
3. 모든 serving 서버를 새 코드로 전환하고 구버전 요청을 drain한다. viewer 생년 projection cache 버전도 새 namespace를 사용한다.
4. 호환 Windows 앱과 네 역할의 웹·Discord·Blob 동작을 확인한 뒤 업로더 grant를 부여한다. desktop 기본 false 정책은 유지한다.

구코드 rollback 전에 업로더 grant를 새 서비스로 회수하고 웹/desktop 세션·미완료 승인을 무효화한다. 모든 serving version에서 새 업로드를 차단하고 진행 중 처리를 drain한 뒤 돌아간다. 이미 발급한 Blob PUT 권한은 만료 전까지 바이트 전송이 가능할 수 있으나 새 승인·최종 DB 저장은 회수된 권한으로 허용되지 않는다. 새 컬럼·grant·감사는 삭제하거나 admin grant로 변환하지 않는다. 기존 생년 포함 캐시를 구코드가 읽지 않는지도 확인한다. 실제 운영 rollback 수행은 [검증 기록](validation/2026-10-19-uploader-role.md)의 미완료 항목이다.
