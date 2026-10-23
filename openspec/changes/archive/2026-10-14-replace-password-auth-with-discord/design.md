## Context

LLVY는 Next.js 16.3 App Router/Server Actions/Proxy, Drizzle/PostgreSQL, Vercel Blob, 선택적 Valkey 조회 캐시를 사용한다. 현재 viewer/owner는 공유 암호, admin은 `admin_credentials.member_id`에 연결한 개인 키로 인증한다. v4 세션의 관리자 실행자는 모임원 ID와 credential ID이며, 감사로그·업로드 예약·모임원 목록과 삭제도 이 구조에 의존한다.

인증·계정 모델은 다음과 같다. 일반 사용자의 로그인 계정은 게임 모임원과 연결하지 않는다. 관리자는 가입한 로그인 계정 중 오너가 선택한다. 오너는 Discord가 반환한 사용자 ID를 환경변수에 지정한다. 이 분리는 관리자와 오너 계정에도 동일하게 적용한다. 리뷰를 반영해 사용자 OAuth는 로그인 시 식별만 수행하고, 지정 서버 가입 확인은 서버에 추가한 봇 토큰의 개별 멤버 REST 조회로 수행한다.

설계는 현재 소스와 `introduce-owner-managed-admin-access`의 권한/개인정보 보장을 기준으로 한다. 설치된 Next.js의 `authentication.md`·`cookies.md`에서 확인한 대로 Proxy는 빠른 쿠키 검사에 사용하고, 실제 권한은 데이터 접근 함수·각 Action·Route Handler에서 검증한다. 쿠키 생성/삭제는 Route Handler 또는 Server Action에서 수행한다.

## Goals / Non-Goals

**Goals:**

- 지정 서버의 정식 멤버만 Discord 로그인과 자동 계정 등록을 허용한다.
- 로그인 계정과 게임 모임원/Riot 계정/게임 기록 사이에 식별 연결을 만들지 않는다.
- 환경변수 기반 owner, 오너가 부여한 admin, 기본 viewer의 현재 권한을 서버에서 판정한다.
- 사용자 OAuth 토큰을 영구 저장하지 않으면서 하루 1회 탈퇴자 정리·관리자 회수·로그아웃·변경 동시성을 다룬다.
- Discord 장애가 기존 viewer/admin/owner의 보호 요청을 중단시키지 않게 하고, 반복되는 봇 설정 오류의 호출을 공유 차단기로 제한한다.
- 개인정보 투영, 오너 전용 감사 조회, 실행자별 업로드 예약과 변경 감사 원자성을 유지한다.
- 기존 키/세션에서 전환하는 배포 및 검증 절차를 제공한다.

**Non-Goals:**

- Discord 역할을 LLVY 관리자 권한으로 자동 변환하거나 Discord 서버 오너를 서비스 오너로 간주하기.
- 전체 Discord 서버 명단 조회, 상시 봇 프로세스/Gateway 연결, 가입/추방 이벤트 수신, 비멤버 자동 초대.
- 사용자 access/refresh token 영구 보관·암호화·갱신, 대상 사용자 세션을 이용한 가입 확인.
- 이메일·생년 등 추가 프로필 수집, 게임 모임원과의 수동/자동 계정 연결 기능.
- 일반 사용자의 모든 조회 기록 수집, 로그인 계정 삭제 UI, 과거 키에서 Discord 계정 추정.
- 계획 작성 중 애플리케이션 구현, 운영 환경변수 입력, 운영 migration·배포 수행.

## Decisions

### 1. identify-only OAuth2와 봇 기반 개별 멤버 조회

일반 웹 로그인은 OAuth2 Authorization Code Grant로 구현한다. OIDC `id_token`/`sub`를 전제로 하지 않고, `identify`만 요청해 서버가 `/users/@me`에서 검증한 `id`를 계정 식별자로 사용한다. 사용자 access token은 이 콜백 내 사용자 조회에만 사용하고, 응답에 refresh token이 있어도 저장하거나 갱신하지 않는다. 이메일·`guilds`·`guilds.members.read` scope는 요청하지 않는다.

지정 서버에 전용 봇을 추가하고 `Authorization: Bot <DISCORD_BOT_TOKEN>`으로 `GET /guilds/{DISCORD_GUILD_ID}/members/{verified_user_id}`를 호출한다. 초기 로그인·계정의 주기적 재확인·관리자 지정 모두 같은 멤버 조회 함수를 사용한다. 대상 ID는 검증된 로그인 ID나 등록 계정 DB에서만 가져오며, 공개 임의 사용자 조회 API를 만들지 않는다. 멤버 응답의 user.id는 요청한 계정 ID와 일치해야 한다.

봇은 LLVY 서버에서 REST 인증 수단으로만 사용한다. 별도 프로세스·Gateway 연결·메시지/역할 관리 기능·전체 명단 조회를 추가하지 않는다. 봇 설치 시 추가 권한은 0으로 시작하며 Administrator·Manage Roles·Kick/Ban Members 같은 권한을 요구하지 않는다. 개별 조회와 달리 전체 명단 조회/가입·탈퇴 이벤트는 추가 intent/운영 범위를 요구하므로 향후 별도 설계로 다룬다.

