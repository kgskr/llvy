## 1. 프로젝트 & 인프라 셋업

- [x] 1.1 Next.js(App Router) + TypeScript 프로젝트를 초기화하고 ESLint/포맷터 등 기본 구성을 추가한다
- [x] 1.2 의존성 추가: `drizzle-orm`, `drizzle-kit`, `@vercel/postgres`, `@vercel/blob`
- [x] 1.3 환경변수 스키마/예시(`.env.example`) 작성: `UPLOAD_PASSWORD`, `POSTGRES_*`, `BLOB_READ_WRITE_TOKEN`
- [ ] 1.4 Vercel 프로젝트·Vercel Postgres·Blob 스토어 프로비저닝 및 환경변수 연결(배포 환경)

## 2. 데이터베이스 스키마 (Drizzle)

- [x] 2.1 `members` 테이블 정의: `id`(uuid PK), `name`, `birth_year`, `created_at`
- [x] 2.2 `riot_accounts` 테이블 정의: `id`, `member_id`(nullable FK→members), `game_name`, `tag_line`, `puuid`, `first_seen_at`, `linked_at`, UNIQUE(game_name, tag_line)
- [x] 2.3 `games` 테이블 정의: `id`, `file_hash`(UNIQUE), `blob_url`, `original_filename`, `played_at`(NOT NULL), `played_at_source`('file_mtime'|'upload'), `duration_ms`, `game_version`, `winning_team`, `raw_metadata`(jsonb), `uploaded_at`
- [x] 2.4 `game_participants` 테이블 정의: `id`, `game_id`(FK→games, cascade), `riot_account_id`(FK→riot_accounts), `team`, `position`(nullable), `champion`, `win`, `kills`, `deaths`, `assists`, `gold_earned`, `raw_stats`(jsonb), UNIQUE(game_id, riot_account_id)
- [x] 2.5 `drizzle-kit`으로 초기 마이그레이션 생성·적용하고 로컬 DB에서 검증 — 실제 SQL migrations를 PGlite PostgreSQL 엔진에 적용·재적용하는 통합 테스트 통과(외부 DB 적용은 9.1)

## 3. 접근 제어 (공유 비밀번호)

- [x] 3.1 비밀번호 검증 + 서명 세션 쿠키 발급 로직 구현(서버에서만 `UPLOAD_PASSWORD` 비교)
- [x] 3.2 로그인(비밀번호 입력) 화면과 로그아웃 동작 추가
- [x] 3.3 미들웨어로 업로드/조회/관리 라우트를 보호하고, 미인증 접근을 로그인으로 리다이렉트
- [x] 3.4 검증: 올바른 비밀번호는 접근 허용, 틀린/빈 비밀번호는 거부 (replay-upload 스펙)

## 4. 업로드 (Vercel Blob 직접 업로드)

- [x] 4.1 Blob 업로드 토큰 발급 라우트 구현(`handleUpload`): 세션 인증 확인 + `.rofl` content-type/확장자 제한
- [x] 4.2 클라이언트 업로드 UI 구현(`@vercel/blob/client`의 `upload()`로 Blob에 직접 전송, 진행률 표시)
- [x] 4.3 업로드 시 `File.lastModified`를 캡처해 처리 라우트로 전달(게임 날짜 산정용) (replay-upload 스펙)
- [ ] 4.4 검증: 30MB `.rofl`이 4.5MB 제한 없이 업로드되고, 비-rofl 파일은 거부됨 (replay-upload 스펙)

## 5. .rofl 파싱

- [x] 5.1 .rofl 헤더 파서 구현: magic 검증(레거시 `RIOT 00 00` + ROFL2 `RIOT 02 00` 둘 다), 메타데이터 offset/length 읽기, 메타데이터 JSON 추출
- [x] 5.2 `statsJson`(JSON 문자열 → 재파싱) 참가자 추출: `RIOT_ID_GAME_NAME`/`RIOT_ID_TAG_LINE`, `PUUID`, 챔피언 `SKIN`, `TEAM`("100"/"200"), 승패 `WIN`(소문자 "win" 비교), KDA(`CHAMPIONS_KILLED`/`NUM_DEATHS`/`ASSISTS`), `GOLD_EARNED`
- [x] 5.3 포지션 추출: `TEAM_POSITION` 우선(빈값이면 `INDIVIDUAL_POSITION`, "INVALID"는 불명) → 불명은 NULL (replay-parsing 스펙)
- [x] 5.4 게임 레벨 필드 추출: `gameLength`(ms), `gameVersion`, 그리고 `WIN="win"`인 `TEAM`에서 winning_team 도출. 게임 날짜는 파일에 없음 — 파서에서 반환하지 않음
- [x] 5.5 에러 처리: 비-rofl/손상/필수 필드 누락 시 파싱 에러, 부분 결과 금지. `statsJson`이 빈 배열([])인 구버전 리플레이는 "지원 불가"로 실패 (replay-parsing 스펙)
- [x] 5.6 검증: 샘플 .rofl로 10인 참가자(라이엇ID·챔피언·포지션·팀·승패) 및 게임 메타데이터 추출 단위 테스트

## 6. 인입 파이프라인 & 저장

