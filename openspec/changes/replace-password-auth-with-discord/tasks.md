## 1. 설정과 DB 기반

- [x] 1.1 현재 작업 트리 변경과 설치된 Next.js 인증·Route Handler·cookies·Proxy 가이드를 확인하고, 영향 받는 인증/멤버/감사/업로드 호출 지도를 정리한다.
- [x] 1.2 `DISCORD_CLIENT_ID/SECRET`, `DISCORD_BOT_TOKEN`, `DISCORD_REDIRECT_URI`, `DISCORD_GUILD_ID`, `DISCORD_OWNER_USER_ID`, 독립 `AUTH_SECRET` 검증을 추가한다. decimal 문자열 ID·운영 HTTPS·명시적 local callback을 검사하고 기존 암호 요구를 제거한다. core 권한 설정과 provider 설정 검증을 분리해 provider 구성 오류만으로 기존 DB 권한 판정을 중단하지 않게 한다.
- [x] 1.3 `auth_accounts`, `admin_grants`, `auth_sessions`, `oauth_login_attempts`, `discord_api_controls`, `auth_reconciliation_runs`를 추가한다. 계정 활성/정지·가입 확인 시각/version, 고유 계정/활성 grant, 세션 해시/만료 인덱스, 공유 차단/시험 lease와 정리 cursor/실행 lease를 migration으로 만든다. 게임 멤버/Riot FK와 사용자 OAuth 토큰/갱신 필드가 없음을 확인한다.
- [x] 1.4 감사·예약의 새 account/grant 실행자 필드와 retired credential의 nullable/SET NULL FK를 추가한다. 기존 로그/게임 데이터를 보존하는 migration 및 기존 키 일괄 retire의 전환 절차를 검증한다.
- [x] 1.5 신규 계정/세션/권한/유지보수의 test fixture와 migration integration 기반을 만들고 중복 first-login upsert, active-grant 고유 제약, 기존 감사/모임원/Riot 데이터 보존을 검증한다.

## 2. Discord 로그인 경로

- [x] 2.1 identify-only 사용자 OAuth와 Bot 인증의 `GET /guilds/{id}/members/{user_id}`를 분리한 Discord adapter를 만든다. 고정 HTTPS·form-encoded token exchange·응답/ID 검증·no-store·timeout/크기 제한·redirect 차단·공유 차단기·Retry-After를 적용한다.
- [x] 2.2 기존 trusted-IP/global 요청 예산을 적용한 `/api/auth/discord`를 만들고, 10분 state/브라우저 바인딩 해시·내부 return path·보호 쿠키를 저장한다.
- [x] 2.3 `/api/auth/discord/callback`의 query/state/binding/만료·일회성 원자 소비, 동의 취소, identify code 교환·사용자 조회·봇의 non-pending membership 확인을 구현한다. 사용자 access/refresh token은 콜백 종료 후 저장/갱신하지 않는다.
- [x] 2.4 계정 upsert/정지 계정 재활성화·가입 확인 결과·새 DB 세션·성공 감사의 원자 커밋 후에만 쿠키를 발급한다. 기존 계정의 Unknown Member/pending에는 공통 정지 처리를 적용하고 봇/구성/OAuth 오류·일시 장애는 구분한다. 회수된 세션/grant/예약을 복원하지 않는다.
- [x] 2.5 로그인 UI를 `Discord로 로그인`으로 교체하고 기본 `/` 및 허용된 내부 redirect를 유지한다. Proxy의 정확한 시작/콜백 공개 예외와 로그인 no-store를 적용한다.
- [x] 2.6 state 위조/누락/중복/교차 브라우저/만료/동시 replay, identify/사용자 응답 불일치, 비멤버·pending·동의 취소, 봇 오류/제거·차단 시 로그인 불가, 사용자 OAuth 토큰 미저장, audit rollback·redirect·throttle-before-provider를 회귀 검증한다.

## 3. DB 세션과 외부 장애 중 기존 접근

