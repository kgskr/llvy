## Context

변경 전 `SessionRole`은 viewer/admin/owner이며 `authority.accountRole()`은 환경변수의 오너 ID와 `admin_grants`로 역할을 도출한다. 브라우저 v5 쿠키에는 역할을 저장하지 않는다. 관리자는 오너만 부여·회수하고 `/admin/users`와 감사 조회도 오너 전용이다.

업로드 라우트는 viewer를 차단하지만 `assertAdmin()`, 공통 메뉴·관리 페이지와 `member-privacy.ts`도 `role !== viewer`를 관리 권한으로 취급한다. 타입만 추가하면 업로더에게 관리 기능까지 열릴 수 있으므로 capability별 명시적 허용 목록으로 바꿔야 한다. 생년 조회는 viewer/uploader/admin/owner에 허용하되 관리 권한과 독립적으로 판단한다.

`add-desktop-replay-upload-api`는 구현 중이며 실환경 검증이 남아 있다. 변경 전 desktop 세션 역할 CHECK와 `contracts/desktop-v1/schema.json`은 admin/owner만 허용하고, 연결 승인·코드 교환·refresh·예약·최종 저장은 같은 grant 권한을 재검증한다. 이 계획은 해당 작업의 완료를 전제로 간주하지 않는다.

## Goals / Non-Goals

**Goals:**

- 생년을 포함한 일반 사용자 조회 + 업로드의 권한 단계를 웹과 desktop에 일관되게 제공한다.
- 관리자에게는 업로더 관리만 위임하고 관리자/오너 권한의 추가 위임은 막는다.
- 회수·재부여·승격·탈퇴·동시 요청에서 과거 권한이 재사용되지 않게 한다.
- 기존 세션, 관리 권한, 업로드 제한·소유권을 보존하고 생년 조회를 viewer/uploader까지 확장한다. 다른 관리자 전용 데이터 접근 제한은 유지한다.

**Non-Goals:**

- 범용 RBAC, Discord 서버 역할 자동 동기화, 서비스 오너 관리 UI, 신규 업로드 프로토콜, 운영 계정 변경, 사용자별 업로드 한도 변경.

## Decisions

### 1. 네 역할과 명시적 capability

| 기능                                           | 일반 사용자 viewer | 업로더 uploader | 관리자 admin | 서비스 오너 owner |
| ---------------------------------------------- | ------------------ | --------------- | ------------ | ----------------- |
| 로그인·기존 조회·모임원 이름                   | 허용               | 허용            | 허용         | 허용              |
| 생년 조회                                      | 허용               | 허용            | 허용         | 허용              |
| 웹 리플레이 업로드                             | 불가               | 허용            | 허용         | 허용              |
| Windows 연결·업로드·자기 상태 조회             | 불가               | 허용            | 허용         | 허용              |
| 모임원/Riot 연결 수동 변경·게임 날짜/제외/삭제 | 불가               | 불가            | 허용         | 허용              |
| 로그인 계정 목록·업로더 부여/회수              | 불가               | 불가            | 허용         | 허용              |
| 관리자 부여/회수                               | 불가               | 불가            | 불가         | 허용              |
| 감사 로그·가입 점검 운영 상태                  | 불가               | 불가            | 불가         | 허용              |

`canUpload`/`assertUploader`는 uploader/admin/owner, 관리 helper는 admin/owner, 오너 helper는 owner만 명시적으로 허용한다. 업로더의 리플레이 수집 중 생성되는 기존 게임·참여자·자동 연결 처리는 업로드 기능의 일부다. 별도 모임원/Riot 연결 CRUD나 게임 수동 편집 권한은 생기지 않는다. 알 수 없는 역할은 거부한다.

조회 projection은 생년을 제공하는 기존 모임원 조회 화면과 데이터 응답에서 viewer/uploader/admin/owner 모두에게 생년을 포함한다. 모임원 목록은 모든 로그인 역할에 기록된 생년이 있으면 `이름(생년)`, 없으면 이름만 표시한다. 생년 조회 허용은 다른 관리자 전용 데이터나 편집 권한을 추가하지 않는다. 캐시 key 타입을 네 역할로 확장하되 기존 namespace·revision·TTL 계약을 변경하지 않고 uploader를 독립 role key로 구분한다. viewer/uploader 응답 모두 생년을 포함할 수 있지만 다른 관리자 전용 데이터와 구분되는 projection을 사용하며 관리자 캐시를 재사용하지 않는다. 기존 생년 제외 캐시가 새 화면에 남지 않도록 영향받는 projection의 schema version 또는 cache identity를 갱신한다. TTL과 데이터 revision 정책은 유지한다. 모든 역할에서 최소 필드만 반환하는 닉네임 자동완성·통합 검색 suggestion 계약은 유지하며 생년 필드를 새로 추가하지 않는다.

