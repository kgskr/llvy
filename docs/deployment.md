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
5. [Discord 운영](discord-auth.md)의 Portal callback·identify OAuth·최소 권한 봇 설치를
   완료하고 `DISCORD_CLIENT_ID/SECRET`, `DISCORD_REDIRECT_URI`, `DISCORD_BOT_TOKEN`,
   `DISCORD_GUILD_ID`, `DISCORD_OWNER_USER_ID`를 서버 환경변수로 설정합니다.
   독립 `AUTH_SECRET`은 `openssl rand -base64 32`로 생성하고 `CRON_SECRET`도 별도 난수로
   설정합니다. 비밀값을 사용자에게 공유하거나 `NEXT_PUBLIC_*`로 설정하지 않습니다.
6. 아래 순서로 대상 DB에 마이그레이션을 적용한 뒤 앱을 배포합니다.

환경변수의 Preview·Production·Development 대상을 구분하세요. Preview와 로컬 개발에는
운영 데이터와 원본 파일을 공유하지 않는 별도 DB·Blob을 사용하세요.

## 마이그레이션과 업데이트

Layerbase Valkey 9를 연결했다면 Vercel의 `VALKEY_URL`에 생성된 TLS 주소가 주입되는지 확인하고
재배포하세요. 포트 6379의 연결을 사용하며 별도 DB 마이그레이션은 없습니다.
환경별 캐시 분리, 장애 동작과 실제 확인 절차는 [Valkey 안내](valkey.md)에 있습니다.
자동완성 인덱스는 배포 때 구성하지 않고 첫 유효한 요청에서 구성하므로 별도 색인 명령은 없습니다.
캐시가 없어도 DB로 검색하며 제출 시 계정 연결은 현재 DB에서 확인합니다.

대상 환경의 연결 문자열을 로컬 `.env.local`에 설정한 다음 실행합니다.

```bash
npm ci
npm run db:migrate
```

`drizzle.config.ts`가 `.env.local`을 읽습니다. 셸에 이미 설정한 환경변수가 파일보다
우선하며, DB 연결은 `POSTGRES_URL_NON_POOLING`이 있으면 해당 값을 먼저 사용합니다.
direct URL을 사용하지 않을 경우 예제의 placeholder를 지우고 `POSTGRES_URL`만 설정하세요.

신규 설치와 업데이트 모두 저장소의 `drizzle/` 마이그레이션을 적용합니다. 현재 이력은
초기 스키마, 업로드 바인딩, 경기 제외·날짜 보정, 공유 요청 제한과 정리 작업 필드, 관리자 자격증명·감사로그와 업로드 실행자 필드를
포함합니다. `0006`은 Discord 인증 테이블·가입 확인 sequence와 credential retire를,
`0007_review_fixes_indexed_search.sql`은 등록 전 가입 판정 버전, Riot 이름 관측 시각,
정규화 함수·generated 검색 컬럼·hash 인덱스를 추가합니다.
적용 내역은 Drizzle이 관리하므로 SQL 파일을 수동으로 골라 실행하지 마세요.

기존 DB는 변경 전에 백업하고, 별도 Preview DB에서 마이그레이션과 앱을 먼저 확인하세요.
새 버전의 앱이 요청을 받기 전에 대상 DB에 필요한 마이그레이션을 적용해야 합니다.
운영 DB의 스키마 변경에는 `db:push` 대신 `db:migrate`를 사용합니다.

`0007`은 기존 이름의 검색 키와 기존 계정의 가입 판정 버전을 채웁니다. Riot 이름 관측 시각은
연결된 `file_mtime` 경기의 최근 한국 일자 00시로 초기화하며, 원래 수정 시각을 복구하는 것은
아닙니다. 날짜 보정 값·업로드 시각은 이 초기화에 쓰지 않습니다. generated 컬럼과 인덱스 생성은
기존 테이블을 읽고 잠그므로 Preview DB에서 데이터 규모에 따른 소요 시간을 확인하세요.
마이그레이션 후 새 앱을 배포하고, 이전 로그인 판정 코드가 계속 실행되지 않도록 진행 중인
이전 배포 트래픽을 정리합니다. 이전 앱은 신규 거절 판정을 보존하지 못합니다.

## Discord 인증으로 전환

