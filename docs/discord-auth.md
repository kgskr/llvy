# Discord 로그인 설정

[문서 목록](README.md) · [Vercel 첫 배포](deployment.md)

지정한 Discord 서버의 멤버만 LLVY에 로그인할 수 있습니다.
서버에 가입 심사가 있다면 심사를 마친 계정이어야 합니다.

## 로그인 버튼 디자인

로그인 버튼은 [Discord Social SDK의 공식 브랜딩 가이드](https://docs.discord.com/developers/discord-social-sdk/design-guidelines/branding-guidelines)의
Blurple 예시를 바탕으로 45도 그라데이션(`#4752C4` → `#6571F3`), 흰색 로고·글자,
40px 모서리와 로고 주변 여백을 적용합니다. 웹 로그인 화면에 맞춰 기존 글꼴과
`Discord로 시작하기` 문구를 사용합니다. 카드 상단에는 큰 `LLVY` 제목만 가운데 정렬합니다.

로고는 [공식 브랜드 페이지](https://discord.com/branding)에서 제공하는
[흰색 심볼 SVG](https://cdn.prod.website-files.com/6257adef93867e50d84d30e2/66e3d7f4ef6498ac018f2c55_Symbol.svg)의
경로·색상·비율을 유지한 인라인 SVG입니다. 로그인 전에도 외부 이미지 요청 없이 표시되며,
보조기기에는 중복으로 읽히지 않습니다. 키보드 포커스 테두리와 최소 48px 클릭 높이를 제공합니다.

## 가입하기 링크

`Discord로 시작하기` 아래의 `가입하기`는 Discord 로고 없는 연한 보라색 테두리 버튼입니다.
두 버튼 사이에는 여백과 가는 구분선을 두고 `아직 모임원이 아니라면?` 문구를 가운데 표시합니다.
클릭하면 같은 탭에서 [기본 소모임 가입 페이지](https://www.somoim.co.kr/9ee6188a-6000-11ee-be3e-0ae46c4721911)로 이동합니다.

주소를 바꾸려면 `.env.local` 또는 배포 환경에 `MAIN_SIGNUP_URL`을 설정합니다.
`NEXT_PUBLIC_` 접두사 없이 서버에서 읽고, 최종 링크만 화면에 표시합니다.

```dotenv
MAIN_SIGNUP_URL="https://www.somoim.co.kr/9ee6188a-6000-11ee-be3e-0ae46c4721911"
```

사용자명·비밀번호가 포함되지 않은 절대 HTTP(S) URL을 사용합니다.
변수가 없거나 공백이거나 올바르지 않은 URL이면 기본 주소를 사용합니다.
로컬 서버는 설정 변경 후 재시작하고, Vercel에서는 적용할 환경에 저장한 뒤 다시 배포합니다.

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
설정을 적용한 앱에서 **Discord로 시작하기**를 눌러 접속을 확인합니다.

## 역할과 관리자 지정

| 역할        | 할 수 있는 일                                                  |
| ----------- | -------------------------------------------------------------- |
| 일반 사용자 | 경기·모임원 전적 조회와 검색, 기존 모임원 화면의 생년 조회     |
| 업로더      | 일반 사용자 기능, 웹·Windows 앱 리플레이 업로드                |
| 관리자      | 업로더 기능, 경기·모임원·Riot 계정 연결 관리, 업로더 부여·회수 |
| 서비스 오너 | 관리자 기능, 관리자 지정·회수와 감사로그 조회                  |

관리자와 오너는 **관리 → 사용자 권한**에서 로그인한 일반 사용자에게 `업로더 권한 부여` 또는 `업로더 권한 회수`를 실행합니다. 관리자는 관리자 지정·회수 controls와 가입 점검 운영 정보를 볼 수 없습니다. 관리자 지정·회수와 감사 조회는 오너만 할 수 있습니다.

업로더/관리자 권한 회수는 해당 계정의 기존 웹 로그인·기기 연결·미완료 승인을 종료합니다. 업로더를 관리자로 승격해도 기존 업로더 grant와 연결은 폐기하므로 다시 로그인해야 합니다. 관리자 권한을 회수하면 일반 사용자가 되며 이전 업로더 권한은 복구하지 않습니다. 재부여에는 새 grant ID를 사용합니다.

모든 로그인 역할은 기존 모임원 조회에서 생년을 볼 수 있습니다. 자동완성·검색 suggestion·팀 명단·관계 요약의 최소 필드는 확장하지 않습니다. 오너 감사 화면에는 제출자·당시 역할/grant·업로드 ID·파일명·서버 SHA-256·채널·결과·게임 ID가 남습니다. 게임 삭제 후에도 감사는 보존하고 삭제 상태를 표시합니다.

Discord 로그인 계정과 게임 모임원 정보는 독립적이므로 모임원을 삭제해도 로그인 계정은 삭제되지 않습니다.

## 서버 가입 상태 확인

가입 상태는 로그인할 때와 업로더/관리자 부여 시 확인하고, 예약 작업으로도 주기적으로 확인합니다.
탈퇴가 확인되면 세션과 업로더·관리자 권한이 회수됩니다. 주기적 확인에는 지연이 있을 수 있습니다.
재가입한 사용자는 다시 로그인해야 하며 일반 사용자로 돌아갑니다. 업로더는 관리자/오너, 관리자는 오너가 다시 지정합니다.

예약 작업은 [배포 안내](deployment.md#예약-작업)의 `CRON_SECRET` 설정이 필요합니다.
오너는 **사용자 권한** 화면에서 마지막 전체 확인 완료 시각을 확인할 수 있습니다.

## Windows 기기 연결

기존 Discord redirect URI와 OAuth scope는 유지한다. 업로더/관리자/오너는 `/desktop/connect`에서 업로더를 명시적으로 승인하고 `/desktop/devices`에서 본인 연결을 해제한다. [기기 수명·refresh 회수·owner 변경 절차](desktop-uploader.md#연결과-해제)는 서버 업로더 안내에서 관리한다.