대안인 `role !== viewer` 연장은 새로운 역할을 자동으로 관리자 취급하므로 채택하지 않는다. 독립 boolean을 사용자마다 중첩하는 방식보다 네 단계 역할과 명시적 전환을 사용한다.

### 2. 별도 업로더 grant와 한 가지 유효 역할

기존 `admin_grants`를 일반 grant 테이블로 즉시 이관하지 않는다. `uploader_grants`를 추가하여 `id`, `accountId`, `issuedBy`, `issuedAt`, `revokedAt`, `revokedBy`를 보관하고 계정당 활성 uploader grant 하나를 부분 unique index로 보장한다. 발급·회수자 FK는 로그인 계정이다.

현재 역할 우선순위는 owner > admin > uploader > viewer다. 일반적인 역할 변경에서는 활성 admin/uploader grant가 중첩되지 않게 공통 계정 잠금 아래 검사·전환한다. 오너 환경변수 변경으로 역할이 바뀌어도 요청마다 현재 역할과 기존 예약/기기의 역할·grant를 비교한다.

`Actor`/감사/예약에는 기존 `adminGrantId`를 유지하고 별도 `uploaderGrantId`를 추가한다. 기존 admin 식별자 필드에 uploader grant를 넣지 않는다. desktop 세션·승인 요청에도 uploader grant 바인딩을 별도 저장하고 role에 맞는 유효 ID만 사용하도록 검증한다. 과거 admin/owner 행의 새 필드는 null이고 원래 귀속을 바꾸지 않는다.

### 3. 전환과 회수 정책

| 작업        | 실행자         | 사전 상태            | 결과                                                                         |
| ----------- | -------------- | -------------------- | ---------------------------------------------------------------------------- |
| 업로더 부여 | admin/owner    | active viewer        | 새 uploader grant, 다음 브라우저 요청부터 uploader                           |
| 업로더 회수 | admin/owner    | uploader             | grant 회수·기존 모든 세션 폐기, 새 로그인 후 viewer                          |
| 관리자 부여 | owner          | viewer 또는 uploader | 새 admin grant; uploader였다면 grant·세션·기기 권한을 같은 트랜잭션에서 폐기 |
| 관리자 회수 | owner          | admin                | 기존 계약대로 grant·세션·기기 폐기, 새 로그인 후 viewer                      |
| 재부여      | 각 권한 실행자 | active viewer        | 항상 새 grant ID, 이전 권한 복구 없음                                        |

관리자 강등 시 업로더를 자동으로 남기지 않는다. 필요하면 새 업로더 부여를 수행한다. 관리자와 오너 대상의 업로더 부여·회수는 거부하고 관리자용 동작으로 관리자/오너 권한을 변경할 수 없게 한다. 중복 부여는 충돌로 처리하고 이미 회수된 업로더의 반복 회수는 변경 없음으로 반환한다. 전환 결과는 UI에 재로그인 필요 여부와 함께 명확히 표시한다.

부여는 기존 관리자 부여와 동일하게 서버 bot으로 대상의 가입을 새로 확인한다. 대상은 이미 등록된 active 계정이어야 하고 유효 세션 유무나 최근 로그인 시각은 요구하지 않는다. suspended는 새 적격 로그인 전까지 부여 불가다. 외부 조회는 DB 잠금 전에 수행하고 버전 보호로 오래된 성공 증거가 새 탈퇴 판정을 덮지 못하게 한다. 회수는 Discord 장애 중에도 로컬 권한으로 처리한다.

업로더 부여의 관리자·오너 보호 대상 검사는 외부 가입 조회 전에 수행한다. 조회 중 역할이 바뀌거나 부여자 권한이 회수될 수 있으므로, 성공뿐 아니라 비회원 응답을 저장하기 전에도 정렬된 계정 잠금 아래 부여자와 대상의 현재 권한을 재검증한다. 보호 대상에 대한 거부는 기존 grant·세션을 변경하지 않는다.