- [x] 3.1 최소 256-bit 난수 참조·해시 DB 조회·v5 서명 쿠키·30일 절대 수명·AUTH_SECRET 회전·v4 이하 거부를 구현하고 쿠키 옵션을 검증한다.
- [x] 3.2 `getSession/assertSession/assertAdmin/assertOwner`를 활성 account/session/grant 기반으로 전환하고 현재 owner·guild와 활성 grant를 매 보호 요청에서 판정한다. Proxy의 stale-role 판정과 일반 요청의 Discord 조회/가입 확인 TTL을 제거한다.
- [x] 3.3 가입 확인 결과를 DB version 조건부 저장하고 공통 계정 정지 transaction에서 활성 상태·세션·grant·감사를 함께 변경한다. 오래된 양성/거절 응답이 새 계정 상태를 덮어쓰거나 폐기 세션/grant를 되살리지 않게 한다. 외부 I/O 중 DB 잠금을 유지하지 않는다.
- [x] 3.4 Discord 호출 없이 수행하는 로그아웃의 DB 폐기와 장애 시 로컬 쿠키 삭제, CRON_SECRET 유지보수의 bounded 세션/시도 정리를 구현한다. 봇 정리 실패와 로컬 만료 정리를 독립적으로 처리한다.
- [x] 3.5 오래된 가입 확인·Discord 장애·공유 차단 중 기존 viewer/admin/owner 조회/변경과 owner 회수가 외부 호출 없이 성공함을 검증한다. 30일 만료, 정지/폐기 계정, owner/guild/secret 변경, 사용자 OAuth 만료·봇 토큰 교체, version 경쟁·outage logout·maintenance 권한도 회귀 검증한다.

## 4. 공유 봇 차단기와 하루 1회 탈퇴 정리

- [x] 4.1 PostgreSQL 범위별 차단 상태를 모든 봇 호출 전에 확인한다. 봇 401·403/Unknown Guild에는 60초, 전역 429에는 max(60초, Retry-After), bucket 429에는 해당 범위의 provider 대기를 적용한다. 차단 중 외부 호출/즉시 재시도를 막고 비밀을 저장하지 않는다.
- [x] 4.2 DB의 expiring 단일 시험 lease·version을 구현한다. 한 인스턴스만 재확인하고 늦은 성공으로 새 차단을 해제하지 않게 한다. 공유 상태 장애 시 봇 호출을 막고 토큰 회전으로 전역 대기를 우회하지 않게 한다. 별도 호출 예산/동시성 제한도 유지한다.
- [x] 4.3 CRON_SECRET 보호 `/api/maintenance/auth`와 하루 1회 `0 3 * * *` UTC 일정을 추가한다. 전체 등록 활성 계정을 세션 유무와 관계없이 제한된 페이지/순차 봇 조회로 확인하며 전체 guild 명단을 조회하지 않는다.
- [x] 4.4 DB 실행 lease·cursor·완료/부분 완료·오류 집계를 구현한다. 중복 실행을 막고 차단/시간 예산 초과 시 남은 대상부터 이어가며 미확인 계정을 유지한다. 마지막 전체 성공/부분 완료 상태를 오너만 조회하게 한다.
- [x] 4.5 Unknown Member/pending에 계정 정지·세션 전체 폐기·활성 grant 회수·시스템 감사를 원자 처리한다. provider/설정 오류는 상태를 유지하고, 재가입 후 새 로그인은 viewer 또는 현재 환경변수 owner로 판정한다.
- [x] 4.6 다중 인스턴스 401/403/전역·bucket 429 억제, 긴 Retry-After, 동시 시험·죽은 lease·늦은 응답, 중복/부분 Cron·잘못된 CRON_SECRET, 세션 없는 계정 정리, 재가입의 과거 권한 비복원과 전체 대상 처리 부하를 검증한다.

## 5. 오너의 관리자 지정

- [x] 5.1 오너 전용 등록 계정 검색/페이지 DAL과 `/admin/users`·`사용자 권한` 메뉴를 만든다. 최소 표시 정보·정확한 Discord ID·현재 역할·활성/정지 상태·가입 확인 시각을 보여주고 token/게임 멤버 연결을 제외한다.
- [x] 5.2 grant 직전에 활성 대상 DB의 Discord ID를 봇으로 새로 조회한다. 활성 세션/사용자 토큰 없이 오래 미접속한 계정도 지정하고, 정지 계정·비멤버·pending·봇/API 오류·공유 차단·owner 대상·중복 grant에는 새 부여를 만들지 않는다.
- [x] 5.3 account/session/grant 잠금 순서와 관련 account ID 정렬을 공통화하고 grant/revoke·현재 actor 및 대상 활성 상태/가입 확인 version 검증·감사를 한 transaction으로 직렬화한다. 회수는 actor/대상의 provider 응답 없이 기존 세션 전체를 폐기한다.
- [x] 5.4 모임원 목록/화면의 credential controls·administrator 표시·삭제 guard를 제거하고 게임 멤버 삭제가 로그인 역할에 영향을 주지 않도록 조정한다.
- [x] 5.5 직접 admin/viewer 호출 차단, unknown/suspended target, 동명/이름 변경 계정, 대상 세션 없는 grant, 봇 오류 시 부여 차단과 회수 가능, 동시 grant·즉시 반영·revoke·regrant, 정리와 부여 경쟁, 모임원 삭제 독립성을 회귀 검증한다.

