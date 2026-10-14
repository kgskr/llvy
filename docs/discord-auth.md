# Discord 로그인 설정

[문서 목록](README.md) · [Vercel 첫 배포](deployment.md)

지정한 Discord 서버의 멤버만 LLVY에 로그인할 수 있습니다.
서버에 가입 심사가 있다면 심사를 마친 계정이어야 합니다.

## Portal과 봇 설정

1. [Discord Developer Portal](https://discord.com/developers/applications)에서 애플리케이션을 만듭니다.
2. **OAuth2 → Redirects**에 사용할 환경의 콜백 주소를 등록합니다.
   - 로컬 개발: `http://localhost:3000/api/auth/discord/callback`
   - 배포: `https://<운영 도메인>/api/auth/discord/callback`
3. 같은 애플리케이션의 **Bot**에서 토큰을 발급합니다.
   [봇 설치 링크](https://docs.discord.com/developers/topics/oauth2#bot-authorization-flow)를
   `bot` scope와 permissions `0`으로 만들어 이용할 서버에 설치합니다.
4. Discord의 개발자 모드를 켜고 서버 ID와 LLVY 오너의 사용자 ID를 복사합니다.

## 환경변수

로컬은 `.env.local`, 배포는 Vercel 프로젝트 환경변수에 다음 값을 입력합니다.

| 환경변수                | 값의 출처                                   |
| ----------------------- | ------------------------------------------- |
| `DISCORD_CLIENT_ID`     | 애플리케이션의 Application ID               |
| `DISCORD_CLIENT_SECRET` | OAuth2의 Client Secret                      |
| `DISCORD_REDIRECT_URI`  | Portal에 등록한 콜백 주소와 정확히 같은 URL |
| `DISCORD_BOT_TOKEN`     | 서버에 설치한 봇의 토큰                     |
| `DISCORD_GUILD_ID`      | 이용할 Discord 서버 ID                      |
| `DISCORD_OWNER_USER_ID` | LLVY 오너로 지정할 Discord 사용자 ID        |

앱의 세션 서명용 `AUTH_SECRET`도 [환경변수 예제](../.env.example)에 따라 생성합니다.
비밀값은 서버에서만 사용하며 `NEXT_PUBLIC_` 접두사를 붙이지 않습니다.
설정을 적용한 앱에서 **Discord로 로그인**을 눌러 접속을 확인합니다.

## 역할과 관리자 지정

| 역할        | 할 수 있는 일                                                      |
| ----------- | ------------------------------------------------------------------ |
| 일반 사용자 | 경기·모임원 전적 조회와 검색                                       |
| 관리자      | 일반 사용자 기능, 리플레이 업로드, 경기·모임원·Riot 계정 연결 관리 |
| 오너        | 관리자 기능, 관리자 지정·회수와 감사로그 조회                      |

오너는 **관리 → 사용자 권한**에서 한 번 로그인한 사용자를 관리자로 지정합니다.
관리자 권한을 회수하면 해당 사용자의 기존 세션도 종료됩니다.
Discord 로그인 계정과 게임 모임원 정보는 독립적이므로 모임원을 삭제해도 로그인 계정은 삭제되지 않습니다.

## 서버 가입 상태 확인

가입 상태는 로그인할 때와 관리자 지정 시 확인하고, 예약 작업으로도 주기적으로 확인합니다.
탈퇴가 확인되면 세션과 관리자 권한이 회수됩니다. 주기적 확인에는 지연이 있을 수 있습니다.
재가입한 사용자는 다시 로그인해야 하며 관리자 권한은 오너가 다시 지정합니다.

예약 작업은 [배포 안내](deployment.md#예약-작업)의 `CRON_SECRET` 설정이 필요합니다.
오너는 **사용자 권한** 화면에서 마지막 전체 확인 완료 시각을 확인할 수 있습니다.