회수 시 기존 관리자 회수와 같이 브라우저까지 로그아웃한다. 브라우저 조회 세션을 유지하는 선택지는 별도 수명주기 정책을 추가하므로 이번에는 채택하지 않는다. viewer→uploader 부여는 기존 브라우저 세션을 유지하지만 desktop 연결은 별도로 승인해야 한다.

### 4. 관리 UI와 서버 권한 분리

기존 `/admin/users`와 `사용자 권한` 메뉴를 admin/owner에 제공한다. 목록은 기존 등록 계정의 Discord ID·이름·최종 로그인·역할·상태·가입 확인 정보와 bounded 검색/페이지를 유지한다. 관리자가 같은 대상 정보를 확인해야 하므로 이 목록의 공개 범위를 admin까지 명시적으로 확장한다. 전체 Discord 명단이나 게임 모임원 연결은 제공하지 않는다.

- 역할 표시는 `일반 사용자`, `업로더`, `관리자`, `서비스 오너`로 통일한다.
- viewer 행은 `업로더 권한 부여`, uploader 행은 `업로더 권한 회수`를 제공한다.
- owner에게만 기존 관리자 부여/회수 버튼을 제공한다. uploader의 관리자 승격 시 세션 폐기 안내를 표시한다.
- admin/owner 행에는 업로더 토글을 표시하지 않는다. suspended 계정의 부여는 비활성화한다.
- 가입 점검 운영 정보와 감사는 별도 owner 조회에 남긴다. 업로더 버튼에 대응하는 Server Action은 admin/owner를 검사하며 관리자 동작은 계속 owner를 검사한다. 임의 role 문자열을 받는 범용 변경 액션으로 합치지 않는다.

공통 layout, 관리 landing, 게임/모임원 페이지의 편집 버튼, OAuth callback의 redirect 경로 분류를 capability별로 정리한다. `/admin/users`는 admin/owner, 나머지 관리 기능은 기존 admin/owner, `/admin/audit`는 owner, `/upload`는 uploader/admin/owner다. Proxy는 낙관적 로그인 확인만 맡고 각 page/DAL/action/route가 최종 인가한다.

### 5. 업로드·감사·트랜잭션

관리 변경용 `lockActorAuthority`를 uploader까지 일괄 완화하지 않는다. upload와 management의 요구 capability를 명시하거나 업로드 전용 wrapper를 추가하고 모든 호출부를 분류한다. 예약·토큰·process·ingest 최종 저장은 upload capability, 일반 관리 mutation은 management capability를 재검증한다. desktop는 계정 역할뿐 아니라 세션 종류·scope·기기 귀속까지 검사한다.

업로드 바인딩은 계정 + 역할 + 해당 종류의 grant ID + 채널이며 desktop는 기기 세션도 포함한다. uploader→admin 승격, 회수→재부여, owner 변경으로 과거 예약이 새 권한으로 재해석되지 않는다. 사용자가 업로드한 게임의 수동 수정/삭제 권한은 부여하지 않는다.

계정 UUID 정렬 잠금 → 세션 → grant → 관련 기기/예약 순서의 기존 수명주기를 검토하고 양쪽 경로에 동일한 순서를 적용한다. grant 부여·회수, 탈퇴 판정, refresh, 승인 교환, 최종 ingest 사이의 직렬화를 실제 PostgreSQL 동시성 테스트로 증명한다. 회수 완료 뒤 과거 권한으로 새 저장이 커밋되지 않아야 한다. 이미 발급한 Blob 직접 전송 권한은 즉시 취소할 수 있다고 가정하지 않으며, 늦은 PUT/콜백은 게임 저장 권한을 복구하지 않고 기존 만료 정리가 처리한다.

`uploader.granted`/`uploader.revoked` 감사는 권한 변경과 원자적으로 기록하고 actor/대상/grant 종류와 ID를 남긴다. 업로더 업로드 감사와 정리 작업의 시스템 actor 재구성도 새 역할·grant를 지원한다. 감사 allowlist와 실제 DB readback까지 확인하고 과거 event snapshot은 바꾸지 않는다. 오너만 감사 조회가 가능하다.