## 6. 변경 권한과 개인정보 경계

- [x] 6.1 현재 권한 Actor와 과거 감사 snapshot 타입을 분리하고 `withActorTransaction/lockActor`를 account → session → grant → business row 순서로 전환한다. 일반 transaction에서 활성 account/session·guild·owner/grant를 재검증하며 가입 확인 TTL/외부 I/O를 요구하지 않는다.
- [x] 6.2 멤버/계정 연결·게임 변경 Action과 DAL에서 현재 권한을 독립 검증한다. owner 환경변수 전환과 privilege 부족/unauthenticated/DB unavailable 응답을 일관되게 적용한다.
- [x] 6.3 현재 역할 확인 후에만 기존 role별 business cache를 이용하도록 검증하고 viewer 생년 제거·메뉴와 admin/owner 데이터 관리 범위를 유지한다. 이름 표시는 후속 11절의 원문 표시 계약을 따른다.
- [x] 6.4 mutation/revoke·로그인/일일 정지·membership 거절/늦은 응답·계정 관리 잠금의 동시성 회귀와 감사 실패 rollback을 검증한다. 로컬 PGlite 결과와 실제 PostgreSQL 동시성의 검증 범위를 구분한다.

## 7. 감사와 업로드 전환

- [x] 7.1 새 감사의 account/Discord/grant 실행자·표시명 snapshot과 target 분리를 적용하고 로그인/로그아웃/권한/데이터/replay 사건을 유지한다. 정리의 시스템 실행자와 대상/사유를 구분하고 오너 전용 화면에서 legacy 실행자를 표시한다.
- [x] 7.2 업로드 예약·토큰 발급·처리의 실행자 비교를 account/role/grant로 전환하고, 새 예약에 member/credential 식별을 쓰지 않도록 한다. 반복 로그인에도 유지되는 account 요청 예산을 적용한다.
- [x] 7.3 ingest 최종 persistence에서 활성 계정/세션·guild·권한을 DB로 재검증하고, 정지 계정·다른 계정·회수 전 grant·이전 owner·legacy 예약의 사용자 처리를 거부한다.
- [x] 7.4 만료 예약 정리가 신규/legacy 감사 snapshot을 처리하도록 전환한다. CRON_SECRET·정확한 Blob store/path·nonce/callback/state/resource 보호를 유지한다.
- [x] 7.5 grant 회수/재지정·owner 전환·정리/처리 회수 경쟁·재가입의 과거 예약 비복원·stable budget·legacy cleanup·감사 비밀 비노출을 검증한다. 기존 replay/업로드 resource 회귀도 통과시킨다.

## 8. 문서와 완료 검증

- [x] 8.1 `.env.example`, README, 개발/배포/아키텍처 문서를 갱신한다. Portal callback·identify 로그인/최소 권한 봇 설치의 분리, BOT_TOKEN 보관·회전, 계정/게임 멤버 분리, 세션 없는 관리자 지정, 하루 1회 정리와 Hobby 시각 오차·장애 시 더 길어지는 회수 지연·공유 차단·기존 접근 유지를 설명한다.
- [x] 8.2 추가형 migration·기존 credential retire·v4 폐기·관리자 수동 지정·이전 배포 트래픽 정리·접근 제한 rollback 절차와 staging/운영 smoke checklist를 작성한다. Cron 인증·전체 정리 완료·부분 실패/오류 확인·재가입 절차를 포함한다.
- [x] 8.3 일반 멤버·오너·admin·비멤버/pending·탈퇴·동의 취소·봇 제거/토큰 오류·세션 없는 지정·회수/재지정·직접 API/Action·업로드/감사/개인정보의 로컬 end-to-end/browser 검증을 수행한다. Discord outage 기존 접근과 신규 login/grant 차단, 일일 정리·다중 인스턴스 차단도 증거를 남긴다.
- [x] 8.4 `openspec validate replace-password-auth-with-discord --strict`와 `npm run check`를 통과시키고 구현/spec 정합성을 확인한다. 실제 Discord/Neon/Blob·Cron 운영 검증은 별도 증거로 구분하며 설정이 준비되지 않은 검증은 완료로 표시하지 않는다.

## 9. 봇 조회 경합 후속 수정