필수 서버 환경변수:

| 변수 | 의미 |
| --- | --- |
| `DISCORD_CLIENT_ID` | Discord 애플리케이션 ID |
| `DISCORD_CLIENT_SECRET` | 서버 전용 OAuth 클라이언트 비밀 |
| `DISCORD_BOT_TOKEN` | 지정 서버에 추가한 봇의 서버 전용 인증 토큰 |
| `DISCORD_REDIRECT_URI` | Portal에 등록한 절대 콜백 URL |
| `DISCORD_GUILD_ID` | 접근을 허용할 단일 서버 ID |
| `DISCORD_OWNER_USER_ID` | 서비스 오너의 Discord 사용자 ID |
| `AUTH_SECRET` | 기존과 동일하게 필수인 독립 서버 비밀, trim 후 최소 32 UTF-8 bytes |

Discord ID는 decimal 문자열로 검증·저장·비교하며 JavaScript `number`로 변환하지 않는다. 콜백 URL은 운영에서 HTTPS를 필수로 하고, 개발은 명시적으로 등록한 localhost HTTP만 허용한다. 요청의 Host/전달 헤더로 콜백을 재구성하지 않는다. `READ_PASSWORD`·`OWNER_PASSWORD`·개인 접근 키는 전환 후 인증 경로에서 제거한다. `CRON_SECRET` 등 기존 비인증 설정은 별도 유지한다.

설정 검증은 기존 세션의 권한 판정에 필요한 AUTH_SECRET/GUILD_ID/OWNER_USER_ID와 새 provider 작업에 필요한 OAuth/봇 설정을 분리한다. 전자의 오류는 보호 접근을 거부하지만, 봇/OAuth 구성 오류만으로 이미 유효한 계정·세션의 DB 권한 판정을 중단하지 않는다. 신규 로그인/관리자 부여/정리는 각 경로에 필요한 provider 설정이 유효해야 수행한다.

초기 구현은 기존 서버 fetch/Web Crypto와 전용 Discord adapter를 사용한다. 인증 라이브러리 전체 도입은 이 서비스의 동적 역할·DB 세션·예약 소유권을 별도로 통합해야 하므로 이번 계획에서는 선택하지 않는다. adapter 내 사용자 OAuth와 봇 멤버 조회를 분리해 서로의 인증 토큰을 잘못 전송하지 않게 한다. BOT_TOKEN은 환경변수에서만 읽고 DB·브라우저·로그·감사·공유 캐시에 넣지 않는다.

### 2. 로그인 시작·콜백은 브라우저에 연결된 일회성 시도

- `GET /api/auth/discord`가 기존 trusted-IP/global 요청 예산을 통과한 후 로그인 시도를 생성하고 Discord로 이동한다.
- 암호학적 난수 state와 별도 브라우저 바인딩 nonce를 만든다. `oauth_login_attempts`에는 해시, 정규화한 `redirectTo`, 만료 시각만 저장하고 브라우저 nonce는 HttpOnly/SameSite=Lax 쿠키로 전달한다. 기본 만료는 10분이다.
- `GET /api/auth/discord/callback`은 누락/중복 query, state·브라우저 바인딩·만료를 검사하고 DB에서 시도를 원자적으로 소비한 뒤 code를 교환한다. 같은 시도나 code 재사용으로 두 번째 세션을 만들 수 없다. 사용자가 동의를 취소한 경우도 유효한 시도만 정리한다.
- token endpoint에는 `application/x-www-form-urlencoded`로 code를 교환한다. 응답의 identify scope·token type·만료를 검증하고 access token으로 `/users/@me`를 호출한다. 반환한 ID를 봇 멤버 조회 함수에 전달하고, 구조와 user.id 일치를 검증한다. 대상 guild는 서버 설정에서만 가져온다. 사용자 OAuth 토큰은 성공/실패를 포함한 콜백 종료 후 보관하지 않는다.
- 멤버 확인 후에만 계정 upsert·세션 생성·로그인 성공 감사를 수행한다. 이 DB 작업은 한 transaction으로 커밋한다. 감사 저장 실패 시 쿠키를 발급하지 않는다.
- 모든 역할의 기본 목적지는 `/`이다. 기존 `sanitizeRedirect`를 재사용하고, 현재 역할로 접근할 수 없는 경로는 `/`로 보낸다.
- 시작/콜백만 Proxy의 정확한 공개 경로로 추가한다. `/api/auth/...` 전체를 공개하지 않는다. 로그인 응답은 no-store이며 토큰·code·쿠키·원시 provider 오류는 로그나 화면에 노출하지 않는다.

브라우저 쿠키만으로 state를 처리하는 방식 대신 DB의 일회성 소비를 선택해 재전송과 여러 serverless 인스턴스의 동시 콜백을 같은 기준으로 판정한다.