탈퇴/pending 확인 시 uploader grant까지 다른 권한·browser/desktop 세션과 함께 폐기한다. 재가입 시 비오너는 viewer이며 권한은 명시적 새 부여로만 복원한다.

#### 업로드 파일과 게임을 추적하는 감사

기존 `replay.reserved`/`replay.processed` 이벤트를 확장하여 웹·desktop 모두 같은 업로드 ID로 예약과 최종 결과를 연결한다. 현재 `AuditChanges` allowlist에 파일명·파일 해시가 없으므로 타입, 저장 allowlist, 조회 DTO와 오너 감사 화면까지 함께 갱신해야 한다.

| 정보           | 기록 원칙                                                                                                                                                                                       |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 업로드한 사람  | 검증된 로그인 계정 ID, Discord ID, 당시 표시 이름·역할, 적용된 grant 종류/ID snapshot                                                                                                           |
| 업로드 식별    | 서버 업로드 ID를 request/target correlation으로 사용, browser/desktop 채널, desktop 기기 세션 ID                                                                                                |
| 제출 파일      | 검증된 basename만 `originalFilename`에 저장하고 기존 저장 문자열 길이 한도를 적용한다. 로컬 전체 경로·제어문자는 보관하지 않는다. 예약 시 없는 메타데이터는 확보 시점의 처리 이벤트에 기록한다. |
| 파일 내용 식별 | 서버에서 실제 바이트로 계산한 SHA-256 `fileHash`; 계산 전 실패는 없음으로 표현하고 클라이언트 주장 해시를 검증된 해시로 기록하지 않는다.                                                        |
| 결과           | 예약 접수와 최종 처리 구분, 발생 시각, success/duplicate/failure, 안전한 실패 reason; success/duplicate는 최종 gameId 연결                                                                      |

서버 예약은 파일 바이트 수신이나 게임 저장 성공을 의미하지 않는다. 성공·중복 판정과 감사는 같은 트랜잭션에서 커밋하며, 중복 파일도 제출자와 업로드 ID를 별도로 남겨 기존 게임에 연결한다. 재시도는 같은 업로드의 최종 이벤트를 반복 생성하지 않는다. parse 오류·회수로 인한 중단·만료 등 서버가 관찰한 실패는 안전한 결과와 함께 남기고, 브라우저 종료처럼 관찰할 수 없는 사유를 추정하지 않는다. 실패 감사 저장이 일시적으로 불가능하면 성공으로 표시하지 않고 기존 미완료 상태·정리 경로를 통해 후속 감사가 가능하도록 한다.

`pending_uploads.audit_metadata`는 nullable JSONB로 예약 basename과 관찰된 실패 reason·서버 해시를 보관한다. 기존 행은 null을 유지한다. 실패 관찰 저장과 terminal 감사 트랜잭션을 분리하여 감사 삽입만 실패해도 정리 작업이 원래 사유와 해시를 복원한다. DB 자체에 관찰 정보를 저장할 수 없는 장애까지 보존을 보장하지는 않는다. 이미 검증된 desktop 처리의 실패는 기존 actor·device·nonce·claim 귀속으로 제한하고 회수된 현재 권한에 재인가를 요구하지 않는다. 성공 저장은 계속 현재 권한을 검사한다. terminal 성공·중복 결과는 후속 실패로 덮어쓰지 않는다. 웹 처리 요청의 선택적 파일명이 없으면 예약의 basename을 사용하며 기존 예약 감사도 호환 fallback으로 읽는다.

오너 감사 화면은 계정, 파일명, 업로드 ID, 채널, 결과, 발생 시각과 gameId를 읽을 수 있게 표시하고 게임이 존재하면 해당 게임으로 연결한다. 계정 표시 이름 변경·권한 회수·예약 정리·게임 삭제로 기존 감사 snapshot을 덮어쓰거나 연쇄 삭제하지 않는다. 삭제된 게임은 ID와 과거 결과를 유지하고 사용할 수 없는 링크임을 표시한다. 기존 감사 보존 정책은 유지하며 새 만료 기간을 도입하지 않는다. 원본 리플레이 내용, 로컬 전체 경로, 세션 비밀, Blob URL/서명 URL은 감사에 넣지 않는다.

### 6. Desktop 및 동시 OpenSpec 합성

