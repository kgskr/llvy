# 내부 구조

[프로젝트 README](../README.md) · [문서 목록](README.md)

## 코드와 저장 모델

| 위치                                        | 역할                         |
| ------------------------------------------- | ---------------------------- |
| [`src/app/`](../src/app/)                   | 화면, Server Actions와 API   |
| [`src/lib/rofl/`](../src/lib/rofl/)         | 리플레이 메타데이터 파싱     |
| [`src/lib/ingest.ts`](../src/lib/ingest.ts) | 계정 식별과 트랜잭션 저장    |
| [`src/db/schema.ts`](../src/db/schema.ts)   | 테이블과 제약조건            |
| [`src/lib/limits.ts`](../src/lib/limits.ts) | 업로드·로그인·파싱 처리 한도 |
| [`drizzle/`](../drizzle/)                   | SQL 마이그레이션             |

DB에는 모임원(`members`), Riot 계정(`riot_accounts`), 경기(`games`),
경기 참가자(`game_participants`), 업로드 바인딩(`pending_uploads`),
공유 요청 제한(`request_budgets`), Discord 계정(`auth_accounts`), 관리자 권한(`admin_grants`),
세션(`auth_sessions`), OAuth 시도(`oauth_login_attempts`), 봇 차단(`discord_api_controls`),
정리 진행(`auth_reconciliation_runs`), 감사(`audit_logs`)를 저장합니다.
이전 `admin_credentials`는 retire하고 이력만 보존합니다. 원본 리플레이는 Blob에 보관합니다.

## 계정 연결과 모임원 전적

계정은 PUUID를 우선 사용하고, 없는 리플레이는 Riot ID의 이름·태그로 식별합니다.
처음 보는 계정은 모임원에 연결하지 않은 상태로 저장됩니다.
미연결 목록에는 활성 경기에서 발견한 계정만 표시하고 게임 수도 활성 경기만 집계합니다.
제외 경기에만 남은 계정과 경기 기록이 없는 계정은 표시하지 않으며, 경기 복구 시 다시 표시됩니다.
관리 화면의 모임원·미연결 계정 표는 각각 10개씩 독립적으로 페이징합니다. 모임원 ID를 먼저
페이징한 뒤 계정을 연결하므로 한 모임원의 계정 수에 따라 페이지 인원이 줄지 않습니다.
계정 연결 선택 목록은 표의 현재 페이지와 관계없이 모든 모임원을 포함합니다.

같은 Riot ID의 기존 계정이 하나뿐이고 모임원에 연결되지 않았을 때만 PUUID를 추가합니다.
이미 연결된 계정은 업로드된 PUUID로 변경하지 않습니다. 새 PUUID 계정은 미연결로
남으므로 관리 화면에서 검토해 연결해야 합니다. 여러 신원이 같은 이름을 쓰는 경우도
자동 병합하지 않습니다.

모임원 전적은 현재 연결된 모든 계정의 활성 경기를 합산합니다. 계정 연결·해제는
과거 전적에도 즉시 반영되며, 페이지는 25건 단위이고 전체 통계는 페이지와 무관합니다.
승률은 승패가 확인된 경기만, 평균은 해당 값이 있는 경기만 계산합니다.
한 경기에 같은 모임원의 계정이 여러 개 연결되면 경기 수는 한 번만 세고 승패·평균에서는
제외합니다. 화면의 중복 연결 안내를 보고 연결을 바로잡으면 다시 집계됩니다.

모임원 삭제는 관리자·오너가 실제 `DELETE`로 처리합니다. 연결 계정의 `member_id`·`linked_at`을
비우고 모임원을 삭제하며 이전 credential의 FK는 SET NULL로 이력을 보존합니다.
Discord 계정·grant에는 게임 멤버 FK가 없어 삭제가 로그인 권한에 영향을 주지 않습니다.
계정·참가자·경기·과거 감사는 보존하고 연결 해제와 삭제 감사도 같은 transaction에 저장합니다.
계정 연결도 대상 모임원을 먼저 잠가 삭제와 business row의 잠금 순서를 맞춥니다.

