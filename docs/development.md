# 개발·테스트

[프로젝트 README](../README.md) · [문서 목록](README.md)

## 개발 명령

Node.js 24.x에서 `npm ci`로 의존성을 설치합니다.
앱 실행에 필요한 환경변수는 [README](../README.md#실행)를 참고하세요.

| 명령                         | 용도                                         |
| ---------------------------- | -------------------------------------------- |
| `npm run dev`                | 개발 서버 실행                               |
| `npm test`                   | 전체 테스트 실행                             |
| `npm run test:watch`         | 파일 변경 시 테스트 재실행                   |
| `npm run test:integration`   | 저장·업로드·경기 관리 DB 통합 테스트 실행    |
| `npm run test:auth-postgres` | 실제 PostgreSQL의 인증 경합·검색 통합 테스트 |
| `npm run test:redis`         | 실제 Redis의 캐시·자동완성 통합 테스트       |
| `npm run lint`               | ESLint 검사                                  |
| `npm run typecheck`          | TypeScript 타입 검사                         |
| `npm run build`              | 배포용 빌드                                  |
| `npm run format`             | 코드 포맷 검사                               |
| `npm run format:write`       | 코드 포맷 적용                               |
| `npm run check`              | 테스트 → 린트 → 타입 → 빌드 → 포맷 전체 검사 |

## 테스트

테스트는 Vitest를 사용하며 구현 파일 가까이에 `*.test.ts`로 둡니다.
기본 DB 테스트는 메모리에서 실행되는 PGlite를 사용하고, Discord와 Blob 등 외부 연동은
모의 처리합니다. 별도 서비스 자격증명 없이 `npm run check`를 실행할 수 있습니다.

`test:integration`은 일부 DB 테스트만 실행합니다. 전체 테스트는 `npm test`로 실행하세요.
실제 PostgreSQL·Redis 연결이나 리플레이 파일이 필요한 테스트는 해당 설정이 없으면
건너뜁니다. 컨테이너 환경을 구성할 수 있다면 아래 실제 PostgreSQL·Redis 테스트도
함께 실행하세요. DB·캐시 관련 변경은 기본 검사만으로 검증을 끝내지 않습니다.

특정 테스트 파일만 실행하려면 다음과 같이 지정합니다.

```bash
npx vitest run src/lib/champions.test.ts
```

## PostgreSQL·Redis 컨테이너 테스트

Docker, Podman 등 사용 가능한 도구로 테스트용 PostgreSQL 17과 Redis 7 컨테이너를
준비합니다. 특정 컨테이너 도구를 요구하지 않습니다. PostgreSQL에서는 여러 연결 사이의
잠금 경합과 검색 쿼리를, Redis에서는 실제 명령·TTL·캐시 무효화와 자동완성을 검증합니다.

컨테이너 포트는 `127.0.0.1`에 연결하고 PostgreSQL DB 이름은 `llvy_auth_test`로 지정합니다.
테스트가 데이터를 초기화하므로 개발·운영 데이터와 분리된 폐기 가능한 인스턴스를 사용하세요.

두 서비스가 연결을 받을 준비가 된 뒤 실행합니다. 아래는 PostgreSQL 포트가 `15439`,
Redis 포트가 `16379`인 예시이며 비밀번호와 포트는 만든 컨테이너 설정에 맞춥니다.

```bash
export LLVY_POSTGRES_TEST_URL="postgres://postgres:local-test-only@127.0.0.1:15439/llvy_auth_test"
export LLVY_REDIS_TEST_URL="redis://127.0.0.1:16379"

npm run test:auth-postgres
npm run test:redis
```

같은 환경변수를 설정한 상태에서 `npm run check`를 실행하면 전체 검사에도 포함됩니다.
전용 테스트 명령은 연결 설정이 없으면 실패합니다. 테스트가 끝나면 컨테이너를 정리하세요.

## 실제 리플레이 테스트

실제 `.rofl` 파일로 파싱·저장·조회를 확인하려면 파일 경로를 지정합니다.

```bash
LLVY_REPLAY_FILE="/absolute/path/to/match.rofl" npm run test:replay
```

원본은 읽기만 하며 저장소에 복사하지 않습니다. 인증과 Blob 통신은 모의 처리합니다.
전체 검사에 포함하려면 같은 환경변수로 `npm run check`를 실행하세요.

## 경기 상세 아이콘

상세 조회는 저장된 `raw_stats.ITEM0`~`ITEM6`을 검증해 최종 아이템 슬롯만 반환합니다.
0은 빈 슬롯, 누락·잘못된 값은 미확인으로 표시하며 원본 JSON은 화면에 전달하지 않습니다.
기존 경기에도 슬롯 값이 저장되어 있으면 재업로드 없이 표시됩니다. 마지막 칸은 장신구입니다.
아이템 이름은 아이콘의 툴팁과 접근성 이름으로 확인할 수 있습니다.

초상화와 아이템은 [Riot DataDragon](https://developer.riotgames.com/docs/lol#data-dragon)의
공식 버전 목록에서 경기 major/minor 패치에 일치하는 첫 버전을 사용합니다. 경기 버전이
없는 경우만 최신 버전을 사용하며, 기록된 패치가 없거나 이미지가 실패하면 자리표시자로
대체합니다. 카탈로그 조회 전체는 2초로 제한하고 같은 패치의 동시 요청을 공유합니다.
성공한 카탈로그는 조회 완료부터 24시간, 최대 8개까지 메모리에 보관합니다.
모임원 상세의 ‘플레이한 챔피언’ 표도 이름 왼쪽에 초상화를 표시합니다.
이 화면은 기존 최신 버전 챔피언 카탈로그 캐시에서 이름과 이미지 주소를 함께 읽으므로
초상화 조회를 위한 추가 카탈로그 요청은 없습니다. 이미지가 없거나 로딩에 실패하면
자리표시자를 표시하고 챔피언 이름은 유지합니다.

회귀 테스트는 `item-slots.test.ts`, `game-assets.test.ts`,
`database.integration.test.ts`, `participant-table.test.tsx`에 있습니다.

## 모임원 최근 경기 카드

최근 경기 25건을 먼저 페이지로 조회한 다음, 그 경기 ID들에 해당하는 참가자를 한 번에
읽습니다. 경기 수와 무관하게 추가 조회는 한 번이며 빈 페이지는 생략합니다.
현재 모임원의 `LEVEL`과 `ITEM0`~`ITEM6`만 SQL에서 추출하고, 다른 참가자는 이름·태그·팀·
포지션·챔피언·현재 모임원 여부만 반환합니다. 원본 `raw_stats`, PUUID, 참가자의 생년은
목록이나 캐시에 전달하지 않습니다. 스키마 변경 없이 기존 game_id 선두 복합 인덱스를 활용합니다.

`member-history-v2` 키로 기존 형식과 분리하고 기존 60초 조회 캐시·쓰기 이후 무효화를
공유합니다. 캐시 적중 시 추가 참가자 조회는 없지만 세션 확인과 현재 모임원 식별 조회는
계속 수행합니다. 상세 링크의 자동 prefetch도 꺼서 카드 수만큼 상세 조회가 발생하지 않게 합니다.

아이콘은 페이지의 경기 버전별로 모아 기존 DataDragon 캐시를 이용합니다. 여러 버전이
섞인 과거 페이지는 최대 8개 버전을 동시에 조회합니다. 이미지는 지연 로딩하며 원본을 DB에
저장하지 않습니다. 레벨은 정수 1~99만 표시하고 누락·잘못된 값은 ‘—’로 표시합니다.
계정 중복 연결 경기는 본인 레벨·아이템을 임의로 선택하지 않고 기존 경고를 유지합니다.
화면의 블루·레드 팀은 참가자의 팀 ID에 따른 구분이며, 확인할 수 없는 팀도 별도로 표시합니다.

`match-management.integration.test.ts`에서 페이지 범위와 추가 쿼리 1회를,
`query-cache.integration.test.ts`에서 실제 로컬 Redis 캐시 재사용을 검증합니다.
`real-replay.integration.test.ts`의 opt-in 검사는 실제 파일의 파싱 값과 카드 조회 값을 비교합니다.

## 게임 목록 참여자

게임 목록은 전체 기록·제외된 경기 모두 10경기씩 표시합니다. `listGamesWithParticipants`가
경기 페이지를 먼저 선택한 다음, 해당 ID의 참가자·계정·모임원 이름을 한 번에 읽습니다.
따라서 캐시 미적중 시 총 개수 1회 + 경기 페이지 1회 + 참가자 1회이며, 빈 페이지에서는
참가자 조회를 생략합니다. 원본 통계·PUUID·생년은 선택하지 않습니다. 기존 `listGames`
요약 DTO는 유지합니다.

`game-list-v2` 키는 기존 형식과 분리하며 60초 캐시와 역할별 분리, 읽기 전 인증,
쓰기 이후 무효화를 재사용합니다. 모임원 이름 변경·계정 연결/해제·모임원 삭제도 목록을
무효화합니다. 캐시 적중 시 게임 목록용 DB 조회는 없지만 세션 확인은 계속 수행합니다.

로우는 블루 승리 `#28344e`, 레드 승리 `#59343b`로 채우고, 승리 팀 미확인은 중립색으로
표시합니다. 팀별 참여자는 TOP·JUG·MID·BOT·SUP 순서이며 모임원 이름을 우선 표시하고
미연결 계정만 전체 라이엇 ID로 표시합니다. 초상화는 최신 챔피언 이름/이미지 공유 캐시를
사용하며 누락 시 자리표시자를 표시합니다. 참가자가 없는 페이지는 카탈로그 조회도 생략합니다.
상세·모임원 링크는 자동 prefetch를 끄고, 기존 제외 경기 복구 권한과 목록 이동 정보를 유지합니다.

## 관련 문서

- [내부 구조](architecture.md): 데이터 모델과 주요 처리 흐름
- [OpenSpec](../openspec/README.md): 현재 요구사항과 변경 이력
