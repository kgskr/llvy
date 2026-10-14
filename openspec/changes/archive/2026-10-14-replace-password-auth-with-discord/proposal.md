> 이 디렉터리는 완료된 변경의 당시 설계·구현 기록이다. 현재 요구사항은 [주 명세](../../../specs)를 따른다. 여기에 남은 제공자·리전·인증 전환 설명은 신규 배포 지침이 아니다.

## Why

공유 암호와 모임원별 관리자 키 대신 Discord 로그인으로 지정 서버의 멤버만 LLVY에 접근하게 한다. 로그인 계정과 게임 모임원을 분리하고, 서비스 오너가 가입한 로그인 계정 중 관리자를 선택하며 오너 자신은 환경변수의 Discord 사용자 ID로 지정한다.

## What Changes

- **BREAKING** `READ_PASSWORD`·`OWNER_PASSWORD`·개인 관리자 접근 키를 Discord OAuth2 로그인으로 교체하고 기존 v4 이하 세션을 거부한다.
- 사용자 OAuth는 `identify`만 요청해 Discord 사용자 ID를 확인하고, `DISCORD_BOT_TOKEN`으로 `GET /guilds/{DISCORD_GUILD_ID}/members/{user_id}`를 호출해 지정 서버 가입 여부를 확인한다. 멤버는 자동 등록·로그인하고, 비멤버와 가입 심사 대기자는 거절한다. 봇 설정/접근 오류와 조회 장애는 비멤버 판정과 구분한다.
- 성공적으로 로그인한 계정의 Discord 사용자 ID와 최소 표시 정보를 별도 계정 테이블에 저장한다. 모든 로그인 계정은 `members`·`riot_accounts`·게임 참가자와 연결하지 않는다.
- 서버 가입 확인을 전제로 `DISCORD_OWNER_USER_ID` 일치 계정은 owner, 오너가 지정한 계정은 admin, 나머지는 viewer가 된다.
- 오너 전용 등록 계정 목록에서 관리자 권한을 부여·회수한다. 대상이 오래 접속하지 않았거나 활성 세션이 없어도 봇으로 현재 가입 여부를 확인해 지정한다. 목록의 대상은 LLVY에 로그인한 계정이며 Discord 서버 전체 명단은 가져오지 않는다.
- 사용자 access token은 로그인 콜백의 사용자 조회에만 사용하고 영구 저장하지 않으며, refresh token은 사용·저장하지 않는다. 기존 보호 요청은 DB의 활성 계정·세션·현재 권한만 확인하고 Discord를 호출하지 않는다. 로그인과 관리자 부여에는 새로운 가입 확인이 필요하다.
- 하루 1회 등록된 활성 계정의 서버 가입 여부를 봇으로 확인한다. 명시적으로 탈퇴/추방·가입 심사 대기가 확인되면 계정 접근을 비활성화하고 모든 세션과 활성 관리자 부여를 회수한다. 계정·게임·감사 기록은 보존하며, Discord 장애 시 확인하지 못한 계정은 유지한다.
- 봇 401/403·전역 429에는 PostgreSQL에 공유 circuit breaker를 두고 호출을 잠시 중단한다. 기본 중단은 60초이며, 더 긴 Discord Retry-After는 그대로 지킨다. 여러 인스턴스가 중단과 단일 재확인 상태를 공유한다.
- 감사로그와 업로드 예약의 실행자 식별을 게임 모임원·접근 키에서 로그인 계정·관리자 권한 부여 기록으로 전환한다. 일반 사용자에게도 모임원 이름을 원문으로 표시하며, 오너 전용 감사 조회, viewer의 생년 숨김, 기존 업로드·데이터 관리 범위는 유지한다.
- 기존 모임원 화면의 관리자 키 발급/회수 및 관리자 연계 삭제 제한을 제거한다. 기존 관리자 키를 Discord 계정으로 자동 변환하지 않는다.

## Capabilities

### New Capabilities

- `discord-authentication`: identify-only Discord OAuth2 시작·콜백, 봇의 개별 서버 멤버 확인, 자동 계정 등록, 구성·오류·로그인 요청 제한과 공유 호출 차단기.
- `login-account-administration`: 게임 모임원과 독립된 로그인 계정, 환경변수 기반 오너 판정, 오너 전용 계정 목록과 관리자 부여·회수.
- `discord-session-authorization`: 사용자 OAuth 토큰 없는 DB 세션, Discord 장애와 독립된 기존 요청 처리, 하루 1회 탈퇴 계정 정리, 현재 권한 검증·회수 직렬화, 기존 개인정보·역할별 접근 보장.
- `account-audit-upload-binding`: 로그인 계정 기반 감사 실행자와 업로드 소유권, 재지정 시 과거 권한 재사용 차단, 이전 기록·예약의 전환 처리.

### Modified Capabilities

없음. 현재 `openspec/specs/`에 확정된 spec이 없다. 기존 완료 change의 `owner-managed-access`·`administrative-audit`·`member-privacy`와 실제 코드를 기준으로 위 후속 요구사항을 정의하며, 과거 change의 구현 완료 기록은 수정하지 않는다.

## Impact

- 인증/설정: `src/lib/auth.ts`, `session.ts`, `login.ts`, `login-throttle.ts`, `env.ts`, `src/proxy.ts`, 로그인 화면/Action, 새 Discord 시작·콜백 Route Handler.
- 계정/권한: `src/db/schema.ts`, Drizzle migration, 새 계정·세션·관리자 부여 저장소, `src/lib/admin-credentials.ts`, 관리 페이지/오너 Action, `src/lib/members.ts`, `member-mutations.ts`.
- 감사/업로드: `src/lib/audit.ts`, `upload-actor.ts`, `pending-upload-store.ts`, `expired-upload-cleanup.ts`, ingest와 업로드 API, 감사 화면.
- 검증/운영: 인증·권한·동시성·개인정보·업로드 회귀, `.env.example`, README와 개발/배포/아키텍처 문서, 하루 1회 CRON_SECRET 보호 유지보수와 실행 상태, Discord Developer Portal의 콜백/봇 설정과 서버에 봇 추가·실제 로그인/멤버 조회 검증 절차.
- 외부 연동은 Discord HTTPS OAuth2/API이다. 기존 Web Crypto·서버 fetch·Drizzle을 사용하고 지정 서버에 멤버 조회용 봇을 추가한다. 별도 상시 봇 프로세스·Gateway 연결·전체 서버 명단 조회·새 인증 플랫폼은 추가하지 않는다. 원격 배포와 운영 DB 변경은 이 계획 수정에 포함하지 않는다.
