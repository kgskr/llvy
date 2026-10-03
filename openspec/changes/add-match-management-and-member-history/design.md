## Context

기존 Next.js App Router·Drizzle/Postgres MVP는 인증된 이용자가 모든 기록을 관리하는 공유 운영 방식이다.
현재 목록은 25건 단위이며, 경기 날짜는 파일 시각 또는 업로드 시각의 추정치다.
모임원과 여러 Riot 계정의 연결은 이미 존재한다. 운영 서비스 연결은 아직 없다.

## Goals / Non-Goals

**Goals:** 제외·복구, 원본을 보존하는 날짜 수정/되돌리기, 모임원별 합산 전적과 페이지별 경기 조회.

**Non-Goals:** 영구 삭제/Blob 삭제, 개인 권한 체계, 챔피언 통계·기간 필터·MMR·팀 편성, 일괄 업로드.

## Decisions

1. `games.excluded_at` nullable timestamptz로 제외한다. 기본 목록/개인 집계는 NULL만 읽고,
   `?view=excluded` 목록에서 복구한다. 상세 URL은 제외 중에도 접근 가능하고 제외 상태를 표시한다.
   해시·참가자·Blob은 그대로여서 같은 파일 재업로드는 기존 제외 게임을 반환한다.
2. `games.played_at_override` nullable timestamptz를 추가한다. 기존 played_at/source를 덮어쓰지 않는다.
   목록·상세·개인 전적은 `coalesce(override, played_at)`로 정렬/표시하고 출처를 manual로 표시한다.
   날짜 입력은 명시적으로 한국 시간(UTC+09:00) datetime-local이며 서버에서 엄격 검증한다.
   실제 달력 날짜, 2009년 이후, 현재+24시간 이내만 허용하고 빈값 저장은 거부한다. 별도 원본 복원 동작은 override를 NULL로 한다.
3. Server Actions마다 assertSession, UUID/입력 검증, 존재 확인을 한다. useActionState로 처리 중·실패·성공을 제공한다.
   경기 변경 및 모임원 수정·계정 연결 변경 후 관련 games/members 경로를 재검증한다.
4. 개인 전적은 현재 연결된 계정 기준으로 즉시 집계한다. 게임은 distinct game으로 센다.
   한 게임에 해당 모임원의 참가자 계정이 둘 이상이면 연결 충돌로 보고 승패 미정/KDA 없음으로 표시해 임의 합산하지 않는다.
   단일 참가자라도 winning_team이 불명인 경기는 승패 미정이다. 승률 분모는 승+패이며 0이면 null.
   평균 K/D/A는 각 값의 null을 제외한 평균이며 데이터 없음은 null, 표시는 소수 첫째 자리.
   제외 경기는 모든 개인 집계·기록에서 제외한다. 계정이 없거나 경기가 없어도 모임원 페이지는 정상 표시한다.

### Shared implementation contracts

- `src/lib/games.ts`: `GameVisibility = "active" | "excluded"`; `listGames(limit=100, offset=0, visibility="active")`, `countGames(visibility="active")`.
- `GameListItem`에는 기존 필드를 유지. `GameDetail`에는 `excludedAt: Date|null`, `originalPlayedAt: Date`, `originalPlayedAtSource: string`, `playedAtOverride: Date|null` 추가. playedAt/source는 유효값/출처.
- `setGameExcluded(id: string, excluded: boolean): Promise<boolean>`와 `setGamePlayedAt(id: string, playedAt: Date|null): Promise<boolean>`를 games.ts에서 제공. 잘못된 UUID나 존재하지 않는 행은 false.
- `src/lib/member-history.ts`: `getMemberHistory(memberId, limit=25, offset=0)` → null 또는 `{member:{id,name,birthYear}, accounts:[{id,gameName,tagLine}], stats:{totalGames,wins,losses,undecided,winRate,averageKills,averageDeaths,averageAssists}, games:[{id,playedAt,playedAtSource,durationMs,champion,position,kills,deaths,assists,result,ambiguous}]}`. result="win"|"loss"|"unknown". winRate는 0~100 또는 null. totals는 페이지와 무관한 전체 집계.
- 모임원 목록은 기존 `listMembersWithAccounts()`를 사용한다. 개인 기록은 `/members/[id]`, 목록은 `/members`.

## Risks / Trade-offs

- 공유 인증 → 모든 로그인 사용자가 기록을 보정할 수 있음을 유지하고 UI를 관리자로 오인하게 만들지 않는다.
- 원본 날짜와 보정 날짜 혼동 → 상세에 원본/출처 표시와 원본 복원 버튼 제공.
- 오래된 탭/캐시 → 게임 변경과 계정 연결 변경에 관련 경로 재검증.
- 부계정 중복 연결 → 경기 중복 집계 방지와 연결 확인 안내. 연결 해제 후 집계 자동 복구.

## Migration Plan

추가 nullable 컬럼 2개와 적절한 인덱스만 추가한다. 기존 행은 활성 상태·원본 날짜를 유지한다.
SQL 마이그레이션 생성 후 PGlite에서 기존 데이터 보존·재적용을 확인한다. 운영 배포 전 migration 적용 필요.
앱 롤백 시 컬럼은 남겨 두되, 구버전 앱은 제외 상태를 이해하지 못하므로 구버전으로의 단순 롤백에 주의한다.

## Open Questions

없음. 기능 범위는 직전 추천 표의 3개로 한정한다.