로그인 시도 저장은 일일 Cron의 삭제량에만 의존하지 않는다. 요청 예산을 통과한 새 시도 생성 transaction에서 만료 시도를 오래된 순서로 최대 20개 삭제하고 새 시도 1개를 저장한다. 만료 인덱스와 `FOR UPDATE SKIP LOCKED`로 작업량을 제한하고 다른 생성/콜백/정리 transaction이 잠근 행은 기다리지 않는다. 유효한 시도는 삭제하지 않으며, 새 시도 저장 실패 시 삭제도 롤백한다. 지속되는 로그인 시작 요청이 정리량보다 많은 만료 행을 계속 쌓지 않게 하고, 요청이 끊긴 뒤 남은 행은 기존 일일 유지보수가 처리한다.

### 3. 로그인 계정과 관리자 부여를 독립적으로 저장

| 새 테이블 | 주요 정보/제약 |
| --- | --- |
| `auth_accounts` | UUID PK, 고유 `discord_user_id` text, 길이 제한한 username/display name, 최초 등록·최근 로그인 시각, 활성/정지 상태·정지 사유/시각, 대상 guild의 가입 상태/확인 시각·결과 version |
| `admin_grants` | UUID PK, `account_id`, 부여자·회수자 계정 ID, 부여/회수 시각; 계정당 활성 부여 하나 |
| `auth_sessions` | UUID PK, 고유한 난수 세션 토큰 해시, 계정 ID, 인증한 guild ID, 생성/절대 만료/폐기 시각; 사용자 OAuth 토큰/갱신 필드 없음 |
| `oauth_login_attempts` | state/브라우저 바인딩 해시, 내부 이동 경로, 만료/소비 상태 |
| `discord_api_controls` | 봇/서버/요청 bucket 범위의 고유 key, 차단 사유·해제 시각, 단일 재확인 lease·version; 토큰/응답 원문 없음 |
| `auth_reconciliation_runs` | 유지보수 실행 범위·진행 cursor, 실행 lease, 시작/완료 시각, 성공/정지/오류 집계; 중복 실행 방지 |

새 계정·권한·세션 테이블에는 `members`나 `riot_accounts`를 참조하는 필드/FK를 두지 않는다. 표시명 변경은 같은 Discord ID 계정의 메타데이터만 갱신한다. 최초 로그인 동시 upsert는 Discord ID 고유 제약으로 중복을 막는다. 계정 목록과 권한 상태는 오너에게만 공개한다.

등록 계정은 **Discord 서버 가입 확인 후 LLVY에 최소 한 번 로그인한 사람**이다. 서버에만 가입하고 LLVY에 로그인한 적 없는 사람은 목록에 없다. 봇 도입 후에도 전체 명단을 동기화하거나 ID 입력만으로 사전 등록하지 않는다. 이미 등록된 계정은 오래 접속하지 않았거나 활성 세션이 없어도 관리자 지정 직전 봇으로 현재 가입 여부를 확인할 수 있다.

계정의 영구 role 필드 대신 아래 순서로 요청마다 역할을 계산한다.

1. 활성 계정, 유효한 DB 세션, 현재 설정과 일치하는 대상 guild가 있어야 한다. 마지막 가입 확인 시각은 매 요청의 만료 조건으로 사용하지 않는다.
2. 사용자 ID가 현재 `DISCORD_OWNER_USER_ID`와 같으면 owner.
3. 해당 계정에 활성 `admin_grants`가 있으면 admin.
4. 나머지는 viewer.

owner도 초기 로그인·하루 1회 정리에서 서버 가입 조건을 적용받는다. 기존 owner 세션도 일반 보호 요청에서는 Discord를 호출하지 않는다. UI로 owner를 임명/회수할 수 없다. 오너 설정 변경 후 이전 오너는 현재 부여된 admin 또는 viewer로 판정된다. 환경변수 변경은 새 설정이 배포된 인스턴스부터 적용되므로 실제 전환 때 이전 인스턴스/이전 배포의 트래픽도 정리한다.

### 4. 오너 전용 등록 계정 목록에서 관리자 지정

`/admin/users`에 등록 계정 검색·페이지 목록과 관리자 부여/회수 버튼을 만든다. 표시명, username, Discord ID, 최근 로그인, 현재 권한, 가입 확인 상태/시각을 표시한다. 기본 50개·최대 100개 페이지로 제한하고 동명 계정도 ID로 구분한다. 메뉴 이름은 `사용자 권한`으로 한다.

활성인 등록 계정이 현재 서버 멤버인지 **부여 직전에 봇으로 새로 확인**한다. 대상 계정의 Discord ID로 개별 멤버 API를 호출하므로 대상의 활성 세션·사용자 OAuth 토큰·재로그인이 필요하지 않다. 표시한 마지막 가입 확인 시각만으로 부여하지 않는다. 비멤버/대기자·정지 계정·봇 설정/접근 오류·확인 장애·존재하지 않는 계정·현재 owner는 부여 대상이 아니다. 탈퇴로 정지된 계정은 정식 멤버로 재가입하고 새 로그인으로 활성화한 뒤에 지정한다. 회수는 대상의 Discord 응답이나 로그인 상태를 요구하지 않는다.

