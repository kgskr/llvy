## Why

현재 일반 사용자는 업로드할 수 없고, 업로드를 허용하려면 모임원·게임 관리까지 가능한 관리자 권한을 부여해야 한다. 일반 사용자와 같은 조회 범위에 리플레이 업로드만 추가한 업로더 단계를 두고, 서비스 오너와 관리자가 이를 부여·회수할 수 있게 한다.

## What Changes

- 역할을 `viewer`(일반 사용자), `uploader`(업로더), `admin`(관리자), `owner`(서비스 오너) 네 단계로 확장한다. 기존 계정의 역할은 자동 변경하지 않는다.
- 일반 사용자부터 서비스 오너까지 생년 조회를 허용한다. 업로더는 일반 사용자와 같은 조회 범위에 웹·Windows 앱의 리플레이 예약, 전송, 처리, 자기 업로드 상태 조회 권한을 추가한다. 모임원·계정 연결·게임 수동 관리와 권한 관리, 감사 조회는 허용하지 않는다.
- `/admin/users`를 관리자에게도 열되 관리자는 일반 사용자↔업로더 전환만 수행한다. 관리자 부여·회수와 감사 조회는 서비스 오너 전용으로 유지한다.
- 업로더 부여에는 새 grant ID와 최신 Discord 가입 확인을 사용한다. 회수는 외부 제공자 호출 없이 기존 세션·기기·진행 중 업로드 권한을 무효화하고 감사와 함께 커밋한다.
- 업로드 전용 권한 검사와 기존 관리 권한 검사를 분리하고, 서버 응답·캐시·페이지·액션·라우트·최종 저장 모두 네 역할을 명시적으로 처리한다.
- 업로드 감사에 누가 어떤 파일을 제출했고 어떤 게임으로 처리됐는지 남긴다. 웹·desktop 모두 업로드 ID, 계정/역할/grant snapshot, 파일명, 검증된 파일 해시, 결과·게임 ID를 연결하고 권한 회수·게임 삭제 이후에도 기존 감사 보존 정책에 따라 이력을 유지한다. 감사 조회는 오너 전용이다.
- **BREAKING (엄격한 클라이언트 계약 기준)**: desktop-v1의 계정 역할 열거형에 `uploader`가 추가된다. URL·인증 흐름·DTO 필드·scope는 유지하되 고정 계약과 Windows 앱의 역할 파서 호환성을 검증한 후 업로더의 앱 사용을 활성화한다.

## Capabilities

### New Capabilities

- `uploader-role`: 업로더 권한 경계, 부여·회수·승격 수명주기, 관리 UI, 웹·desktop 공통 인가 및 전환 검증.

### Modified Capabilities

- `login-account-administration`: 네 역할 판정, 관리자에게 제한된 사용자 권한 관리 제공, 관리자 승격과 업로더 grant의 전환 규칙.
- `discord-session-authorization`: 업로더의 현재 권한 검사·모든 로그인 역할의 생년 조회 허용·탈퇴 처리·동시성 보장.
- `account-audit-upload-binding`: 업로더 grant에 묶인 예약과 감사, 회수 후 재부여 시 이전 권한 재사용 방지.
- `replay-upload`: 업로드 허용 역할에 업로더 추가.
- `blob-processing-ownership`: 웹 Blob 예약·토큰 허용 역할에 업로더를 추가하고 기존 기기/채널 소유권 유지.
- `query-cache`: 모든 로그인 역할의 생년 포함 projection과 권한 관리 조회의 공유 캐시 제외.
- `member-list-filter`: 기존 목록의 생년 표시를 모든 로그인 역할에 허용하며 로컬 검색 대상은 이름과 Riot ID로 유지한다.
- `member-history`: 모든 로그인 역할의 모임원 목록에 기록된 생년을 표시하고 기존 viewer 생년 숨김 규칙 제거.
- `discord-authentication`: 업로더 부여의 bot 조회에도 기존 공유 제한·회로 차단·대기 규칙 적용.

## Impact

- 인증·인가: `src/lib/auth.ts`, `session.ts`, `authority.ts`, `auth-store.ts`, `account-administration.ts`, `audit.ts` 및 역할별 데이터 projection/cache.
- 업로드: 웹 upload 페이지·액션·예약·Blob 라우트, `upload-actor.ts`, `ingest.ts`, `src/lib/desktop/`와 desktop 라우트·연결 화면.
- 저장소: `src/db/schema.ts`, 신규 migration, grant·예약·감사·desktop 연결의 grant 종류/식별자와 역할 제약.
- UI: 공통 메뉴·역할 표시·관리 페이지·`/admin/users`·권한 컨트롤. 감사 페이지와 관리 기능은 기존 경계를 유지한다.
- 병행 변경: `add-desktop-replay-upload-api`가 정의하는 세션·예약·감사 계약과 합성해야 한다. 이 계획의 네 역할 정책이 최종 정책이며 기존 desktop 구현·필수 검증은 별개로 유지한다.
- 문서·외부 저장소: README, 인증·구조·개발·배포·desktop 안내, desktop-v1 계약/fixture, Windows 앱 고정 사본과 역할 처리, 위키의 업로더·권한 설명. 구체 대상과 순서는 design/tasks에 기록한다.

## Non-goals

- 앱 실행 파일 구현, 임의 역할/RBAC 편집기, Discord 역할 연동, 일반 사용자 자동 승격, 운영 계정에 대한 실제 권한 부여, 서비스 오너 위임, 업로드 한도·보관 기간·기존 웹 DTO 변경.
- 로컬 구현 이후에도 외부 계약·실환경·운영 검증 등 필수 작업 전에는 정식 명세로 동기화하거나 아카이브하지 않는다.
