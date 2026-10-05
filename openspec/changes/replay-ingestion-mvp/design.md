## Context

초기 MVP로 시작한 프로젝트이며 현재 로컬 구현과 아래 계약을 기준으로 한다. 2026-10-04 운영 검증 결과는 `docs/validation/2026-10-04-production-deployment.md`에 기록되어 있으며, 이후 로컬 변경의 배포 여부는 별도로 확인해야 한다. 리그 오브 레전드 소모임의 내전 전적을 모으는 웹 서비스이며, Vercel + Vercel Postgres에 배포한다. MVP의 핵심 흐름은 "리플레이(.rofl) 업로드 → 파싱 → 전적 DB 저장 → 조회"다.

제약/배경:
- **Vercel 함수 본문 4.5MB 제한**: Serverless/Edge Function은 요청 본문이 4.5MB로 하드 제한된다. .rofl은 보통 10~30MB라 함수로 직접 받을 수 없다.
- **.rofl 파일 구조**: `.rofl`은 고정 헤더 + 256바이트 서명 + 길이/오프셋 필드 + JSON 메타데이터 + 암호화 페이로드로 구성된다. 메타데이터 JSON에는 `gameLength`, `gameVersion`, 그리고 참가자 통계 배열이 JSON 문자열로 인코딩된 `statsJson`이 들어 있다. 참가자 객체에는 `RIOT_ID_GAME_NAME`, `RIOT_ID_TAG_LINE`, `PUUID`, `SKIN`(챔피언), `CHAMPIONS_KILLED`, `NUM_DEATHS`, `ASSISTS`, `WIN`, `TEAM`, `GOLD_EARNED` 등이 있다. **즉 Riot API 없이도 전적 추출이 가능하다.**
- 사용자는 소모임 인원(소수). 강한 인증보다 단일 공유 비밀번호로 충분하다고 결정됨.
- 모임원 실명·생년을 저장하므로 조회/관리 화면도 공유 비밀번호 뒤에 둔다.

## Goals / Non-Goals

**Goals:**
- 큰 .rofl 파일을 4.5MB 제한 없이 업로드하고, Riot API 없이 로컬 파싱으로 게임/참가자 전적을 추출해 Postgres에 저장한다.
- 동일 리플레이 중복 저장을 콘텐츠 해시로 방지한다.
- 모임원(UUID·이름·생년)과 라이엇 계정을 모델링하고, 라이엇 아이디를 모임원에 자동/수동으로 연결한다.
- 게임 목록·상세 조회 화면을 제공한다.

**Non-Goals:**
- Riot API 연동, 랭크/공식 매치 데이터 수집.
- 리더보드/MMR 산정. 모임원별 전적·챔피언 요약은 후속 `add-match-management-and-member-history` 변경에서 구현한다.
- 멤버별 로그인 계정 시스템, 권한 등급(관리자/일반) 분리. MVP는 단일 공유 비밀번호.
- 실시간 처리, 큐/워커 인프라. MVP는 업로드 직후 동기 파싱.
- 리플레이 영상 재생/암호화 페이로드 해석.

## Decisions

### 1. 스택: Next.js(App Router) + TypeScript + Drizzle + Vercel Postgres
Vercel 1급 지원, 서버 액션/라우트 핸들러로 업로드 후처리를 한 곳에서 처리. ORM은 Drizzle — 가볍고 타입 안전하며 `drizzle-kit`으로 마이그레이션 관리. 대안 Prisma는 번들/콜드스타트가 무겁고, 생SQL은 타입·마이그레이션을 직접 관리해야 해서 제외.

### 2. 업로드: Vercel Blob 클라이언트 직접 업로드
브라우저가 `@vercel/blob/client`의 `upload()`로 Blob에 직접 올리고, 서버는 짧은 토큰 발급(`handleUpload`)만 담당한다. 함수 본문 4.5MB 제한을 우회하는 유일한 실용적 방법.
- 인증: 공유 비밀번호는 로그인 시 검증한다. `/api/uploads`와 `/api/blob/upload`는 유효한 서명 세션 쿠키를 확인한 뒤 예약 및 업로드 토큰을 발급한다.
- 파일 종류 제한: 토큰 발급 시 `allowedContentTypes`/확장자 검증으로 `.rofl`만 허용.
- 저장소 접근 모드: `BLOB_ACCESS`를 연결한 스토어의 `private`/`public`에 맞춘다. 미설정은 기존 public 배포와 호환한다. 서버는 업로드 바인딩에 접근 모드만 포함하며 읽기/쓰기 토큰은 노출하지 않는다. private 읽기는 토큰에서 유도한 스토어와 바인딩의 경로를 검증한 canonical URL에만 Bearer 인증을 보내고, 리다이렉트 금지·캐시 금지·20초 제한을 유지한다. 이 환경변수는 기존 스토어의 공개 범위를 변경하지 않는다.
- 대안(함수로 multipart 전송)은 4.5MB 제한으로 불가하여 제외.