각 Action은 현재 owner를 서버에서 검증한다. 대상 계정 잠금과 활성 부여 고유 제약으로 중복 클릭/동시 부여를 직렬화하며, 부여 transaction에서는 새로 조회한 대상의 가입 확인 version이 여전히 현재 양성 결과인지 다시 확인한다. 더 최신의 거절 결과가 있으면 부여하지 않는다. 성공 감사와 같은 transaction으로 저장한다. 부여는 로그인한 viewer의 다음 보호 요청부터 반영된다. 회수는 활성 부여를 폐기하고 그 계정의 기존 세션을 모두 폐기한다. 다시 로그인하면 viewer로 이용할 수 있고, 재지정은 새 grant UUID를 사용한다.

모임원 관리 화면에서 credential 버튼과 administrator 표시를 제거한다. 모임원 삭제의 활성 관리자 guard도 제거하되, Riot 계정 연결 해제·기존 게임/감사 기록 보존은 유지한다. 이전 credential FK는 전환 migration에서 nullable/SET NULL로 바꿔 retired 기록이 모임원 삭제를 막지 않게 한다.

### 5. 사용자 OAuth 토큰 없는 DB 세션

`llvy_session` 쿠키는 새 v5 형식의 난수 세션 참조·발급/만료 정보와 서명만 담는다. 난수는 최소 256 bits이고 DB에는 해시만 저장한다. Discord 토큰·역할·프로필을 쿠키에 넣지 않는다. 기존 v4 이하 토큰은 거부한다. `AUTH_SECRET`으로 서명하며 키 교체는 전체 세션을 무효화한다. 쿠키는 HttpOnly, 운영 Secure, SameSite=Lax, Path=/이고 기존 30일을 **절대 최대 수명**으로 유지한다. 사용자 OAuth access token 만료는 발급 완료된 LLVY 세션 수명에 영향을 주지 않는다.

가입 여부는 환경변수의 봇 토큰으로 다시 조회하므로 사용자 access/refresh token 저장·암호화 키 파생·provider expiry·갱신 lease를 세션에 두지 않는다. 사용자 OAuth의 앱 연결 해제를 LLVY 로그아웃 신호로 감시하지도 않는다. 사용자는 LLVY에서 로그아웃하고, 서버 탈퇴/추방·관리자 회수·세션 만료·AUTH_SECRET 변경은 기존대로 접근을 종료한다. 봇 토큰 교체는 사용자 세션을 재발급하지 않고 이후 멤버 조회에 새 토큰을 사용한다.

로그아웃은 DB 세션 폐기 후 브라우저 쿠키를 삭제한다. Discord 호출은 필요하지 않고 DB/감사 장애에서도 로컬 쿠키 삭제는 수행한다. 만료/폐기 세션과 로그인 시도 정리는 기존 유지보수 실행에 통합하며 `CRON_SECRET`으로 보호한다.

### 6. 탈퇴 계정은 하루 1회 정리하고 기존 요청은 DB로 판정

기존 viewer/admin/owner의 조회·변경에서는 Discord를 호출하지 않는다. 매 보호 요청과 변경 transaction에서 활성 계정·유효한 세션·현재 guild·owner 설정/활성 grant를 확인한다. 마지막 가입 확인 시각이 오래되거나 정리 작업이 실패했다는 이유만으로 계정을 정지하거나 요청을 막지 않는다. 로그인과 관리자 부여는 별도로 새로운 봇 가입 확인이 있어야 성공한다.

`/api/maintenance/auth`를 CRON_SECRET으로 보호하고 하루 1회 등록된 모든 활성 계정을 대상으로 개별 멤버 조회를 실행한다. 활성 세션이 없는 계정도 포함하며 Discord 전체 명단은 가져오지 않는다. 기본 일정은 `0 3 * * *`(UTC 03:00, 한국 12:00 기준)이다. Vercel Hobby의 하루 1회 제한을 충족하고, 해당 플랜의 호출 시각 오차를 문서화한다. 기존 업로드/만료 세션 정리는 봇 조회 성공 여부와 독립적으로 수행한다.

페이지 단위·제한된 호출량/동시성/실행 시간으로 정리하고 DB lease로 중복 Cron 실행을 막는다. 초기 봇 조회 동시성은 1, 페이지는 25개, 실행은 최대 200계정·45초, 실행 lease는 120초로 두며 Discord의 bucket/전역 제한을 따른다. 실행 cursor와 완료/부분 완료·마지막 성공 시각을 저장한다. 중단된 실행은 다음 유지보수에서 남은 대상부터 이어가며, 미확인 계정을 탈퇴자로 처리하지 않는다. 운영 계정 수에서 하루 실행이 전체 대상을 처리할 수 있는지 검증하고, 부분 완료/장기 미완료를 오너 화면과 운영 기록에서 확인할 수 있게 한다.