업로더는 기존 `replay:upload replay:status` scope와 승인·PKCE·refresh·기기 한도·수명 규칙을 사용한다. role CHECK, 승인 요청 snapshot, access/refresh 인가, session 응답 enum/fixture, 오류 안내에 uploader를 반영한다. 새로운 scope나 공개 URL/DTO 필드는 만들지 않는다.

변경 전 Windows 앱의 `internal/desktop/client.go` session 검증은 admin/owner 이외의 역할을 거부한다. uploader를 실제 지원하려면 서버 enum 변경뿐 아니라 앱 파서와 고정 사본 갱신이 필요하다. 발행된 지원 릴리스의 동일 여부는 구현 단계에서 별도로 확인한다.

다른 활성 변경의 작업 완료 기록을 이번 계획에서 덮어쓰지 않는다. 구현 첫 단계에서 `add-desktop-replay-upload-api`의 다음 요구사항을 합성한다.

| 병행 명세                                                | 합성 내용                                                                           |
| -------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `desktop-device-authorization`                           | 승인·교환의 uploader 허용, 원래 역할/grant를 검증하는 refresh, 회수·승격 후 새 승인 |
| `discord-session-authorization`                          | browser/desktop 분리·탈퇴 폐기·scope 제한을 보존하며 uploader 추가                  |
| `account-audit-upload-binding`                           | 기기·채널 감사 필드와 계정별 공유 예산을 보존하며 uploader grant 바인딩 추가        |
| `replay-upload`                                          | 기존 웹 URL/DTO와 direct Blob 흐름을 유지하고 업로드 역할 허용 목록 확장            |
| `desktop-replay-upload-api`, `blob-processing-ownership` | 역할/grant 관련 admin 전용 문구와 모든 최종 저장 경로를 대조                        |

본 change의 델타는 이미 정의된 desktop 추가 요구를 누락하지 않는 합성본을 기준으로 작성한다. desktop 고유 신규 capability는 그 change에서 관리하고 uploader의 교차 계약은 `uploader-role`에 정의한다. 어느 change를 먼저 아카이브하더라도 나중 delta의 전체 requirement가 네 역할 정책·desktop 제약을 되돌리지 않도록 먼저 rebase/내용 대조한다. 각 change의 필수 검증 완료 여부는 독립적으로 판단한다.

생년 조회 변경은 `add-match-management-and-member-history`의 목록 표시·viewer 생년 숨김 delta와 `improve-redis-cache-efficiency`의 cache invalidation 시나리오에도 겹친다. 해당 변경의 기존 구현 상태는 보존하고, 구현 시작 및 각 아카이브 전에 본 계획의 모든 로그인 역할 생년 허용 정책으로 합성한다. 모임원 검색 suggestion, 경기 roster, 관계 요약처럼 모든 역할에 생년 필드를 제공하지 않는 기존 최소 DTO는 확장하지 않는다.

### 7. 문서와 저장소별 완료 범위

`docs/documentation.md` 기준으로 구현 시 README 권한 표, `docs/discord-auth.md`, `docs/architecture.md`, `docs/development.md`, `docs/deployment.md`, `docs/desktop-uploader.md`, `contracts/desktop-v1/{README.md,schema.json,fixtures.json}`을 갱신한다. 문서는 로컬 구현과 운영 적용 상태를 구분한다.

`llvy-uploader`의 `contracts/desktop-v1/`, 역할 파서·표시·session 테스트, README와 개발 안내는 서버 계약 고정 revision으로 별도 동기화한다. `llvy-wiki/wiki/uploader.md`, `wiki/architecture.md`, `wiki/decisions.md`와 해당 변경의 색인/log는 네 역할과 위임 범위를 설명한다. 앱 파서·테스트·안내와 위키 요약은 로컬에서 갱신했다. 계약 원본 `fe32e8a93a426b0446338d24c201c5b778dab682`와 앱 사본/hash를 로컬에서 고정했다. 계약 원격 공개와 실환경 검증은 미완료다. 형제 저장소 유무를 LLVY 빌드 조건으로 만들지 않는다.

## Risks / Trade-offs