- [x] 6.1 처리 라우트(`/api/process`) 구현: Blob URL + 세션 인증 수신 → Blob에서 파일 취득 → sha256 해시 계산
- [x] 6.2 파일 해시로 중복 검사: 이미 존재하면 게임 미생성 + "이미 존재" 응답 (replay-upload / match-storage 스펙)
- [x] 6.3 참가자별 `(game_name, tag_line)` find-or-create로 `riot_accounts` 확보(없으면 member_id=NULL로 보류)
- [x] 6.4 `played_at` 산정: 전달된 `File.lastModified`가 유효하면 사용(`played_at_source='file_mtime'`), 없으면 업로드 시각(`played_at_source='upload'`)
- [x] 6.5 게임 + 참가자 레코드를 단일 트랜잭션으로 저장, 실패 시 롤백(부분 저장 금지) (match-storage 스펙)
- [x] 6.6 업로드 성공 후 클라이언트가 처리 라우트를 호출하도록 연결하고, 멱등성(해시 기준) 보장
- [ ] 6.7 검증: 업로드→파싱→저장 end-to-end, 동일 리플레이 재업로드 시 중복 미생성, played_at 출처 확인 — 실제 솔랭 파일의 로컬 처리 라우트→파싱→PGlite 저장·조회·중복·날짜 출처는 확인(2026-10-03). 브라우저→Blob 전송을 포함한 전체 흐름은 남음

## 7. 모임원 레지스트리 & 연결

- [x] 7.1 모임원 생성/수정(이름·생년) 동작 구현, UUID는 자동 생성·불변 (member-registry 스펙)
- [x] 7.2 인입 시 등록된 Riot ID 자동 연결 확인(매칭 계정이 멤버에 연결돼 있으면 참가자가 해당 멤버로 해석)
- [x] 7.3 미연결 Riot 계정 목록 조회 + 모임원에 수동 연결하는 관리 동작 구현
- [x] 7.4 검증: 미연결 계정을 모임원에 연결하면 과거 참가자가 재수집 없이 그 모임원으로 해석됨 (member-registry 스펙) — 연결·수정·해제 및 계정 이름 변경 통합 테스트 통과

## 8. 조회 화면

- [x] 8.1 게임 목록 화면: 게임 날짜(played_at) 최신순 정렬, 요약(게임 날짜·길이·승리 팀·참가자 수) 표시 (match-storage 스펙)
- [x] 8.2 게임 상세 화면: 팀별 참가자 그룹, 라이엇 아이디·챔피언·포지션·KDA·gold·승패 표시, 연결된 모임원 이름 노출, 포지션 불명은 별도 표기 (match-storage 스펙)
- [x] 8.3 챔피언 표시명 변환: `SKIN`(내부명, 예: MonkeyKing) → DataDragon 챔피언 맵으로 표시명 매핑(버전별 맵 캐싱)

## 9. 배포 & 마무리

- [ ] 9.1 Vercel에 배포하고 프로덕션 DB 마이그레이션 적용 — 앱은 2026-10-04 `llvy.vercel.app`에 READY 상태로 배포했으며, 운영 DB 마이그레이션은 남음
- [ ] 9.2 실제 .rofl 업로드로 프로덕션 end-to-end 스모크 테스트(업로드·파싱·저장·조회)
- [x] 9.3 README에 환경변수·로컬 개발·배포 절차 정리

## 10. MVP 완성 점검 보완 (2026-10-02)

- [x] 10.1 모임원 이름·생년 수정 UI, 입력 검증과 저장 피드백을 구현한다
- [x] 10.2 게임 목록에 페이지 이동을 추가하고 잘못된 게임 UUID는 404로 처리한다
- [x] 10.3 필수 참가자/게임 정보 검증, PostgreSQL 정수 범위, UTF-8 byte budget, 중복 계정 참가자의 원자적 거부를 검증한다
- [x] 10.4 PUUID가 없는 계정과 명확히 대응되는 PUUID 계정의 연결을 보존하고 모호한 이름은 자동 병합하지 않는다
- [x] 10.5 상태 기록 실패 후 canonical Blob 보존, 업로드 덮어쓰기 금지, 잘못된 API 입력 처리를 회귀 테스트로 검증한다
- [x] 10.6 공유 비밀번호·서명 키 교체 시 세션 무효화와 로그인 복귀 경로 검증을 보완한다
- [x] 10.7 실제 솔랭 ROFL2 샘플로 파서·처리 라우트·PGlite 저장/조회/중복/모임원 연결을 검증하고, JSON에 없는 게임 버전을 ROFL2 헤더에서 읽도록 보완한다(2026-10-03)

로컬 통합 검증은 합성 legacy/ROFL2 리플레이와 PGlite를 사용한다. 2026-10-03에는 실제
솔랭 `KR-8398474046.rofl`(18,517,442 bytes)을 제공받아 로컬 처리·저장·조회도 검증했다.
실파일 검증은 `LLVY_REPLAY_FILE`을 지정한 `npm run test:replay`로 재실행할 수 있다.
30MB 브라우저→Blob 전송, 사용자설정 게임의 포지션 특성, Neon 다중 연결 경합 및 배포 환경의
전체 흐름 검증을 대체하지 않는다. 1.4, 4.4, 6.7, 9.1, 9.2는 서비스 연결 후 완료한다.