| 확인 결과 | 처리 |
| --- | --- |
| 정식 멤버, `pending !== true` | 마지막 확인 결과/시각 갱신; 기존 세션/현재 권한은 유지 |
| 명시적 미가입(`Unknown Member` 10007)/가입 심사 대기 | 계정 접근 정지, 모든 기존 세션 폐기, 활성 관리자 grant 회수와 시스템 감사를 원자 처리; 계정/게임/과거 감사 보존 |
| 봇 인증 실패(401)·접근 불가(403)·서버 조회 오류(`Unknown Guild` 등) | 사용자 미가입으로 판정하지 않고 공유 차단기 개방; 남은 정리 조회 중단, 기존 활성 계정/권한 유지 |
| timeout·5xx·429·불완전 응답 | 해당 계정 상태/성공 시각 유지; 전역 차단/시간 예산에 따라 남은 조회를 중단하거나 부분 완료로 저장 |

명시적 거절은 로그인·관리자 부여·정리 중 어느 경로에서 발견해도 같은 계정 정지 처리를 사용한다. 재가입자는 정식 멤버 확인을 통과한 새 로그인으로 같은 계정을 다시 활성화한다. 회수된 세션/grant/예약은 되살리지 않는다. 기존 관리자는 재로그인 후 viewer이며 오너의 새 부여가 필요하다. 지정된 owner는 새 로그인 후 현재 환경변수로 owner를 판정한다.

사용자 토큰 갱신 경쟁과 세션별 refresh lease는 제거한다. 봇 조회 전체에 공유 동시성 1의 permit을 적용하되 정상 호출 경합은 즉시 장애로 반환하지 않는다. 로그인/관리자 부여는 최대 10초 동안, Cron은 남은 45초 실행 예산에서 외부 요청 timeout 5초를 남긴 범위에서 permit을 기다린다. DB transaction을 종료한 뒤 50~100ms 간격으로 재확인하고, 매번 공유 차단 상태를 먼저 검사한다. 로컬 호출 예산 소진도 같은 대기 한도 안에서 재시도하며 OAuth code 교환은 반복하지 않는다. 대기 예산 초과는 provider 장애와 구분한다. Cron은 같은 대상을 유지하며 기다리고, 예산 소진 시 cursor를 넘기거나 오류 집계를 증가시키지 않고 partial로 저장한다. 조회를 시작할 시간이 부족한 경우에도 외부 호출을 보내지 않는다. 결과 저장은 조회 전에 공유 sequence로 부여한 version의 조건부 갱신으로 순서를 보호한다. 새 확인 결과보다 오래된 응답이 계정 활성/정지 상태를 덮어쓰거나 폐기된 세션/grant를 복원할 수 없다. 계정 정지·세션 폐기·grant 회수·pending/processing 예약 실패 처리·성공 감사는 공통 계정 잠금과 한 transaction으로 처리한다. grant가 없는 owner도 예약 실패 상태로 이전 업로드의 재가입 후 복원을 막는다. 네트워크 호출과 permit 재시도 대기 중 DB transaction/행 잠금을 유지하지 않는다.

### 7. 봇 오류에는 PostgreSQL 공유 circuit breaker

로그인·관리자 부여·정리의 모든 봇 호출은 공통 adapter에서 DB 차단 상태를 먼저 확인한다. process-local 상태만으로 차단하지 않고 기존 PostgreSQL을 기준으로 하므로 Valkey 추가 운영이 필요하지 않다. key는 배포 환경·Discord 애플리케이션·guild/bucket 범위로 구분하고 토큰 값이나 응답 원문은 저장하지 않는다. 봇 토큰 교체로 진행 중인 전역 rate-limit 대기를 우회하지 않는다.

- 봇 401은 봇 인증 범위를, 403/Unknown Guild는 지정 서버 조회 범위를 **기본 60초** 차단한다. 오류 응답이 도착한 즉시 공유 상태를 갱신하고 같은 요청에서 재시도하지 않는다.
- 전역 429는 봇의 모든 멤버 조회를 `max(60초, 유효한 Retry-After)` 동안 차단한다. bucket 429는 해당 범위에서 Retry-After를 지키며 전역 429와 구분한다. 더 긴 provider 대기를 임의로 60초로 줄이지 않는다.
- 차단 기간에는 새 외부 호출 없이 재시도 가능한 결과와 대기 시간을 반환한다. 신규 로그인/관리자 부여는 진행하지 않고, 정리 작업은 남은 대상 조회를 중단한다. 기존 세션의 보호 요청·관리자 회수·로그아웃은 차단기 영향을 받지 않는다.
- 대기 후 DB의 유한 lease를 얻은 **한 인스턴스만** 시험 호출한다. 인증/조회가 정상임이 확인된 결과면 차단을 해제하고, 같은 오류면 다시 차단한다. 시험 중 다른 호출은 각 요청의 대기 예산 안에서 완료를 기다리고 성공하면 정상 조회를 이어간다. 시험이 새 차단을 열면 대기자는 외부 호출 없이 반환한다. provider 호출 전에 로컬 대기 예산이 끝난 것은 실패한 시험으로 간주하지 않는다. lease 만료로 죽은 인스턴스에서 복구하며, version 비교로 늦은 응답이 더 최신의 차단을 해제하지 못하게 한다.
- 이미 시작된 외부 호출은 취소 완료를 보장할 수 없으므로 별도 공유 요청 예산과 제한된 동시성을 유지한다. DB 차단 상태를 확인할 수 없으면 새 봇 호출을 보내지 않는다. 봇 상태 장애와 계정 정지는 분리한다.