- viewer 외 역할을 관리자 취급하는 기존 분기 → 부정 조건 전체 검색과 네 역할 교차 접근, 네 역할의 생년 조회 허용과 관리 권한 분리 회귀 검사.
- 새 role enum을 거부하는 구버전 Windows 앱 → 실제 소비자 파서와 고정 fixture 대조, 기존 admin/owner 호환 검사, 앱 준비 전 새 역할 배포 중단.
- 권한 회수 중 이미 시작한 Blob PUT → 최종 DB 인가 재검증과 기존 정리 경로; 즉시 물리적 전송 취소는 보장하지 않는다.
- 업로더→관리자 승격 시 재로그인 필요 → 명시적 안내와 새 grant 발급, 과거 기기·예약 재사용 방지.
- 여러 활성 change가 같은 requirement 수정 → 구현 시작/아카이브 직전 합성 검토, 어느 쪽도 다른 쪽 검증을 완료 처리하지 않는다.
- 관리자에게 로그인 계정 목록이 노출됨 → 업로더 관리에 쓰는 기존 최소 필드에 한정하고 credential·게임 연결·감사 정보는 반환하지 않는다.

## Migration Plan

1. 현재 branch와 병행 desktop migration 번호/상태를 다시 확인한다. `0009`를 덮어쓰지 않고 다음 사용 가능한 번호로 additive migration을 생성한다. uploader grant/nullable 바인딩/desktop role 제약을 추가하고 기존 데이터가 바뀌지 않는지 검증한다.
2. 기존 admin/owner 계약 호환성을 유지하는 서버 구현과 계약을 검증하고 앱의 고정 사본·파서 준비를 완료한다. 기존 사용자는 자동 승격하지 않으며 브라우저 쿠키 버전도 변경하지 않는다.
3. 네 역할 서버 코드와 호환 앱을 배포하고, 구버전 서버가 트래픽·진행 중 작업을 처리하지 않는 상태를 확인한 뒤 업로더 부여를 시작한다. 새 환경 플래그를 이 계획만으로 추가하지 않는다.
4. 스테이징에서 네 역할 UI/API, 실제 Discord 부여, 실제 Blob 웹·Windows 업로드, 권한 회수/승격 중 처리 차단을 검증한다. 운영 활성화 시 적용 migration/서버/계약/앱 revision과 확인 범위를 기록한다.
5. 롤백은 먼저 업로더 부여 진입을 차단하고 네 역할을 이해하는 코드에서 활성 uploader 권한·세션·기기·승인 요청을 감사와 함께 폐기한다. 승격 이력의 다른 유효 권한은 임의로 폐기하지 않는다. 진행 중 uploader 작업이 더 이상 커밋할 수 없음을 확인한 후 서버를 되돌린다. additive 컬럼·grant·감사 이력은 보존한다. 새 역할을 viewer 외 전부 admin으로 해석하는 구코드를 활성 uploader 상태에 바로 배포하지 않는다.
6. 구현·필수 로컬/브라우저/외부 검증·연계 계약 작업 완료 후에만 정식 명세를 합성·동기화하고 아카이브한다.

## Open Questions

기본 정책은 위와 같이 정한다: 관리자도 업로더 회수 가능, 관리자 회수는 viewer로 복귀, 승격 시 업로더의 이전 세션/기기는 폐기. 구현 전 계획 검토에서 변경되면 관련 specs/tasks를 함께 수정한다.

기술적 확인 항목은 지원 중인 Windows 릴리스의 role 파서 호환 범위, 병행 desktop 변경의 최종 migration/계약 revision, 실제 환경 검증 결과다. 이를 추정으로 완료 처리하지 않는다.

## Local implementation status

`0010_uploader_role.sql`과 별도 grant·snapshot, 업로드/관리 capability, 관리자 업로더 controls, 네 역할 생년 projection, 웹·desktop 파일 감사를 구현했다. query identity에 `member-birth-years-v2`를 포함해 이전 projection과 분리하며 TTL·revision 정책은 유지한다. 목록 클라이언트 필터의 `member-list-filter` 델타도 생년 노출 정책에 합성했다.

기존 desktop delta와 member-history/cache delta를 네 역할 정책에 맞췄다. 기본 desktop 명세를 먼저 동기화하고 uploader delta를 최종 적용한다. 다른 순서로 닫을 때도 합성된 내용으로 회귀 여부를 확인한다. 다른 활성 변경의 완료 체크는 변경하지 않았다. [로컬 검증과 남은 작업](../../../docs/validation/2026-10-19-uploader-role.md)을 따른다.