### 3. 파싱: .rofl 메타데이터 로컬 파싱 (Riot API 미사용)
클라이언트가 `/api/uploads`에서 `{uploadId, nonce, pathname, access}`를 받고, `/api/blob/upload`에 바인딩을 전달해 예약 경로로 직접 업로드한다. 업로드 완료 후 세션 쿠키와 함께 처리 라우트(`/api/process`)에 `{uploadId, nonce, blobUrl, originalFilename, lastModified}`를 전달 → 라우트가 Blob에서 파일을 받아 헤더의 오프셋으로 메타데이터 구간만 잘라 JSON 파싱 → `statsJson`을 다시 파싱해 참가자 통계를 얻는다.
- 파서는 의존성 위험을 줄이기 위해 헤더 오프셋(magic, 메타데이터 offset/length)을 직접 읽는 작은 모듈로 구현하고, 공개된 `.rofl` 포맷 지식을 참고한다. 매직 바이트는 레거시 `RIOT 00 00`과 신형 ROFL2 `RIOT 02 00`(2024~) **둘 다** 허용한다.
- **확인된 필드 매핑** (메타데이터의 `statsJson`은 JSON 문자열 → 다시 `JSON.parse`한 참가자 배열):

  | 개념 | 필드 | 비고 |
  |---|---|---|
  | 라이엇 게임명 | `RIOT_ID_GAME_NAME` | `#` 앞 부분 |
  | 라이엇 태그 | `RIOT_ID_TAG_LINE` | `#` 뒷부분, 전체 ID = `{GAME_NAME}#{TAG_LINE}` |
  | PUUID | `PUUID` | 영속 조인 키(비어있을 수 있음) |
  | 챔피언 | `SKIN` | 내부 코드명(예: `MonkeyKing`=Wukong) → DataDragon으로 표시명 변환 |
  | 팀 | `TEAM` | 문자열 `"100"`/`"200"` |
  | 승패 | `WIN` | 소문자 `"win"` 비교로 승리 판정, 그 외(빈값 포함)는 패배. `"Fail"` 하드코딩 금지 |
  | 포지션 | `TEAM_POSITION`(주), `INDIVIDUAL_POSITION`(보조) | `TOP/JUNGLE/MIDDLE/BOTTOM/UTILITY`. 불명: `TEAM_POSITION`=`""`, `INDIVIDUAL_POSITION`=`"INVALID"` |
  | KDA(부가) | `CHAMPIONS_KILLED`/`NUM_DEATHS`/`ASSISTS` | |
  | 골드(부가) | `GOLD_EARNED` | |
  | 게임 길이 | top-level `gameLength` | **밀리초** 단위(날짜 아님) |
  | 게임 버전 | top-level `gameVersion`, 없으면 ROFL2 헤더 | 패치 식별용(날짜 아님) |

  승리 팀(`games.winning_team`)은 `WIN="win"`인 참가자의 `TEAM`에서 도출한다.
- 2026-10-03 실제 솔랭 ROFL2 샘플 확인: JSON 메타데이터에는 `gameVersion`이 없고 헤더에 `16.19.821.7343`이 저장돼 있었다. 메타데이터 버전을 우선하며, 없으면 길이와 메타데이터 시작 경계를 검증한 ROFL2 헤더의 버전 필드를 사용한다. 암호화 페이로드의 문자열 검색으로 버전을 추측하지 않는다.
- **빈 statsJson 방어**: 패치 13.20(2023-10)~ 일부 리플레이는 `statsJson`이 빈 배열 `[]`로 직렬화되어 참가자 전적이 전혀 없다. 파싱 시 빈 배열을 감지해 "지원 불가"로 명확히 실패시킨다(부분 저장 금지). 2026년 현행 패치(ROFL2)는 정상적으로 채워져 있음을 확인함.
- **트리거 방식**: Blob의 `onUploadCompleted` 웹훅은 localhost에서 발화하지 않아 개발이 번거롭다. MVP는 업로드 성공 후 클라이언트가 처리 라우트를 호출하는 방식을 채택. (운영 안정화 시 웹훅으로 전환 가능.)
- 대안 Riot Match-V5 API는 키 승인·레이트리밋이 필요하고, **커스텀 내전 게임은 Match-V5에서 조회 자체가 불가**(Riot 정책)하여 제외.