OAuth·봇 멤버 API는 고정 Discord HTTPS URL, no-store, 제한된 응답 크기/필드 길이, 요청 timeout을 사용한다. 사용자 입력 URL이나 redirect를 따라 토큰을 보내지 않는다. HTTP 404를 모두 미가입으로 처리하지 않고 Discord error code와 응답 구조를 확인한다. 요청 예산·bucket/전역 제한·제한된 재시도를 공통 adapter에 적용한다. 정상 인증된 Unknown Member/pending은 차단기 장애와 구분해 대상 계정만 정지한다.

### 8. 실제 권한과 transaction 안의 실행자 검증

Actor는 게임 `memberId`/`credentialId` 대신 `accountId`, `discordUserId`, `sessionId`, 현재 role, 현재 `adminGrantId`, 표시명 snapshot을 가진다. `getSession`/`assertSession`/`assertAdmin`/`assertOwner`는 DB 세션과 현재 설정·권한을 확인한다. Proxy는 쿠키 형식/서명/만료만 확인하고, stale role로 보호 경로를 허용하거나 새로운 관리자를 차단하지 않는다. 계정 권한·토큰·세션은 Valkey 공유 캐시에 저장하지 않는다. 한 요청 내 중복 조회만 memoize한다.

변경 작업은 기존 `withActorTransaction`/`lockActor` 패턴을 유지하되 account/session/grant 기반으로 바꾼다. 일반 변경은 네트워크 가입 확인 없이 transaction 안에서 활성 account/session·현재 guild·현재 owner ID 또는 활성 grant를 다시 확인한다. 로그인·관리자 부여·정리는 필요한 네트워크 조회를 transaction 전에 끝낸다. 실행자의 계정 authority 공유 잠금은 commit까지 유지하고, 회수는 해당 계정 배타 잠금으로 새 session/변경과 직렬화한다. 이미 변경을 시작해 잠금을 선점한 작업은 회수 완료 전에 commit할 수 있지만, 회수 완료 후에는 이전 세션의 새 변경이 commit되지 않는다.

잠금 순서는 account authority → session → grant → business row로 통일한다. 여러 로그인 계정을 다루는 관리자 부여/회수는 관련 account ID를 정렬해 먼저 잠그고, 현재 실행자/대상의 권한을 잠금 후 재검증한다. session 생성·폐기·멤버 확인 결과 저장도 이 계정 잠금 규칙을 따른다. 오래 걸리는 replay는 최종 persistence 진입 때 다시 권한을 확인한다. viewer의 업로드/변경, admin의 계정 권한/감사 조회는 각 API·Action·DAL에서 막는다.

관리자 지정 중 명시적 가입 거절을 저장하는 경로도 대상과 실행자 계정을 UUID 순서로 함께 잠근다. `admin_grants.revoked_by` 외래키가 실행자 계정에 요구하는 잠금까지 이 순서에 포함해, 대상부터 잠그는 정지 처리와 오너부터 잠그는 권한 회수 사이의 deadlock을 방지한다. 시스템 처리에는 실행자 계정이 없으므로 대상만 잠그며, 알 수 없는 대상에 오너 계정의 가입 결과를 잘못 적용하지 않는다.

viewer도 모임원 목록·전적·게임 참가자·닉네임 검색 선택지에서 이름 원문을 받는다. 이전 change의 이름 마스킹 계약은 이 요구사항으로 대체한다. 생년은 계속 viewer 서버 payload·HTML·Client Component props에서 제거하며 자동완성 응답은 계정 ID·닉네임·태그만 포함한다. 역할별 캐시의 namespace 버전을 올려 이전 마스킹 결과를 재사용하지 않는다. 현재 권한 검증을 role별 조회 캐시 접근보다 먼저 수행하고, 관리자 회수 후 과거 관리자 역할의 캐시·렌더링 결과가 새 요청에 전달되지 않아야 한다.

### 9. 감사와 업로드는 로그인 계정·권한 부여 ID에 연결

`audit_logs`에 `actor_account_id`, `actor_discord_user_id`, `actor_admin_grant_id`를 추가한다. 새 사건은 이 필드들과 role/표시명 snapshot을 쓰며 과거 `actor_member_id`/`actor_credential_id`는 legacy 기록을 표시할 때만 읽는다. 로그인 성공/실패/취소·로그아웃, 관리자 부여/회수, 기존 변경·replay 결과를 기록한다. 거절/실패 기록의 요청 예산을 유지해 감사 저장 증폭을 제한하고, 토큰·code·state·cookie·클라이언트 비밀은 기록하지 않는다. 일반 조회 사건 전체를 추가로 추적하지 않는다.

