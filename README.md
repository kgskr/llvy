# LLVY

리그 오브 레전드 소모임 롤리브영의 전적을 관리하는 웹 앱입니다.
`.rofl` 리플레이 파일을 업로드하면 경기 정보와 참가자 전적을 추출해 보관합니다.

- 리플레이 업로드와 경기 목록·상세 조회
- 게임 목록: 10경기씩, 승리 팀 배경과 양 팀 모임원 이름·챔피언 초상화 표시
- 경기 상세의 챔피언 초상화와 최종 아이템 아이콘(장신구 포함)
- 모임원과 Riot 계정·부계정 연결, 전적 합산
- 모임원 이름·닉네임 검색, 챔피언·포지션별 통계
- 모임원 최근 경기 카드: 승패·날짜, 초상화·레벨, KDA·아이템, 양 팀 참가자
- Discord SSO를 통한 접근제어

## 실행

Node.js 24.x, PostgreSQL, Vercel Blob, Discord 애플리케이션과 서버에 설치한 봇이 필요합니다.
현재 DB 드라이버의 연결 조건은 [배포 안내](docs/deployment.md#postgresql)를 참고하세요.
선택적으로 [Redis](docs/redis.md)를 연결해 조회와 자동완성에 캐시를 사용할 수 있습니다.

```bash
npm ci
cp .env.example .env.local
```

[환경변수 예제](.env.example)를 참고해 `.env.local`을 채웁니다.
서비스 연결은 [배포 안내](docs/deployment.md), Discord 설정은 [인증 안내](docs/discord-auth.md)를 참고하세요.

새 DB를 사용하는 첫 실행에서는 `npm run db:migrate`로 테이블을 초기화합니다.

```bash
npm run db:migrate
npm run dev
```

[localhost:3000](http://localhost:3000)에서 Discord로 로그인합니다.
지정한 Discord 서버의 가입 심사를 마친 멤버만 이용할 수 있습니다.

## 사용

1. 오너는 **관리 → 사용자 권한**에서 로그인한 사용자를 관리자로 지정합니다.
2. 관리자·오너는 리플레이를 업로드하고 **관리**에서 모임원과 Riot 계정을 연결합니다.
3. **모임원** 또는 이름·닉네임 검색으로 연결된 계정의 전적을 확인합니다.

## 문서

- [Vercel 첫 배포](docs/deployment.md)
- [Discord 인증](docs/discord-auth.md)
- [Redis 캐시](docs/redis.md)
- [개발·테스트](docs/development.md)
- [전체 문서](docs/README.md)