### 3-1. 게임 진행 날짜: 파일 mtime → 업로드 시각 폴백
`.rofl` 안에는 게임 날짜/시각이 **전혀 없다**(top-level 키는 `gameLength, gameVersion, lastGameChunkId, lastKeyFrameId, statsJson`뿐, 모두 날짜 아님). 내전은 Match-V5로도 날짜를 못 얻는다. 따라서 게임 날짜는 **업로드된 파일의 `lastModified`(브라우저 `File.lastModified`, 리플레이 저장 시각의 근사치)** 를 우선 사용하고, 없거나 비정상이면 인입 시점 서버 현재 시각으로 폴백한다. 클라이언트가 업로드 시 `lastModified`를 처리 라우트로 함께 전달한다. mtime은 복사/이동/압축/다운로드 시 초기화될 수 있어 **추정치**이며, `games.played_at_source`로 출처를 기록한다.

### 4. 데이터 모델 (Drizzle / Postgres)
사용자가 말한 "모임원 식별 정보 테이블"과 "모임원 UUID 테이블"은 **하나의 `members` 테이블로 통합**한다 — UUID가 곧 모임원의 기본 식별자이므로 분리할 이유가 없다. 라이엇 아이디 ↔ UUID 매칭은 별도 `riot_accounts` 테이블이 담당한다.

```
members
  id            uuid  PK   default gen_random_uuid()   -- 모임원 UUID
  name          text  NOT NULL                          -- 이름
  birth_year    int                                     -- 생년
  created_at    timestamptz NOT NULL default now()

riot_accounts                                           -- 라이엇 아이디 ↔ 모임원 매핑
  id            uuid  PK   default gen_random_uuid()
  member_id     uuid  FK -> members(id)  NULL           -- NULL = 미연결(보류)
  game_name     text  NOT NULL                          -- 라이엇 아이디 게임명
  tag_line      text  NOT NULL                          -- #태그
  puuid         text  NULL                              -- 라이엇 안정 식별자(있으면 우선 신원)
  first_seen_at timestamptz NOT NULL default now()
  linked_at     timestamptz NULL
  -- 신원: puuid가 1차 키. 닉/태그 변경에도 같은 계정 유지.
  UNIQUE INDEX (puuid)            WHERE puuid IS NOT NULL  -- puuid 있는 계정
  UNIQUE INDEX (game_name, tag_line) WHERE puuid IS NULL   -- 구버전(puuid 없음) 폴백
  INDEX (member_id)

games                                                   -- 게임(매치) 정보
  id            uuid  PK   default gen_random_uuid()
  file_hash     text  NOT NULL UNIQUE                   -- .rofl sha256, 중복 방지
  blob_url      text  NOT NULL
  original_filename text
  played_at         timestamptz NOT NULL                -- 게임 진행 날짜(항상 채움). .rofl엔 날짜 없음 → source 참고
  played_at_source  text NOT NULL                       -- 'file_mtime'(업로드 파일 수정시각) | 'upload'(폴백)
  duration_ms       int                                 -- gameLength: 밀리초 단위
  game_version      text NULL                           -- gameVersion (패치 식별, 날짜 아님)
  winning_team      int  NULL                           -- WIN="win"인 TEAM에서 도출 (100/200)
  raw_metadata      jsonb                               -- 알려진 최상위 스칼라 진단 필드만 보존
  uploaded_at   timestamptz NOT NULL default now()

game_participants                                       -- 게임별 참가자 전적
  id            uuid  PK   default gen_random_uuid()
  game_id       uuid  FK -> games(id) ON DELETE CASCADE  NOT NULL
  riot_account_id uuid FK -> riot_accounts(id)           NOT NULL
  team          int                                     -- TEAM "100"/"200" → 100/200
  position      text  NULL                              -- TEAM_POSITION(TOP/JUNGLE/MIDDLE/BOTTOM/UTILITY), 불명은 NULL
  champion      text                                    -- SKIN(내부 챔피언명). 표시명은 DataDragon으로 변환
  win           boolean                                 -- WIN을 소문자 "win"로 판정
  kills         int                                     -- CHAMPIONS_KILLED (부가)
  deaths        int                                     -- NUM_DEATHS (부가)
  assists       int                                     -- ASSISTS (부가)
  gold_earned   int                                     -- GOLD_EARNED (부가)
  raw_stats     jsonb
  UNIQUE (game_id, riot_account_id)
```