`pending_uploads`에는 새 실행자 account/grant ID를 추가하고 새 예약은 게임 member/credential 필드를 사용하지 않는다. 처리 권한은 현재 Actor와 예약의 account/role/grant를 모두 비교한다. admin 회수 후 재지정해도 과거 grant에 연결한 예약은 처리할 수 없다. owner는 account ID를 포함해 오너 환경변수 변경 후 다른 오너가 과거 예약을 가로채지 못하게 한다. 매 API와 ingest 최종 transaction에서 현재 권한을 재검사한다.

이전 예약은 새 계정에 추정 연결하지 않는다. 사용자 처리 경로에서는 거부하고 기존 정확한 Blob store/path 기반 만료 정리에서 처리한다. maintenance는 사용자 세션 없이 CRON_SECRET으로 실행하며 legacy 실행자와 새 계정 실행자를 구분해 감사 snapshot을 남긴다. `AuditActorSnapshot`과 현재 권한을 검증한 Actor를 타입으로 분리해 과거 예약의 snapshot에 가짜 활성 세션을 만들지 않는다. nonce·Blob callback 서명·상태 전이·중복 file hash·전역 자원 예산은 유지하고, 새 account ID에 안정적인 요청 예산 키를 부여해 로그인 반복이 제한을 우회하지 않게 한다.

탈퇴 정리 감사는 CRON_SECRET으로 승인된 시스템 실행자와 대상 account/grant를 기록하며 owner나 사용자의 실행으로 위장하지 않는다. 계정 정지 및 grant 회수와 같은 transaction으로 저장하고 게임/과거 감사는 보존한다. 정지 계정의 기존 예약은 세션·권한 검증으로 처리를 막고 기존 만료 유지보수에서 정리한다.

### 10. 실패 메시지와 접근 정책

로그인 버튼은 `Discord로 로그인`으로 교체한다. 비멤버/심사 대기는 `지정된 Discord 서버의 멤버만 이용할 수 있습니다.`, 동의 취소는 `Discord 로그인이 취소되었습니다.`, 외부 확인 장애는 `Discord 가입 여부를 확인할 수 없습니다. 잠시 후 다시 시도해 주세요.`, 구성 오류는 비밀 없는 운영자 문의 문구를 사용한다.

보호 API는 unauthenticated/정지 계정/폐기 세션에 401, 유효 계정의 권한 부족에 403, DB 확인 장애에 일시 오류를 반환한다. provider 장애/차단기의 일시 오류는 새로운 가입 확인이 필요한 로그인·관리자 부여·정리 경로에만 적용한다. 페이지/Action은 같은 의미의 재로그인·권한 부족·일시 오류를 구분한다. 일시 확인 실패를 로그인 리디렉션 반복이나 영구 거절로 바꾸지 않는다. 등록 계정·권한·감사 화면은 오너 전용 no-store 응답이고 Client Component에는 필요한 DTO만 보낸다.

## Risks / Trade-offs

- [초대 링크로 들어온 사람도 자동 승인] → 지정 서버의 가입 정책이 서비스의 viewer 승인 정책임을 운영 문서에 명시한다. 추가 Discord 역할 제한은 별도 요구가 생길 때 도입한다.
- [탈퇴/추방 후 다음 일일 정리까지 접근 가능] → 보통 하루와 스케줄 지연/실행 시간이 더해진 회수 지연을 수용한다. Hobby 호출 시각 오차·부분 완료·장애 동안 지연은 더 길어지므로 24시간의 강제 상한을 약속하지 않는다. 명시적 거절 발견 시 접근·세션·관리자 권한을 즉시 회수한다.
- [Discord 장애 중 탈퇴 계정이 남을 수 있음] → 확인하지 못한 기존 계정은 유지하고 신규 로그인/관리자 부여만 차단한다. 기존 owner 세션의 회수/관리 작업은 가능하며, owner도 새 로그인에는 Discord가 필요하다. 마지막 전체 정리 성공 시각과 오류/부분 완료를 운영에서 확인한다.
- [봇 제거·토큰 폐기·서버 ID 오설정으로 가입 조회 불가] → 설정/접근 실패를 사용자 미가입과 구분하고 공유 차단기로 반복 호출을 줄인다. 최소 권한 설치·토큰 회전·서버 추가 상태 점검 절차를 문서화한다.
- [오너 환경변수 변경의 배포 전파 지연] → 트래픽 받는 모든 배포에 설정을 적용하고 이전 배포 접근을 정리한다. cookie role만으로 owner를 유지하지 않는다.
- [단일 봇 토큰으로 호출과 비밀이 집중] → 서버 비밀로만 보관하고 관리/메시지 권한을 부여하지 않는다. 요청 예산·일일 제한된 순차 조회·공유 차단기·Retry-After와 봇 토큰 비노출 검증을 적용한다.
- [OAuth 앱 연결 해제만으로 LLVY 세션은 종료되지 않음] → OAuth를 로그인 시 식별에만 사용함을 명시하고 LLVY 로그아웃·서버 가입 조건·30일 절대 수명으로 세션을 관리한다.
- [기존 관리자 역할 자동 이전 불가] → Discord 계정과 게임 모임원의 대응을 추정하지 않고 오너가 새 목록에서 지정한다.
- [현재 작업 트리의 별도 데이터/검증 변경과 겹침] → 구현 시 기존 수정 내용을 유지하며 실제 working tree를 기준으로 인증 연계 부위를 조정한다.