DB를 백업한 뒤 별도 Preview DB에서 검증하고 **migration을 먼저 적용한 후 새 앱을 배포**합니다.

1. Portal에 환경별 정확한 callback을 등록하고 지정 서버에 봇을 설치합니다.
2. Discord 환경변수와 독립 `AUTH_SECRET`을 준비합니다. `READ_PASSWORD/OWNER_PASSWORD`와
   이전 `ADMIN_PASSWORD/UPLOAD_PASSWORD`는 삭제하고 재사용하지 않습니다.
3. `npm run db:migrate`를 실행합니다. `0006_tiny_blur.sql`은 인증 테이블을 추가하고 기존
   credential을 모두 retire합니다. 기존 감사·게임·모임원·Riot·예약은 삭제하지 않습니다.
   이전 credential의 FK는 nullable/SET NULL로 바꾸어 게임 멤버 삭제 후에도 이력을 보존합니다.
4. 새 앱을 배포하고 이전 배포의 도메인·직접 URL·Preview 접근과 진행 중 트래픽을 정리합니다.
   이전 인스턴스는 공유 암호를 계속 사용할 수 있어 promotion만으로 폐기를 보장하지 않습니다.
5. 모든 사용자가 Discord로 다시 로그인합니다. v4 이하 세션과 legacy 예약의 사용자 처리는
   거부됩니다. 미사용 예약은 기존 만료 정리로 회수하며 저장된 경기 원본은 유지합니다.
6. 오너가 **사용자 권한**에서 등록 계정의 관리자를 수동 지정합니다. 모임원 이름이나 이전
   credential로 Discord 계정을 추정하지 않습니다. 사용자 토큰·활성 세션 없이 봇으로 확인합니다.
7. 새 로그인·업로드·감사와 인증 Cron의 마지막 전체 완료를 확인합니다. 이전 배포 확인 기록은
   새 변경의 운영 검증으로 간주하지 않습니다.

`AUTH_SECRET` 회전은 전체 세션, guild 변경은 이전 guild의 세션을 무효화합니다.
owner ID 변경은 요청별 역할에 반영됩니다. 관리자 회수는 해당 계정의 기존 세션을 전부
폐기하며 재지정해도 이전 세션·grant·업로드 예약은 복구되지 않습니다.
봇/OAuth 비밀 회전은 이후 provider 호출에 적용하며 기존 DB 접근 권한은 유지합니다.

오너만 감사로그를 조회합니다. 성공 변경과 감사는 같은 transaction에 저장합니다.
DB 운영자까지 막는 외부 불변 저장소는 사용하지 않습니다.
롤백할 때에는 접근을 운영자에게 제한하고 이전 배포·암호를 격리합니다. retire한 credential을
복원하거나 이전 암호 로그인을 다시 공개하지 않습니다. additive schema를 유지한 수정 배포가
기본이며 스키마 복구는 백업과 운영 승인 절차를 따릅니다.

## 모임원과 경기 관리 업데이트

`0005_pale_paladin.sql`은 `played_at`과 `played_at_override`를 PostgreSQL `date`로 바꾸고
코멘트 열과 30자 제약을 추가합니다. 기존 시각을 한국 날짜로 변환하므로 DB 세션의 시간대와
무관하게 사용자가 보던 날짜를 유지합니다. 두 날짜 열의 기존 시간 정보는 제거됩니다.

1. DB를 백업하고 별도 Preview DB에서 `npm run db:migrate`를 실행합니다.
2. 기존 원본·수정 날짜가 맞는지, 특히 UTC 15시 전후 날짜를 확인합니다.
3. 마이그레이션을 적용한 DB에 새 앱을 배포합니다. 이전 앱은 날짜 열을 `Date`로 읽고 쓰므로
   새 스키마와 함께 실행하지 마세요. 운영 적용도 마이그레이션 후 배포 순서입니다.
4. 모임원 삭제와 Discord 권한 독립성, Riot 계정·게임·감사로그 보존을 확인합니다.
5. 제외 경기만 있는 계정이 미연결 목록에서 빠지고 복구 시 돌아오는지, 두 표가 10개씩 독립적으로
   페이징되는지 확인합니다. 다른 페이지의 모임원도 계정 연결 선택 목록에 있어야 합니다.