## 경기 날짜·코멘트와 제외

원본 날짜는 파일의 `lastModified`에서 한국 날짜를 추출하고, 없으면 업로드한 한국 날짜를 사용합니다.
출처는 `games.played_at_source`에 기록합니다. 직접 수정한 날짜는
`games.played_at_override`에 별도로 저장하므로 원본 날짜로 되돌릴 수 있습니다.
두 날짜 열은 PostgreSQL `date`이며 앱에는 `YYYY-MM-DD` 문자열로 전달합니다.
관리 입력은 날짜만 받으며 2009년 1월 1일부터 한국 날짜 기준 내일까지 허용합니다.
기존 시각은 `AT TIME ZONE 'Asia/Seoul'`로 변환 후 날짜만 남깁니다. 업로드·제외·감사 시각과
경기 진행 시간은 운영 이력과 통계에 사용하므로 그대로 유지합니다.

경기당 코멘트 하나를 `games.comment`에 저장합니다. 관리자·오너가 추가·수정·비우고,
일반 사용자는 읽을 수 있습니다. 공백을 포함한 Unicode 코드 포인트 30개까지 허용하며
문자열을 자르거나 공백을 제거하지 않습니다. 빈 문자열은 `NULL`로 처리합니다.
서버 검증과 DB `char_length` 제약을 함께 사용하며 변경 전후와 감사로그를 원자적으로 저장합니다.

제외한 경기는 `games.excluded_at`으로 표시하며 기본 목록과 모임원 집계에서 빠집니다.
경기·참가자·Blob은 보존되고 복구할 수 있습니다. 같은 파일을 다시 올려도 중복 생성하거나
자동 복구하지 않습니다.

## 업로드와 원본 보존

1. 브라우저가 `POST /api/uploads`로 업로드를 시작합니다. 서버는 업로드 ID, nonce,
   예약 경로 `replays/<uploadId>.rofl`과 Blob 접근 모드를 발급하고 nonce는 해시로 저장합니다.
   관리자·오너만 시작할 수 있으며 예약에 실행자 역할·로그인 account·Discord ID·grant를 저장합니다.
2. `/api/blob/upload`는 유효한 바인딩에만 정확히 그 경로의 업로드 토큰을 발급합니다.
   덮어쓰기와 랜덤 접미사는 허용하지 않습니다. 브라우저가 Blob으로 직접 업로드하므로
   원본 파일을 앱 함수의 요청 본문에 넣지 않습니다. read-write 토큰은 서버에만 남습니다.
3. `/api/process`는 nonce·상태·만료, 현재 토큰의 스토어와 접근 모드, 예약 경로를
   검증한 뒤 원본을 가져옵니다. 현재 account/role/grant가 예약과 일치하는 사용자만 처리할 수 있습니다. URL의 query·fragment는 제거하며 다른 스토어·경로와
   다운로드 리디렉션은 거부합니다. private 파일은 검증된 URL에 서버 토큰으로 접근합니다.
4. 실제 파일을 파싱해 현재 권한을 다시 확인하고 하나의 트랜잭션으로 저장합니다.
   저장과 성공 감사로그는 원자적으로 기록하고 업로드 ID로 성공·중복·실패 사건을 연결합니다. 중복·파싱 실패 시에는 해당
   바인딩에 묶인 새 Blob만 삭제하고 기존 경기의 원본은 보존합니다.
5. 바인딩은 한 번 처리하면 소비되며 발급 후 30분에 만료됩니다. 성공 후 상태 기록은
   한 번 재시도합니다. 기록 실패나 DB 커밋 결과가 불확실한 오류에서는 원본을 보존합니다.
