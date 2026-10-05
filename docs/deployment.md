# 배포·운영

[프로젝트 README](../README.md) · [문서 목록](README.md)

## Vercel에 배포하기

1. 저장소를 Vercel 프로젝트에 연결합니다. 프레임워크는 Next.js,
   설치 명령은 `npm ci`, 빌드 명령은 `npm run build`로 설정합니다.
   [Node.js 버전](https://vercel.com/docs/functions/runtimes/node-js/node-js-versions)은
   로컬과 동일한 24.x를 사용하세요.
2. [Marketplace의 Neon](https://vercel.com/marketplace/neon)으로 데이터베이스를 연결합니다.
   앱은 `@vercel/postgres` 클라이언트를 사용하므로 Neon의 **pooled** 연결 문자열을
   `POSTGRES_URL`에, **direct** 연결 문자열을 `POSTGRES_URL_NON_POOLING`에 설정합니다.
3. [Blob 스토어](https://vercel.com/docs/vercel-blob/using-blob-sdk)를 생성하고 프로젝트에
   연결합니다. 원본 리플레이를 비공개로 보관하려면 **private** 스토어를 선택하고
   `BLOB_ACCESS=private`로 설정합니다. public 스토어를 사용하면 `BLOB_ACCESS=public`으로
   설정하세요. 이 변수는 실제 스토어의 공개 범위를 바꾸지 않습니다.
4. 해당 스토어의 `BLOB_READ_WRITE_TOKEN`을 설정합니다. 현재 앱은 이 read-write 토큰으로
   스토어 소유권을 검증하므로 OIDC 환경변수만으로는 실행할 수 없습니다.
5. 서로 다른 `UPLOAD_PASSWORD`와 `ADMIN_PASSWORD`, 필수 `AUTH_SECRET`, `CRON_SECRET`을
   설정합니다. 키·시크릿은 각각 `openssl rand -base64 32`로 생성할 수 있습니다.
   업로더 키는 업로드·조회 사용자에게, 관리자 키는 운영자에게만 공유하세요.
   `AUTH_SECRET`은 두 로그인 키와 다른 서버 전용 난수이며, 앞뒤 공백 제거 후 UTF-8 기준
   32바이트 이상이어야 합니다. 필수값 누락·키 중복·짧은 서명 비밀값은 로그인을 거부합니다.
   `CRON_SECRET`은 [Vercel 권장 기준](https://vercel.com/docs/cron-jobs/manage-cron-jobs#securing-cron-jobs)에
   따라 16자 이상의 난수를 사용하세요.
6. 아래 순서로 대상 DB에 마이그레이션을 적용한 뒤 앱을 배포합니다.

환경변수의 Preview·Production·Development 대상을 구분하세요. Preview와 로컬 개발에는
운영 데이터와 원본 파일을 공유하지 않는 별도 DB·Blob을 사용하세요.

## 마이그레이션과 업데이트

대상 환경의 연결 문자열을 로컬 `.env.local`에 설정한 다음 실행합니다.

```bash
npm ci
npm run db:migrate
```

`drizzle.config.ts`가 `.env.local`을 읽습니다. 셸에 이미 설정한 환경변수가 파일보다
우선하며, DB 연결은 `POSTGRES_URL_NON_POOLING`이 있으면 해당 값을 먼저 사용합니다.
direct URL을 사용하지 않을 경우 예제의 placeholder를 지우고 `POSTGRES_URL`만 설정하세요.

신규 설치와 업데이트 모두 저장소의 `drizzle/` 마이그레이션을 적용합니다. 현재 이력은
초기 스키마, 업로드 바인딩, 경기 제외·날짜 보정, 공유 요청 제한과 정리 작업 필드를
포함합니다. 적용 내역은 Drizzle이 관리하므로 SQL 파일을 수동으로 골라 실행하지 마세요.

기존 DB는 변경 전에 백업하고, 별도 Preview DB에서 마이그레이션과 앱을 먼저 확인하세요.
새 버전의 앱이 요청을 받기 전에 대상 DB에 필요한 마이그레이션을 적용해야 합니다.
운영 DB의 스키마 변경에는 `db:push` 대신 `db:migrate`를 사용합니다.

## 권한 분리 업데이트와 키 교체

기존 `UPLOAD_PASSWORD`는 업로더 키로 유지할 수 있습니다. 환경별로 별도의 `ADMIN_PASSWORD`와
조건을 충족하는 `AUTH_SECRET`을 먼저 설정하고 새 앱을 배포하세요. 이 권한 분리 변경 자체에는
DB 마이그레이션이 없습니다. 다른 변경의 마이그레이션이 있다면 위 절차대로 적용합니다.
이전 v1/v2 세션은 모두 거부하므로 사용자는 배포 후 다시 로그인하고 업로드를 시작해야 합니다.
기존 업로드 바인딩과 원본은 보존되며 만료 바인딩은 정리 작업이 처리합니다.

- `UPLOAD_PASSWORD` 교체: 업로더의 기존 세션만 만료됩니다.
- `ADMIN_PASSWORD` 교체: 관리자의 기존 세션만 만료됩니다.
- `AUTH_SECRET` 교체: 모든 기존 세션이 만료됩니다.

새 설정으로 배포한 인스턴스부터 위 폐기 규칙이 적용됩니다. 키를 교체한 뒤 각 역할의
이전 세션·새 로그인을 Preview에서 확인하세요. 공유키이므로 한 사용자만 접근 취소하는 기능은 없습니다.
이전 앱으로 롤백하면 모든 로그인 사용자에게 관리 권한이 다시 부여됩니다. 롤백이 필요하면
접근을 운영자에게 제한하고 공유키와 서명 비밀값을 새 값으로 교체하세요.

## 만료 업로드 정리

[`vercel.json`](../vercel.json)은 `/api/maintenance/uploads`를 매일 실행하도록 설정합니다.
엔드포인트는 `Authorization: Bearer <CRON_SECRET>`이 일치할 때만 실행되며, 시크릿이
없거나 다르면 401을 반환합니다. Vercel의 인증 헤더 설정은
[Cron 관리 문서](https://vercel.com/docs/cron-jobs/manage-cron-jobs#securing-cron-jobs)를 참고하세요.

정리 작업은 만료 후 24시간이 지난 바인딩을 한 번에 최대 50개 처리합니다.
게임에 저장된 원본은 보존하고, 게임에서 사용하지 않는 예약 경로의 Blob과 바인딩을
정리합니다. 삭제 실패는 다음 실행에서 다시 시도합니다. 정리 요청의 응답 필드
`examined`, `removed`, `failed`와 함수의 오류 로그를 확인하세요.

로컬 서버에서 정리 작업을 확인하려면 별도로 인증된 요청을 보내야 합니다. 로컬의
`npm run dev`는 정리 작업을 자동으로 예약 실행하지 않습니다.

## 배포 후 확인

별도 Preview DB·Blob에서 다음을 확인한 뒤 운영에 반영하세요.

1. 미인증 페이지는 로그인으로 이동하고 API는 401을 반환합니다. 업로더와 관리자 키 각각으로
   로그인하여 업로드·경기·통계·등록된 모임원 조회가 가능한지 확인합니다.
2. 실제 `.rofl` 업로드 후 경기 상세에 참가자와 전적이 표시됩니다.
   DB의 업로드 바인딩은 `processed`로 끝납니다.
3. 같은 파일을 다시 업로드하면 기존 경기로 안내합니다. 새로 업로드한 중복 Blob은
   삭제되고 기존 경기의 원본은 보존됩니다.
4. 손상된 `.rofl`은 422로 거부됩니다. 해당 Blob은 삭제되고 게임·참가자 행은 남지 않습니다.
   소비된 업로드 바인딩을 다시 처리하면 409로 거부됩니다.
5. 관리자로 모임원 생성·수정과 계정 연결·해제, 과거 전적 반영, 경기 날짜 수정·복원과 제외·복구를
   확인합니다. 업로더에게 관리 메뉴·변경 폼이 없고 `/admin`은 `/members`로 이동하는지,
   관리 변경 요청을 직접 보내도 거부하는지 확인합니다.
6. private 원본의 URL을 비인증 상태에서 직접 열면 파일을 읽을 수 없습니다.
   정리 엔드포인트도 인증 없이 실행되지 않는지 확인합니다.
7. 각 역할의 키를 교체하면 해당 역할의 이전 세션만 거부하는지, `AUTH_SECRET` 교체 시
   양쪽 이전 세션을 거부하는지 확인합니다.

파일 처리 요청에는 서버 다운로드 시간 제한과 클라이언트의 70초 대기 제한이 있습니다.
함수 강제 종료나 DB 연결 오류로 저장 결과가 불확실하면, 게임 저장 여부를 확인한 뒤
처리하세요. 이 경우 원본 Blob은 보존될 수 있습니다.

## 다른 환경에서 실행할 때

현재 운영 로그인은 `VERCEL=1`과 유효한 `x-vercel-forwarded-for` IP를 요구합니다.
조건을 만족하지 않으면 로그인을 거부하므로, 로컬의 `npm run build`·`npm run start`도
빌드 검증은 가능하지만 기본 설정으로 새 로그인은 할 수 없습니다.

다른 호스팅을 지원하려면 [`trusted-client-ip.ts`](../src/lib/trusted-client-ip.ts)의
신뢰할 수 있는 IP 판별을 해당 환경의 프록시에 맞게 구현해야 합니다. Vercel의 헤더는
[요청 헤더 문서](https://vercel.com/docs/headers/request-headers#x-vercel-forwarded-for)를 참고하세요.
환경변수와 헤더를 임의로 흉내 내는 방식은 신뢰 경계를 만들지 못합니다.

DB 어댑터는 [`src/db/index.ts`](../src/db/index.ts)의 `@vercel/postgres`입니다.
일반 TCP Postgres나 Docker DB로 바꾸려면 연결 드라이버와 Drizzle 어댑터의 호환성을
검토해야 합니다. Blob 교체와 정리 작업의 스케줄러도 별도로 구현해야 합니다.
현재 저장소에는 외부 서비스 없는 전체 앱 실행 구성이 없습니다.