## Migration Plan

1. Discord Developer Portal 애플리케이션을 만들고 local/staging/production 콜백을 정확히 등록한다. 전용 봇을 지정 서버에 최소 권한으로 추가한다. CLIENT_ID/SECRET, BOT_TOKEN, GUILD_ID, OWNER_USER_ID와 독립 AUTH_SECRET을 각 배포 환경에 준비하고 멤버/비멤버/심사 대기 조회를 확인한다. 봇 설치 scope와 사용자의 identify-only 로그인 scope는 분리한다.
2. 추가형 migration으로 계정·grant·session·로그인 시도·공유 차단기·정리 실행 테이블, 감사/예약의 새 nullable 실행자 필드, retired credential의 nullable/SET NULL FK를 추가한다. 기존 게임/모임원/Riot 연결과 감사 snapshot은 변경하지 않는다.
3. staging에서 오너·일반 멤버·비멤버 로그인, 활성 세션 없는 등록 계정의 관리자 지정/회수, 봇 오류/제거·토큰 교체, 일일 탈퇴 정리·부분 실패·중복 실행·다중 인스턴스 차단기, 직접 API/Action 권한, 개인정보·업로드 검증을 완료한다. Discord 장애 중 기존 viewer/owner 요청이 외부 조회 없이 성공하고 사용자 access/refresh token이 DB에 저장되지 않음을 확인한다.
4. 전환 때 보호 작업의 트래픽을 잠시 정리하고 기존 활성 credential을 전부 revoke한다. Discord 전용 새 버전을 배포해 기존 cookie와 예약의 사용자 처리를 거부한다. 이전 암호 버전이 계속 요청을 받지 않게 한다.
5. 오너가 지정 계정으로 로그인하고, 기존 관리자들이 Discord로 로그인한 뒤 `사용자 권한`에서 수동 지정한다. 공유 암호/기존 개인 키 인증은 다시 켜지 않는다.
6. 하루 1회 인증 유지보수 Cron을 등록하고 CRON_SECRET·플랜별 실행 시각 오차·등록 계정 수에서의 전체 정리 완료를 확인한다. 운영에서 실제 성공/거절·회수와 기존 세션 거부, 봇의 개별 멤버 조회·차단기 및 만료 예약/세션/로그인 시도의 독립 정리를 확인한다. 별도 운영 증거를 남긴다.
7. 첫 전환에서는 과거 감사·retired credential 테이블을 유지한다. 제거는 이후 별도 migration으로 결정한다. rollback은 접근을 제한한 상태에서만 수행하며, revoke된 키나 이전 세션을 자동 복원하지 않는다. Discord 설정 오류 때는 신규 로그인/부여·봇 정리를 중단하고 설정/새 버전을 수정하며 기존 유효 계정의 요청은 유지한다.

로컬 완료 기준은 `npm run check`와 strict OpenSpec 검증이다. mock/PGlite 결과는 실제 Discord 동의·서버 가입 조회·Neon 동시성의 운영 증거로 간주하지 않는다.

## Open Questions

권한/계정 모델의 미결정 사항은 없다. 실제 CLIENT_ID/SECRET, BOT_TOKEN, 서버 ID, 오너 ID, 배포별 콜백 URL은 구현/운영 설정 때 입력한다. 계획 기본값은 탈퇴 정리 하루 1회(UTC 03:00), 봇 오류 차단 60초(provider 대기가 더 길면 그 시간), 로그인 시도 10분, 서비스 세션 절대 수명 30일이다.

## References

- [Discord OAuth2: Authorization Code, identify scope, state, bot authentication](https://docs.discord.com/developers/topics/oauth2)
- [Discord User Resource: current user identity](https://docs.discord.com/developers/resources/user)
- [Discord Get Guild Member: individual REST lookup](https://docs.discord.com/developers/resources/guild#get-guild-member)
- [Discord Guild Member: roles and pending membership screening](https://docs.discord.com/developers/resources/guild#guild-member-object)
- [Discord Rate Limits](https://docs.discord.com/developers/topics/rate-limits)
- [Vercel Cron Usage & Pricing: Hobby daily scheduling and timing precision](https://vercel.com/docs/cron-jobs/usage-and-pricing)
- [Discord Error Codes: Unknown Member and Unknown Guild](https://docs.discord.com/developers/topics/opcodes-and-status-codes#json-json-error-codes)
- Installed Next.js guides: `node_modules/next/dist/docs/01-app/02-guides/authentication.md`, `node_modules/next/dist/docs/01-app/03-api-reference/04-functions/cookies.md`.
