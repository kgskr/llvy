# Discord 인증 운영

[배포·전환](deployment.md#discord-인증으로-전환) · [설계](../openspec/changes/replace-password-auth-with-discord/design.md)

## Portal과 봇 설정

1. [Discord Developer Portal](https://discord.com/developers/applications)에서 애플리케이션을 만들고
   Application ID와 OAuth2 Client Secret을 서버 환경변수에 설정합니다.
2. OAuth2 Redirects에 `DISCORD_REDIRECT_URI`를 정확히 등록합니다. 운영 callback은
   `https://<app-origin>/api/auth/discord/callback`, 로컬 개발은
   `http://localhost:3000/api/auth/discord/callback`입니다. query·fragment·userinfo는 허용하지 않습니다.
3. 같은 애플리케이션의 Bot을 만들고 Bot Token을 `DISCORD_BOT_TOKEN`으로 설정합니다.
   OAuth2 설치 URL은 `bot` scope와 permissions `0`을 사용해 지정 서버에 설치합니다.
   관리자 권한·메시지 읽기/쓰기·Gateway 연결·전체 멤버 명단 동기화는 사용하지 않습니다.
4. Discord 개발자 모드에서 서버 ID와 오너 사용자 ID를 복사해 `DISCORD_GUILD_ID`와
   `DISCORD_OWNER_USER_ID`에 decimal 문자열로 설정합니다. 숫자로 변환하지 않습니다.
5. `AUTH_SECRET`과 `CRON_SECRET`은 provider 비밀과 별개로 생성합니다. 모두 서버 전용이며
   `NEXT_PUBLIC_*`·브라우저 props·감사·로그에 넣지 않습니다.

사용자 로그인은 [OAuth2 authorization code](https://docs.discord.com/developers/topics/oauth2)의
`identify`만 요청하고 `/users/@me`의 ID를 사용합니다. OIDC ID token을 사용하지 않습니다.
별도의 Bot 인증으로 [Get Guild Member](https://docs.discord.com/developers/resources/guild#get-guild-member)를
조회하며 성공한 non-pending 응답만 허용합니다. 사용자 access/refresh token은 저장하지 않습니다.
앱 로그아웃은 LLVY 세션을 폐기합니다. Discord 자체 로그아웃이나 연결된 앱 동의 철회까지
수행하지 않으며, Discord OAuth 토큰 만료만으로 기존 LLVY 세션을 종료하지 않습니다.

## 계정과 권한

Discord 계정은 `auth_accounts`에 등록합니다. 게임 모임원·Riot 계정과 FK나 이름 매칭이 없습니다.
가입 승인된 일반 사용자는 viewer이며 현재 owner ID와 일치하는 계정은 owner입니다.
오너는 **사용자 권한**에서 한 번 로그인한 활성 계정을 선택해 관리자 grant를 부여합니다.
대상의 사용자 OAuth 토큰·현재 세션·최근 로그인은 필요하지 않으며 부여 직전 봇으로 확인합니다.
정지 계정은 서버 재가입 후 새 로그인으로 활성화해야 지정할 수 있습니다.

부여는 기존 유효 세션에도 바로 반영합니다. 회수는 대상의 세션을 전부 폐기하며 외부 API를
호출하지 않습니다. 재지정·재가입은 이전 세션·grant·업로드 예약을 복원하지 않습니다.
재가입 후 일반 계정은 viewer, 현재 환경변수의 오너는 owner입니다.

관리자 지정 중 미가입/심사 대기를 발견한 경우에도 실행자와 대상 계정을 UUID 순서로 먼저
잠급니다. 권한 회수와 같은 잠금 순서를 사용하며, 회수자 외래키의 계정 잠금까지 포함합니다.
계정 정지·세션/권한 회수·감사는 함께 커밋하거나 함께 롤백합니다.

## 로그인 시도 저장량

로그인 시작은 기존 IP/전역 요청 제한을 통과한 뒤, 한 transaction에서 만료 시도를 최대
20개 삭제하고 새 시도 1개를 저장합니다. 만료 인덱스를 사용하고 다른 요청이 잠근 행은
`SKIP LOCKED`로 건너뜁니다. 유효한 바인딩은 보존하며 저장 실패 시 삭제도 롤백합니다.
따라서 지속적인 시작 요청의 만료 행이 일일 500개 정리 한도 때문에 계속 누적되지 않습니다.
요청이 끊긴 뒤 남은 만료 시도는 기존 일일 유지보수가 정리합니다.

## 하루 1회 확인과 장애

`/api/maintenance/auth`는 `Authorization: Bearer <CRON_SECRET>`으로 보호하고
`0 3 * * *` UTC(한국 시간 정오 기준)에 하루 한 번 실행합니다.
Vercel Hobby는 [Cron 실행 시각 오차](https://vercel.com/docs/cron-jobs/usage-and-pricing)를 허용하므로
탈퇴 후 24시간 이내 회수를 보장하지 않습니다. 장애·부분 실행·계정 수에 따라 지연은 더 길어집니다.
운영 로그와 오너 화면의 **마지막 전체 완료**를 확인하세요.

정리는 모든 등록 활성 계정을 세션 유무와 관계없이 ID 순서로 25개씩 읽습니다.
실행당 최대 200개·45초, 순차 조회이며 공유 lease는 120초입니다. 전체 guild 명단을 조회하지 않습니다.
로그인·관리자 부여가 봇을 조회 중이면 같은 대상의 permit을 남은 실행 예산 안에서 기다립니다.
외부 요청의 5초 timeout을 남겨 두고 대기를 끝내며, 시간이 부족하면 해당 cursor를 유지한
`partial`로 저장합니다. 로컬 경합의 시간 초과는 provider/DB 오류 횟수에 넣지 않습니다.
각 결과와 cursor를 같은 transaction으로 저장하고 중단하면 다음 실행에서 이어갑니다.
cycle 시작 뒤 새로 등록한 계정은 다음 cycle에서 확인합니다. duplicate 실행은 `busy`로 끝납니다.
최종 상태는 `completed`, `partial`, `lease_lost`이며 `examined/suspended/failed`는 cycle 누적값입니다.
partial은 기존 마지막 전체 완료 시각을 갱신하지 않습니다. 운영자가 동일 endpoint를 다시 호출해
남은 대상을 처리할 수 있습니다. 대규모 서버에서는 실행 예산과 완료 간격을 실제 부하로 확인하세요.

명시적 `404 / Unknown Member(10007)`와 `pending=true`만 계정 정지·전체 세션 폐기·grant 회수·
미완료 업로드 예약 실패·시스템 감사를 원자 처리합니다. grant가 없는 오너도 재가입 후 과거 예약을
다시 사용할 수 없습니다. 다른 404·401·403·429·timeout·구성 오류는 미확인 계정을 유지합니다.
일반 조회·변경은 DB 계정·세션·현재 권한만 확인하며 membership TTL이나 Discord 호출이 없습니다.
Discord 장애로 기존 viewer/admin/owner 접근과 오너 회수가 중단되지는 않습니다.
DB 또는 core 권한 설정 장애는 보호 접근을 거부합니다.

첫 로그인 이전의 absent/pending도 guild·Discord ID별 판정 버전을 보관하며 로그인 계정은
만들지 않습니다. 따라서 먼저 시작한 성공 응답이 늦게 도착해도 더 새로운 거절을 덮어쓸 수
없습니다. 새 로그인으로 다시 확인한 정상 가입은 허용합니다. 판정 버전 행은 오래된 콜백을
막는 근거이므로 로그인 시도 만료 정리와 함께 삭제하지 않습니다.

## 오류 반복 억제

[Discord rate limits](https://docs.discord.com/developers/topics/rate-limits)에 맞춰 PostgreSQL의
`discord_api_controls`를 모든 인스턴스가 공유합니다. 환경·애플리케이션 ID를 기준으로 전역
bot 범위와 guild 범위를 나누며 bot token 원문·해시는 저장하지 않습니다.

- bot 401: 전역 60초, 403 또는 Unknown Guild(10004): guild 60초 차단.
- 전역 429: 최소 60초와 유효한 `Retry-After/retry_after` 중 더 긴 시간.
- bucket 429와 남은 요청 수 0: guild 범위의 provider 대기.
- 차단 중 호출하지 않으며 만료 후 한 인스턴스만 시험합니다. 실패하면 다시 열고 version으로
  늦은 성공이 새 차단을 지우지 못하게 합니다. 정상 호출도 expiring permit으로 동시 한 건만 허용합니다.
- 정상 permit 경합은 즉시 실패하지 않고 DB 잠금을 해제한 상태로 50~100ms 간격으로 재확인합니다.
  로그인·관리자 부여는 로컬 호출 예산 대기를 포함해 최대 10초 기다립니다. 복구 시험 중에도
  같은 대기 한도를 적용하고, 대기 중 새 차단이 열리면 추가 외부 호출 없이 반환합니다.
  OAuth code를 다시 교환하지 않으며, provider 호출 전 대기 시간 초과는 차단기를 다시 열지 않습니다.
- permit은 20초이고 외부 호출 직전에 다시 확인합니다. 응답 본문까지 5초·64KiB로 제한하고
  공유 초당 30회 예산을 적용합니다. 공유 DB 확인이 실패하면 외부 호출을 하지 않습니다.

신규 로그인·관리자 부여는 확인 실패 시 거부합니다. callback은 정적인 오류 안내와 대기 헤더를
반환하며 기존 세션은 유지합니다. 같은 앱의 봇 토큰 회전으로 전역 429 대기를 우회하지 않습니다.
토큰이 폐기되거나 봇이 추방되면 설정을 복구한 뒤 차단 만료 후 시험 결과를 확인하세요.
만료 세션/OAuth 시도 정리는 봇 확인보다 먼저 독립적으로 실행하고 만료 업로드 정리는 별도 Cron입니다.

## Staging/운영 smoke checklist

로컬 PGlite·모의 fetch는 아래 실제 서비스 확인을 대신하지 않습니다.

- 일반 멤버·오너 로그인, `identify` 동의, 동의 취소, 비멤버/pending 거절과 잘못된 state/replay 거절.
- 세션 없는 등록 계정 관리자 부여, owner/admin/viewer 직접 URL·API·Action 인가, 회수·재지정.
- viewer 이름 원문 표시·생년 숨김, 모임원 삭제와 계정 권한 독립성, 감사 account/Discord/grant와 비밀 미노출.
- 실제 업로드·중복·손상 파일·정확한 Blob cleanup, 회수 전 grant·legacy·재가입 전 예약 거절.
- bot 제거/토큰 오류·전역/bucket 429의 여러 인스턴스 호출 억제와 회복 시험, 긴 provider 대기 유지.
- Discord 장애 중 기존 접근·오너 회수와 신규 로그인/부여 차단, DB 장애 API 503.
- Cron 비인증 401·중복 실행·부분 cursor 재개·마지막 전체 완료, 세션 없는 탈퇴자와 오너 정지.
- 재가입 새 로그인과 이전 세션/grant 비복원, 실제 PostgreSQL 다중 연결의 회수/변경·부여/정리 경합.
- secret/guild/owner 변경, 이전 배포 URL 격리, 실제 Vercel Cron 도착 시각·응답·지연 관측.

이 checklist는 배포 전·후 운영 작업이며 구현 완료만으로 자동 충족되지 않습니다.

## 이름 검색과 공개 정보

로그인한 모든 역할은 모임원 이름과 연결 Riot ID로 검색할 수 있습니다. 검색 대상은 게임 모임원이며
Discord 로그인 계정 이름과는 별개입니다. `q` 자동완성의 모임원 후보는 이름·UUID·최대 2개 Riot ID만
포함하고 생년·Discord ID·로그인 자격증명은 포함하지 않습니다. `nickname` API 응답은 기존 형태를
유지합니다. 인덱스가 준비되어 있어도 매 요청 현재 세션을 확인하며 폐기된 세션은 401로 거부합니다.
동일한 읽기 요청 안의 중복 인증은 공유하지만 다음 요청은 DB에서 다시 확인합니다.
페이지는 React 렌더 범위, 자동완성 API는 명시적인 요청 범위를 사용합니다. 변경·업로드 직전의
최신 인증 조회와 transaction 권한 잠금에는 이 읽기 결과를 사용하지 않습니다.