핵심: 참가자는 `riot_account_id`만 참조하고, 모임원은 `riot_accounts.member_id`를 통해 해결한다. 따라서 미연결 계정을 나중에 모임원에 연결하면 **과거 게임 참가자가 자동으로 그 모임원으로 해석**된다(재수집 불필요). 이것이 "미등록 보류 후 수동 연결" 요구사항을 데이터 모델 수준에서 충족한다.

**필수/부가 구분**: 사용자가 명시한 저장 필수 데이터 = 게임 진행 날짜(`games.played_at`), 팀별 참가자 라이엇 아이디(`riot_accounts` + `game_participants.team`), 챔피언(`champion`), 포지션(`position`). KDA·골드(`kills/deaths/assists/gold_earned`)는 동일 `statsJson`에서 무료로 얻어지는 **부가** 컬럼이라 함께 저장하되, `raw_stats`에는 크기가 제한된 스칼라 허용 목록만 보존한다. 임의 필드·중첩 JSON·긴 문자열은 원본 그대로 보존하지 않는다. `raw_metadata`도 알려진 최상위 스칼라 필드만 보존하며, 원본 파일은 Blob에 유지한다.

### 5. 인입 시 계정 find-or-create + 자동 연결
PUUID가 있으면 해당 PUUID를 우선 식별자로 사용하고 기존 계정의 표시 이름을 갱신한다. 새 PUUID와 같은 Riot ID의 계정이 하나뿐이며 그 계정에 PUUID와 모임원 연결이 모두 없을 때만 기존 행을 승격한다. 이미 모임원에 연결된 구버전 계정은 이름 일치만으로 승격하지 않으며 새 미연결 PUUID 계정을 만들고 관리 화면에서 명시적으로 연결한다. PUUID가 없는 리플레이는 같은 Riot ID의 후보가 하나일 때만 재사용하며, 후보가 여러 개면 별도의 미연결 구버전 계정을 사용한다. 이후 `game_participants`는 선택된 계정을 참조한다.

### 6. 접근 제어: 단일 공유 비밀번호 + 서명 쿠키
`UPLOAD_PASSWORD` 환경변수와 비교. 성공 시 30일 유효한 서명 세션 쿠키를 발급해 업로드/조회/관리 라우트를 `src/proxy.ts`로 보호한다. 새 세션 payload는 발급 시각과 임의 nonce를 포함한다. `AUTH_SECRET` 또는 공유 비밀번호를 교체하면 기존 세션은 무효화된다. 비밀번호는 서버에서만 검증하고 클라이언트로 노출하지 않는다.

## Risks / Trade-offs