- [x] 9.1 정상 permit/로컬 호출 예산 경합의 bounded 대기와 실제 차단기 장애를 구분하도록 설계·spec을 갱신한다.
- [x] 9.2 공유 permit 획득 재시도·대기 deadline을 구현하고 열린 차단기·단일 복구 시험·lease/version 보호를 유지한다. 외부 호출 전 로컬 예산 초과는 실패한 probe로 기록하지 않는다.
- [x] 9.3 Cron에 남은 실행 예산을 전달하고, 정상 경합이면 같은 대상을 계속 처리하며 대기 예산 소진은 cursor 보존·partial로 집계한다.
- [x] 9.4 동시 OAuth 콜백, 양방향 로그인/Cron 경합, 복구 시험·대기 중 새 차단·대기 만료·로컬 호출 예산 재시도를 회귀 검증하고 운영 문서·검증 기록을 갱신한다.
- [x] 9.5 전체 npm run check와 strict OpenSpec 검증을 통과시킨다. 실제 다중 연결 PostgreSQL/Discord/배포 검증과 로컬 결과를 구분한다.

## 10. 리뷰 후속 수정

- [x] 10.1 가입 거절 저장의 실행자/대상 잠금 순서와 로그인 시작 시 만료 행 회수 계약을 명세에 반영하고 strict 검증한다.
- [x] 10.2 가입 거절 저장도 실행자/대상 계정을 정렬 잠금하며, 시스템 처리·unknown target·감사 rollback 회귀와 실제 PostgreSQL 경합을 검증한다.
- [x] 10.3 로그인 시도 생성에 원자적인 bounded 만료 회수를 추가하고 지속 요청·기존 backlog·유효한 시도 보존·저장 실패 rollback·동시 잠금 회귀를 검증한다.
- [x] 10.4 운영 문서와 검증 기록을 갱신하고 전체 npm run check 및 OpenSpec strict 검증을 완료한다.

## 11. 일반 사용자 이름 원문 표시

- [x] 11.1 일반 사용자 이름 원문 표시와 생년 숨김 유지, 이전 캐시 분리 계약을 명세에 반영하고 strict 검증한다.
- [x] 11.2 목록·전적·게임 상세·닉네임 검색의 이름 마스킹을 제거하고 캐시 namespace를 갱신한다. 서버 payload·HTML·검색·캐시 회귀와 현재 운영 문서를 갱신한다.
- [x] 11.3 관련 회귀, 전체 npm run check 및 OpenSpec strict 검증을 완료하고 로컬 검증 범위를 기록한다.

## 로컬 검증 범위와 운영 대기

구현 작업의 회귀는 실제 SQL migration을 적용한 격리 PGlite, 모의 Discord fetch와 실제 handler,
서명 쿠키·DB 세션, 역할별 서버 렌더링 및 로컬 로그인 화면 브라우저로 검증한다.
실제 리플레이 원본도 파서·PGlite 저장·API 처리에 사용하며 Blob 전송은 모의 처리한다.
실제 Discord CLIENT/SECRET/BOT/GUILD/OWNER/CALLBACK은 현재 환경에 설정되지 않아
Discord 연동·Neon 다중 연결·Blob·Vercel Cron/ingress 운영 확인은 **미수행**이다.
이 항목은 [운영 checklist](../../../docs/discord-auth.md#staging운영-smoke-checklist)에 남기며
로컬 구현 체크 완료로 운영 검증을 완료 처리하지 않는다.

최종 로컬 결과: 봇 경합 후속 회귀 12개를 포함해 실제 리플레이·임시 Valkey 9와 39개 파일/702개 테스트, lint/typecheck/build/format 및 OpenSpec strict 통과.
[검증 기록](../../../docs/validation/2026-10-08-discord-auth.md)에 증거와 운영 미수행 범위를 정리했다.

리뷰 후속 결과: 실제 리플레이·임시 Valkey 9·PostgreSQL 17을 포함한 40개 파일/710개 테스트,
lint/typecheck/build/format 및 OpenSpec strict 통과. 가입 거절/회수 잠금과 로그인 시도 정리의
실제 연결 경합을 포함한 [2026-10-09 검증 기록](../../../docs/validation/2026-10-09-discord-auth-review-fixes.md)을 추가했다.

2026-10-09 이름 표시 후속 결과: 서버 payload·역할별 HTML·닉네임 검색·실제 임시 Valkey 9의
이전 namespace 분리 회귀를 통과했다. `VITEST_MAX_WORKERS=4`, 로컬 Valkey 테스트 URL과
`LLVY_REPLAY_FILE`을 지정한 `npm run check`에서 39개 파일/702개 테스트와
lint/typecheck/build/format이 통과했고 OpenSpec strict도 통과했다. 별도 PostgreSQL 연결이
필요한 1개 파일/3개 테스트는 이번 검증에서 제외했다. 기본 동시 실행에서는 기존 600회 로그인
시도 테스트가 5초 제한을 초과했으나 단독 실행과 동시 실행 수를 4개로 제한한 전체 검사에서
통과했다. 일반 사용자의 생년 숨김·권한 제한은 유지하며 운영 배포·실제 브라우저 확인은 수행하지 않았다.
