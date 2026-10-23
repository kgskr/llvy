# LLVY

리그 오브 레전드 소모임 [롤리브영](https://www.somoim.co.kr/9ee6188a-6000-11ee-be3e-0ae46c4721911)의 운영을 돕기위한 웹앱니다.

개인적이나 타 모임에서의 사용도 가능합니다.(포크를 통해 이용해주시면 감사하겠습니다.)

Vercel과 파트너(Neon, Upstash 등)를 통해 무료로 배포 할 수 있게끔 만들고 있습니다.\
이로인해 100명 이상의 단체에서는 사용량에 관한 문제가 있을수 있습니다.

## 기능소개

- 리플레이 파일 업로드 기반의 사용자 지정 게임 목록·상세 조회
- 게임 목록: 10경기씩, 승리 팀 배경과 양 팀 모임원 이름·챔피언 초상화 표시
- 경기 상세의 챔피언 초상화와 최종 아이템 아이콘(장신구 포함)
- 모임원과 Riot 계정·부계정 연결, 전적 합산
- 모임원 이름·닉네임 검색, 챔피언·포지션별 통계
- 모임원 최근 경기 카드: 승패·날짜, 초상화·레벨, KDA·아이템, 양 팀 참가자
- Discord SSO를 통한 접근제어
- 일반 사용자·업로더·관리자·서비스 오너 권한 분리, 업로더 위임과 파일별 감사

모든 로그인 사용자는 모임원 생년을 조회할 수 있습니다. 업로더는 일반 조회와 리플레이 업로드를 할 수 있고 관리자·서비스 오너가 부여/회수합니다. 자세한 범위는 [사용자 권한](docs/discord-auth.md#역할과-관리자-지정)을 따릅니다. 새 역할은 로컬 구현 상태이며 적용 절차와 미검증 범위는 [검증 기록](docs/validation/2026-10-19-uploader-role.md)에 남깁니다.

## 배포

Vercel 환경에서의 배포를 기준으로 하고 있으며 추가적으로 PostgreSQL, Vercel Blob, Discord 애플리케이션과 서버에 설치한 봇이 필요합니다.
현재 DB 드라이버의 연결 조건은 [배포 안내](docs/deployment.md#postgresql)를 참고하세요.
선택적으로 [Redis](docs/redis.md)를 연결해 조회와 자동완성에 캐시를 사용할 수 있습니다.

자세한 사항은 아래 첫 배포 문서를 확인해주세요.

## 문서

- [Windows 업로더 서버 구현과 검증 범위](docs/desktop-uploader.md)

- [Vercel 첫 배포](docs/deployment.md)
- [Discord 인증](docs/discord-auth.md)
- [Redis 캐시](docs/redis.md)
- [개발·테스트](docs/development.md)
- [전체 문서](docs/README.md)

## 라이선스

프로젝트 기여자가 권리를 보유한 자체 코드와 문서는
[PolyForm Noncommercial 1.0.0](LICENSE)에 따라 비상업적 사용·수정·재배포를 허용합니다.
재배포할 때는 라이선스와 필수 고지를 유지해야 합니다. 상업적 이용을 일반적으로 허용하는
라이선스는 아니며, 허용 목적과 비영리·교육·정부기관 등의 이용 범위는 라이선스 원문을 따릅니다.

Required Notice: LLVY (https://github.com/kgskr/llvy)

Riot Games 자료, Discord 로고, 외부 의존성·데이터 및 모임원이 제공한 배너 이미지는 이 라이선스의
적용 대상에서 제외합니다. 배너는 LLVY에서 사용하도록 제공받았으며, 이 저장소가 제3자에게
수정·재배포 권한을 부여하지는 않습니다. 자세한 범위와 출처는
[외부 자료 및 권리 안내](THIRD_PARTY_NOTICES.md)를 참고하세요.

LLVY는 Riot Games가 보증하거나 후원하는 서비스가 아닙니다. Riot Games 관련 자료와
상표에는 [Riot Games 정책](https://www.riotgames.com/en/legal) 및
[개발자 정책](https://developer.riotgames.com/policies/general)이 별도로 적용됩니다.