- **함수 실행 시간/메모리**: 30MB Blob을 함수로 받아 파싱 → Hobby 플랜 기본 10초 제한에 근접 가능. → 메타데이터 구간만 Range 요청으로 받거나(`Range` 헤더), `maxDuration`을 상향(Pro)하여 완화. 메타데이터 JSON 자체는 작아 파싱은 1초 미만.
- **.rofl 포맷 변동**: 패치로 메타데이터 키가 바뀌거나 누락될 수 있음. → 필수 필드 누락 시 "지원 불가"로 실패하고 부분 저장 금지(스펙에 명시), `raw_metadata`/`raw_stats`는 제한된 진단 필드만 보존한다. 추가 분석에 필요한 전체 원본은 Blob 파일을 이용한다.
- **빈 statsJson 리플레이**: `statsJson`이 `[]`이면 참가자 전적이 없으므로 "지원 불가"로 실패한다. 제공된 패치 `16.19.821.7343` 솔랭 샘플 1개의 통계 추출을 확인했으며, 다른 패치·사용자설정 게임 전체의 호환성으로 일반화하지 않는다.
- **포지션 신뢰도**: 메타데이터의 `TEAM_POSITION`을 우선 사용하고, 없으면 `INDIVIDUAL_POSITION`으로 폴백한다. 둘 다 알 수 없으면 `position`은 NULL로 저장하고 UI에 "불명"으로 표시하며 `raw_stats`를 보존한다. 실제 내전·오프롤 조합의 역할 값이 실제 플레이와 일치하는지는 별도 샘플로 검증해야 한다.
- **챔피언 내부명**: `SKIN`은 내부 코드명(예: `MonkeyKing`=Wukong)이라 사람이 읽는 이름이 아님. → 최신 DataDragon 버전의 한국어 챔피언 맵 하나로 표시명을 변환한다. fetch 캐시는 하루 재검증 설정이며 성공한 맵은 프로세스 메모리에 유지한다. 경기 패치별 맵이나 메모리 캐시 만료는 구현하지 않는다. 전체 조회는 2초로 제한하고 실패 시 내부명을 표시한다.
- **게임 날짜 부재**: `.rofl`엔 날짜가 전혀 없고 내전은 Match-V5로도 조회 불가. → `File.lastModified`(mtime 근사)→업로드 시각 폴백을 사용하며 `played_at_source`로 출처 기록. mtime은 파일 조작 시 초기화될 수 있는 추정치임을 UI에 표기.
- **자동 트리거(클라이언트 호출) 신뢰성**: 업로드 후 처리 요청이 유실되면 Blob만 남고 DB엔 게임이 없을 수 있음(고아 Blob). → 처리 라우트를 멱등(파일 해시 기준)으로 만들고, 재처리 큐는 없으며 만료된 예약 경로의 Blob은 후속 보안 변경의 일일 Cron으로 정리한다. 저장된 경기의 원본은 삭제하지 않는다.
- **중복 업로드 경쟁 조건**: 동일 리플레이 동시 업로드 시 두 처리 요청이 충돌 가능. → `games.file_hash`의 UNIQUE 제약으로 DB 레벨에서 한 건만 성립, 충돌은 "이미 존재"로 처리.
- **공유 비밀번호 유출**: 비밀번호 1개라 유출 시 전원 접근 가능. → MVP 허용 위험. 유출 시 환경변수 교체로 즉시 무효화. 후속에 멤버 로그인으로 격상 가능.
- **라이엇 아이디 변경**: 라이엇 아이디는 변경 가능 → puuid를 1차 신원으로 사용해 닉/태그가 바뀌어도 같은 계정으로 dedup(인입 시 puuid 충돌 업서트로 표시명 갱신). puuid가 없는 구버전 리플레이만 (game_name, tag_line)으로 폴백.

## Migration Plan

초기 MVP에는 기존 데이터가 없었다. 현재는 Drizzle 마이그레이션을 순서대로 적용하며, 후속 변경의 게임 관리 컬럼·업로드 예약·공유 요청 제한 테이블도 필요하다. 배포 순서:
1. Vercel 프로젝트 생성, Vercel Postgres·Blob 스토어 프로비저닝, 환경변수(`UPLOAD_PASSWORD`, `POSTGRES_*`, `BLOB_READ_WRITE_TOKEN`) 설정.
2. Drizzle 스키마 작성 후 `drizzle-kit`으로 초기 마이그레이션 생성·적용.
3. 앱 배포. 롤백은 Vercel 이전 배포로 복귀; 스키마는 초기 버전이라 파괴적 변경 없음.

## Resolved implementation choices

- 전체 Blob을 다운로드한 뒤 파싱한다. Range 요청은 사용하지 않는다. 최대 파일 크기는 64MiB, 다운로드·본문 읽기 제한은 20초, 처리 라우트의 maxDuration은 60초다.
- `/admin`에 모임원 생성·수정, 계정 연결·해제 및 미연결 계정 목록을 구현했다.
- 큐 타입 필터는 없다. 확장자·파일 크기·컨테이너·참가자 필수 필드·자원 예산을 만족하는 리플레이를 처리한다.
- 포지션은 `TEAM_POSITION` 우선, 빈 값일 때 `INDIVIDUAL_POSITION`으로 폴백하고 불명은 NULL이다.
- 날짜는 유효한 `File.lastModified`를 사용하고 없거나 잘못되면 인입 시점의 서버 현재 시각을 사용한다. 이후 수동 보정은 별도 원본 보존 컬럼을 사용한다.
- 생년은 선택값이며 저장하지 않은 경우 NULL이다.