6. 코멘트 저장·수정·비우기와 공백 포함 30자 제한, 일반 사용자의 조회·수정 차단을 확인합니다.

이전 시각의 복구가 필요한 롤백은 백업 복원이 필요합니다. 모임원 삭제는 실제 삭제이며,
관리자 지정 취소 자체는 삭제를 실행하지 않습니다.

## 만료 업로드 정리

[`vercel.json`](../vercel.json)은 `/api/maintenance/uploads`를 매일 실행하도록 설정합니다.
엔드포인트는 `Authorization: Bearer <CRON_SECRET>`이 일치할 때만 실행되며, 시크릿이
없거나 다르면 401을 반환합니다. Vercel의 인증 헤더 설정은
[Cron 관리 문서](https://vercel.com/docs/cron-jobs/manage-cron-jobs#securing-cron-jobs)를 참고하세요.

정리 작업은 만료 후 24시간이 지난 바인딩을 한 번에 최대 50개 처리합니다.
게임에 저장된 원본은 보존하고, 게임에서 사용하지 않는 예약 경로의 Blob과 바인딩을
정리합니다. 삭제 실패는 다음 실행에서 다시 시도합니다. 정리 요청의 응답 필드
`examined`, `removed`, `failed`와 함수의 오류 로그를 확인하세요.

최종 처리 로그 없이 남은 예약은 저장된 실행자 정보로 `upload_expired` 실패를 기록합니다.
정식 게임이 이미 저장되어 있으면 원본을 보존하고 `reconciled_commit` 성공으로 기록합니다.
기존 성공·실패·중복 로그가 있으면 추가 기록하지 않습니다. 최종 감사로그와 예약 삭제는
같은 DB 트랜잭션으로 처리하며, 감사 저장 실패 시 예약을 남겨 다음 정리에서 재시도합니다.

로컬 서버에서 정리 작업을 확인하려면 별도로 인증된 요청을 보내야 합니다. 로컬의
`npm run dev`는 정리 작업을 자동으로 예약 실행하지 않습니다.

## 배포 후 확인

별도 Preview DB·Blob에서 다음을 확인한 뒤 운영에 반영하세요.

1. [Discord smoke checklist](discord-auth.md#staging운영-smoke-checklist)를 완료합니다.
   멤버·비멤버/pending·오너·admin·동의 취소와 재가입을 구분하고 직접 API/Action 인가를 확인합니다.
2. viewer 이름 원문 표시·생년 숨김과 admin/owner 범위를 HTML·클라이언트 payload로 확인합니다.
3. 오너가 세션 없는 등록 계정을 지정하고 중복·정지·owner 대상 부여가 거부되는지 확인합니다.
4. 실제 `.rofl` 업로드와 경기·참가자 저장·`processed`를 확인합니다. 다른 계정·회수 전 grant·
   이전 owner·legacy 예약과 재가입 전 예약의 처리는 거부되어야 합니다.
5. 중복은 기존 경기로 안내하고 새 Blob만 삭제합니다. 손상 파일은 422, 소비 예약 재사용은 409입니다.
6. 변경 감사의 account/Discord/grant와 snapshot을 확인합니다. code·사용자/봇 토큰·cookie·
   state·AUTH_SECRET은 감사와 함수 로그에 없어야 합니다.
7. 실제 다중 연결 Postgres에서 회수/정지와 변경·처리, 부여/정리 경합과 rollback을 확인합니다.
8. private 원본·Cron 비인증 거부와 AUTH_SECRET/guild/owner 전환을 확인합니다.
9. 일반 사용자 첫 화면의 닉네임 자동완성·검색 제출을 확인합니다. 현재 연결된 활성 경기
   계정만 최대 10개 추천하고 정확한 닉네임·태그는 단일 전적·동명 모임원 선택·없는 사용자로
   처리되어야 합니다. 선택지 이름은 원문으로 표시하고 자동완성 응답에는 실명·생년이 없어야 합니다.
10. 계정 연결·해제·삭제·경기 제외 후 추천 무효화와 오래된 후보 제출을 확인합니다. 캐시 장애에도
    검색 제출은 현재 DB 연결을 사용해야 합니다. Layerbase TLS·여러 Vercel 인스턴스·TTL과
    재구축 검증은 [Valkey 배포 후 확인](valkey.md#배포-후-확인)을 함께 진행합니다.

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