6. 만료 바인딩과 사용하지 않는 원본은 [정리 작업](deployment.md#만료-업로드-정리)이
   처리합니다. 게임이 참조하는 원본은 삭제하지 않습니다.

관련 구현은 [`pending-upload.ts`](../src/lib/pending-upload.ts),
[`pending-upload-store.ts`](../src/lib/pending-upload-store.ts),
[`blob-store.ts`](../src/lib/blob-store.ts),
[`expired-upload-cleanup.ts`](../src/lib/expired-upload-cleanup.ts)에 있습니다.

## 조회 캐시와 이름·닉네임 검색

조회 모델은 세션 확인 후 [Valkey](valkey.md)에 역할별로 투영한 결과를 60초간 캐시합니다.
데이터 변경 커밋 후 공유 세대 UUID를 교체하며 이전 조회는 캡처한 세대에만 저장합니다.
인증 계정·세션·grant·감사·요청 제한은 캐시하지 않습니다. 모임원 상세는 통계 캐시와 별개로
현재 DB의 모임원 존재·이름을 확인하며 일반 사용자에게 생년을 전달하지 않습니다.

메인 폼은 `GET /search?q=...`, 자동완성은 `/api/search/autocomplete?q=...`를 사용합니다.
[`nickname-search.ts`](../src/lib/nickname-search.ts)는 모든 등록 모임원의 이름과 활성 경기가 있는
연결 Riot 계정을 함께 검색합니다. 계정·경기가 없는 모임원도 이름으로 찾을 수 있습니다.
기존 `nickname` 전용 URL은 Riot ID 검색과 `{ id, gameName, tagLine }` 응답을 유지합니다.

새 자동완성은 `member`와 `riot-account` 후보를 구분합니다. 모임원은 ID·이름·최대 2개 연결 Riot ID,
계정은 ID·닉네임·태그만 전달합니다. 생년·Discord 로그인 계정 정보는 포함하지 않습니다.
후보는 종류별 우선 5개, 빈자리를 다른 종류에 배정해 합계 10개이며 모임원이 먼저 표시됩니다.
같은 종류 안에서는 정규화한 이름/Riot ID의 UTF-8 바이트와 UUID 순서로 정렬합니다.

[`autocomplete-index.ts`](../src/lib/autocomplete-index.ts)의 내부 도구를 통해 Riot 인덱스
`autocomplete:v1`과 이름 인덱스 `member-autocomplete:v1`을 별도로 게시합니다. 이름과 계정 미리보기는
한 번의 join 조회로 구성합니다. 두 인덱스는 Sorted Set·최소 표시 Hash·완료 표식, 원자 게시,
60초 TTL·세대 무효화·동시 재구축 병합을 공유합니다. Valkey 장애 시 DB 결과로 대체하고,
어느 DB 소스든 실패하면 불완전한 성공 목록을 반환하지 않습니다.

자동완성은 NFC·trim·소문자 정규화 후 접두어를 찾습니다. 제출의 `resolveSearchMember()`는 현재 DB에서
이름 또는 Riot ID를 정확히 일치시킨 뒤 모임원 UUID로 합칩니다. 한 명이면 전적, 여러 명이면
20명씩 페이지가 있는 선택 목록, 없으면 `/search/not-found`입니다. 이름과 다른 사람의 닉네임이
같아도 모두 선택지로 표시합니다. 이름 후보는 `/members/{id}`, Riot 후보는 기존
`/search?nickname=...`로 이동해 현재 연결을 확인합니다. 검색 읽기는 감사로그 대상이 아닙니다.

직접 제출은 `members.normalized_name`과 `riot_accounts.normalized_game_name`의 hash 인덱스로
정확 일치 후보를 찾습니다. 이름·Riot 결과는 SQL `UNION`으로 모임원 UUID를 합친 뒤 총수와
20명 페이지를 계산하며, 페이지 안의 모임원별 계정 미리보기만 최대 2개 조회합니다.
제출 경로에서는 전체 목록을 읽지 않으며, 자동완성은 기존처럼 전체 인덱스를 캐시합니다.
초성·오타 보정은 지원하지 않습니다.

검색 키는 DB generated 컬럼이므로 직접 SQL을 포함한 모든 이름 변경에 즉시 반영됩니다.
`llvy_normalize_search_v1()`과 클라이언트는 고정한 Unicode 17 소문자 데이터로 터키어 I·문맥별
그리스어 시그마를 일치시킵니다. NFC·trim도 유지하며 PostgreSQL 17의 이전 Unicode 테이블에
없는 조합·결합 순서는 `llvy_nfc_v1()`이 보완합니다. 데이터와 생성 도구는 각각
`search-unicode-data.json`, `scripts/search-normalization.mjs`에 있습니다. 이미 배포한 함수는
덮어쓰지 않고 새 버전과 stored 컬럼 재계산 migration으로 변경합니다.
TTL은 게시 후 60초로, 재구축 시간을 포함한 변경 시점 기준의 엄격한 상한은 아닙니다.
자세한 장애 동작과 운영 확인 항목은 [Valkey 안내](valkey.md)를 따릅니다.

## 인증과 요청 제한

Discord OAuth2 authorization code와 `identify`로 `/users/@me`의 ID를 확인합니다.
별도로 봇의 `GET /guilds/{id}/members/{user_id}`로 지정 서버의 non-pending 멤버만 허용합니다.
사용자 토큰은 저장하지 않으며 roster·Gateway·게임 모임원 연결은 사용하지 않습니다.
오너는 현재 `DISCORD_OWNER_USER_ID`, admin은 활성 grant, 그 밖의 활성 계정은 viewer입니다.
기본 로그인 목적지는 `/`이며 역할에 허용된 내부 return path만 유지합니다.

OAuth 시도는 10분 만료 state/브라우저 nonce 해시를 저장하고 callback에서 원자적으로 한 번
소비합니다. v5 쿠키는 `v5.<issuedAtMs>.<256-bit-reference>.<base64urlHmac>` 형식이며
30일 절대 수명입니다. DB에는 참조 SHA-256만 저장하고 현재 활성 계정·세션·guild·owner/grant를
매 보호 요청에서 확인합니다. 독립 `AUTH_SECRET`은 32 UTF-8 바이트 이상의 서버 비밀이며
교체하면 모든 기존 쿠키를 거부합니다. v4 이하는 거부합니다. Proxy는 서명 쿠키만 선별하고
실제 인가는 DAL·Action·API·변경 transaction이 수행합니다.

일반 보호 요청에는 Discord 조회나 membership TTL이 없습니다. 외부 장애 중에도 현재 DB
권한으로 접근합니다. 최초 로그인과 관리자 부여는 새 bot 조회가 필요합니다. 일일 Cron은
세션 없는 계정도 확인하고 명시적 Unknown Member/pending만 정지합니다.
공용 PostgreSQL 차단기는 credential·guild·전역/버킷 429 대기와 expiring 단일 permit을 공유합니다.
정상 permit/로컬 호출 예산 경합은 DB 잠금을 유지하지 않고 제한된 시간 동안 기다립니다.
로그인·관리자 부여는 최대 10초 대기하고, Cron은 외부 timeout을 남긴 실행 예산을 전달합니다.
차단기 오류는 즉시 반환하고 로컬 대기 만료는 미확인 cursor를 유지하며 오류 횟수와 구분합니다.
실행 예산과 운영 제한은 [Discord 운영](discord-auth.md)에 있습니다.

가입 확인은 네트워크 전에 sequence version을 부여하고 조건부 저장해 오래된 응답이 새 결정을
덮어쓰지 못하게 합니다. 로그인·가입 판정 저장은 계정이 없더라도 guild·Discord ID별 최신 버전을
`auth_membership_decisions`에 보존합니다. 신규 거절 후 늦게 도착한 이전 성공은 계정·세션을
생성할 수 없고, 새 버전의 정상 로그인은 허용합니다. 이 판정 행은 account보다 먼저 잠급니다.
기존 계정만 처리하는 부여·정리는 계정의 버전 검사와 잠금을 유지하며 판정 행을 뒤늦게 잠그지 않습니다.
계정 변경은 account → session → grant → business 순서로 잠가 회수와
직렬화하며 여러 계정을 잠그는 부여/회수는 ID를 정렬합니다. 외부 I/O 중 행 잠금을 유지하지
않습니다. 정지·전체 세션/grant 회수·감사와 로그인·세션 생성·감사는 각각 원자적으로 저장합니다.
감사 실패 시 변경도 rollback됩니다. 과거 감사 snapshot은 현재 Actor와 분리해 이전
member/credential과 시스템 실행자를 읽습니다.

일반 사용자의 데이터는 [`read-model.ts`](../src/lib/read-model.ts)와
[`member-privacy.ts`](../src/lib/member-privacy.ts)에서 렌더링 전에 생년 속성을 제거합니다.
모임원 목록·전적·게임 참가자·검색 선택지의 이름은 모든 역할에 원문으로 전달합니다.
보호 데이터는 현재 세션으로 읽고 서로 다른 역할의 응답은 캐시 키를 공유하지 않습니다.
캐시 namespace v2는 이전 버전의 마스킹된 이름 결과와 분리됩니다.

OAuth 시작·callback은 외부 호출 전에 Vercel 신뢰 IP별 분당 10회와 전체 분당 100회
공유 예산을 적용합니다. 일반 `x-forwarded-for`를 신뢰하지 않으며 확인된 IP가 없으면 거부합니다.
실패 감사는 클라이언트별 분당 한 번이며 IP 원문·code·token·cookie는 감사에 저장하지 않습니다.
업로드 예약은 account별 24시간 10개, 전체 50개를 Postgres 카운터로 적용합니다.
반복 로그인으로 예산을 초기화할 수 없습니다. 업로드 시작 횟수에 적용하며 초과 시 429입니다.
유지보수 endpoint는 별도 `CRON_SECRET`으로 인증합니다.

## 파싱·저장 한도

| 항목                  | 한도   |
| --------------------- | ------ |
| 원본 파일             | 64MiB  |
| 참가자 수             | 10명   |
| 메타데이터            | 4MiB   |
| `statsJson`           | 256KiB |
| 참가자 객체           | 32KiB  |
| 참가자 객체 중첩 깊이 | 4      |

파싱 예산은 파서와 수집 트랜잭션 시작 전에 확인합니다. 초과한 메타데이터나 잘못된
참가자 필드 타입은 422로 거부하며, DB에 저장할 `raw_stats`·`raw_metadata`는 허용된
스칼라 필드로 축소합니다. 저장할 문자열의 NUL·고립 UTF-16 surrogate도 파싱 오류로 처리해
422와 바인딩된 Blob 정리를 수행합니다. 정상 emoji·결합 문자는 허용합니다. 모임원 이름은
Action과 mutation 경계에서 같은 문자열 검증을 거쳐 DB 오류 전에 안내합니다.

PUUID 계정의 현재 Riot ID는 `name_observed_at`으로 관측 시각을 비교해 저장합니다. 기존과
같이 유효한 파일 수정 시각을 사용하며, 오래된 파일과 시각 불명 파일은 알려진 최신 이름을
되돌리지 않습니다. 같은 시각이거나 양쪽 모두 불명이면 나중 도착한 값을 사용합니다.
계정 UUID·모임원 연결은 그대로 유지하고 비교는 upsert 행 잠금 안에서 수행합니다.
기존 계정은 `file_mtime` 경기의 가장 최근 한국 일자 00시로 보수적으로 초기화하며, 이 값은
실제 경기 시각이나 현재 Riot 프로필의 보장이 아닙니다.

동시 수집의 계정 갱신 순서는 신원 기준으로 고정합니다. 교착 상태·직렬화 실패
(`40P01`·`40001`)로 롤백한 트랜잭션만 최대 3회 실행합니다. 커밋 여부가 불확실한
연결 오류는 자동 재시도하지 않습니다.

경기 상세의 DataDragon 챔피언 이름 조회는 응답 본문까지 2초로 제한합니다.
조회 실패나 시간 초과 시 리플레이의 내부 이름을 표시합니다.
