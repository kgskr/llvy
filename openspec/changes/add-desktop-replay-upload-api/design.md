## Context

기존 혼합 계획에서 서버 범위를 분리한 활성 설계다. 서버 API·기기 바인딩·DB 마이그레이션을 로컬 구현했으며 운영 적용과 외부 서비스 검증은 남아 있다. [앱 설계](../../../../llvy-uploader/openspec/changes/add-go-windows-replay-uploader/design.md)는 Go UI·파일·로컬 자격 증명·Windows 릴리스를 담당한다. 아래 클라이언트 관찰 동작은 서버 공개 계약의 요구이며 이 저장소에서 앱을 구현한다는 뜻이 아니다.

현재 서버는 `/api/uploads`에서 예약과 nonce를 발급하고, `/api/blob/upload`에서 제한된 Blob 토큰을 발급한 뒤 `/api/process`에서 검증·파싱·저장한다. 브라우저 세션 쿠키와 현재 DB 계정/업로더·관리자 grant/오너 설정으로 권한을 판단한다. 업로드는 업로더·관리자·오너에게 허용되며 한 파일은 64 MiB 이하, 예약은 30분, 예약 한도는 계정별 10회·전체 50회/24시간이다. 실제 한도 키는 세션이 아닌 `upload:account`와 `upload:global`이다.

관련 구현은 `src/lib/session.ts`, `authority.ts`, `auth-store.ts`, `pending-upload-store.ts`, `upload-actor.ts`, `src/app/api/process/route.ts`다. 분리 전 웹 pending 행에는 기기 식별이나 재조회 가능한 처리 결과가 없었다. 현재 구현은 웹 공개 DTO를 보존하면서 기기 바인딩과 별도 데스크톱 작업 기록을 추가하고 공유 서비스를 사용한다.

## Goals / Non-Goals

**Goals:** 기존 웹 계약을 보존하는 기기 인증·직접 Blob 전송·멱등 예약·결과 복구·권한 잠금·감사·한도 및 독립 활성화.

**Non-Goals:** Go 앱·Windows UI·exe·Windows CI 구현, Worker/QStash 의존성, 현재 계획 분리 중 운영 배포나 DB 변경.

## Decisions

### 저장소와 계약 소유권

LLVY는 서버 코드·DB·브라우저 승인과 desktop-v1 계약 원본을 소유한다. 앱은 형제 `llvy-uploader`의 독립 Go 저장소이며, 일반 빌드에서 서로의 체크아웃을 요구하지 않는다. Windows CI와 exe 릴리스는 앱 저장소에서 수행하므로 LLVY에 client-only 경로 필터를 추가하지 않는다.

[계약 정책](../../../contracts/desktop-v1/README.md)에 따라 스키마·비밀 없는 fixture를 서버에서 관리하고 앱은 원본 commit·체크섬이 고정된 사본을 소비한다. 호환 서버 배포 후 앱을 릴리스하며 기존 exe의 v1 응답 의미를 유지한다. 기기 기능 기본 false와 웹 독립 실행을 유지하고 Worker/QStash 없이 데스크톱 업로드가 동작하도록 구현한다.

### 기존 웹 로그인에서 명시적으로 앱 권한을 위임한다

앱은 public client이며 공용 비밀키를 갖지 않는다. 제품의 서버 origin은 빌드 설정으로 고정한 HTTPS LLVY origin이다. 개발용 origin은 별도 개발 빌드에서만 설정하고, 제품 UI에 임의 서버 URL 입력을 두지 않는다.

1. 앱이 `127.0.0.1:0`에 먼저 bind하여 임시 포트를 확보하고 무작위 state와 PKCE verifier/S256 challenge를 생성한다.
2. `POST /api/desktop/v1/auth/requests`가 고정 client ID, challenge, state, `http://127.0.0.1:<port>/callback`, 로그인 유지 여부를 검증하여 10분짜리 연결 요청과 LLVY 내부 승인 URL을 만든다. 임의 host/path/userinfo/fragment/중복 query는 허용하지 않는다. transient/persistent 모드는 요청에 고정하고 교환 시 변경할 수 없다.
3. 기본 브라우저로 `/desktop/connect?request=<opaque-id>`를 연다. 미로그인 사용자는 기존 `/login`과 Discord 콜백을 거쳐 같은 내부 페이지로 돌아온다. 기존 Discord redirect URI와 OAuth scope는 유지한다.
4. 페이지에 계정·업로드 범위·앱 이름·연결 모드/수명을 표시한다. GET으로 승인하지 않고, origin/CSRF 검증을 거친 `연결 허용` POST에서 현재 업로더/관리자/오너 및 활성 브라우저 세션을 재검증한다. 기기 한도가 찼으면 본인의 기존 임시 연결 하나를 명시적으로 선택해 교체할 수 있다. 선택한 session ID는 승인 요청에 바인딩한다. 거절/만료/회수는 앱 연결을 생성하지 않는다.
5. 서버가 60초짜리 일회용 코드를 발급하여 등록된 loopback 주소로 code/state만 돌려준다. 앱은 Host/path/state와 callback 구조를 검증하고 제한 시간 후 listener를 닫는다.
6. `POST /api/desktop/v1/auth/token`은 code, 원래 client/redirect URI, PKCE verifier를 검증하고 단 한 번 원자적으로 소비하여 기기 세션과 토큰을 발급한다. 승인과 교환 사이 권한 회수도 거부한다. 교체 승인이 있으면 같은 계정의 활성 transient 세션임을 재검증한 뒤 기존 연결 회수와 신규 발급/한도 검사·감사를 계정 잠금 아래 같은 transaction으로 수행한다. 교환 실패 시 기존 연결도 유지한다.

이것은 LLVY가 발급하는 앱 인증이며 Discord 토큰을 exe로 전달하거나 Discord가 PKCE/loopback을 직접 처리한다고 가정하지 않는다. 이미 유효한 브라우저 세션의 승인은 새 Discord 로그인 없이 가능하다. 새 웹 로그인 자체의 guild 가입 확인은 유지한다.

연결 시작/교환은 trusted ingress identity와 PostgreSQL 공유 예산을 적용한다. 초기 제한은 시작·코드 교환 합계 IP별 10회/분·전체 100회/분이며 갱신은 별도 기기/IP/global 예산을 둔다. 만료 요청/코드는 생성 시 bounded cleanup과 maintenance로 회수한다. 두 모드의 활성 기기 세션 합계는 계정당 5개로 제한하고 만료/회수된 세션은 제외한다. 초과 시 임시 연결 교체 또는 기존 연결 해제를 안내하며 오래된 연결을 자동 회수하지 않는다.

### 기기 세션은 별도로 저장하되 기존 권한 잠금에 포함한다

데이터 변경 초안:

| 저장소                  | 역할                                                                                                                        |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `auth_sessions.kind`    | `browser` 기본값, 새 기기는 `desktop`; 기존 행·쿠키 유효성 유지                                                             |
| `desktop_auth_requests` | client/redirect/challenge/state, 승인 계정/브라우저 세션, 모드/교체 대상, 만료/소비 상태, 코드 해시                         |
| `desktop_sessions`      | `auth_sessions` 참조, 승인 당시 role/grant, 제한 scope, transient/persistent 모드, 절대 만료, 기기 표시명, 마지막 사용 시각 |
| `desktop_credentials`   | 접근/갱신 토큰 해시, 세대, 만료/소비/회수 상태, 재사용 감지용 hash/family tombstone                                         |
| `desktop_upload_jobs`   | 예약 참조, 기기 세션, 멱등 키/요청 fingerprint, 결과 또는 안정된 오류; 상세 결과와 멱등 tombstone 수명 분리                 |

접근 토큰은 256비트 이상의 opaque 값이고 수명은 `min(15분, 기기 잔여 수명)`이다. 로그인 유지가 꺼진 transient 세션은 최초 발급부터 최대 12시간, 선택한 persistent 세션은 최대 30일의 절대 수명을 갖는다. 갱신으로 이 수명을 연장하지 않는다. 브라우저 세션과 기기 세션의 수명/로그아웃은 독립적이다. 원문 토큰은 응답 시 한 번만 노출하고 서버에는 별도 도메인으로 구분한 `AUTH_SECRET` 기반 HMAC 해시만 저장하여 키 교체 시 기기 자격 증명도 무효화한다. 코드/state/PKCE verifier/토큰/서명 URL은 로그·감사·공유 캐시에 남기지 않는다.

앱 토큰은 `replay:upload`, `replay:status`와 자신의 연결 해제에만 사용한다. 별도 bearer 인증 어댑터가 새 API에서만 기기 actor를 만든다. 기존 `getSession`은 browser kind만 받고 bearer를 읽지 않는다. 공통 서비스도 작업 범위를 확인하여 기기 actor로 회원 관리/권한 관리/감사 조회를 호출할 수 없게 한다. 앱 토큰을 쿠키 값으로 넣거나 refresh token을 access token으로 쓰는 경우를 거부한다.

예약/전송 승인/처리/최종 저장 때 계정 활성 상태, guild, 세션 만료/회수, 현재 role/grant, 승인 당시 role/grant 및 scope를 재검사한다. 브라우저와 공유하는 계정 → auth session → grant 잠금 순서를 유지하고 기기/자격 증명/작업 행은 그 뒤에 정렬된 순서로 잠근다. 두 계정이 등장하면 기존처럼 계정 UUID 순으로 먼저 잠근다. 외부 HTTP 동안 DB 잠금을 유지하지 않는다.

grant 회수와 재부여, 계정 정지/탈퇴, owner 설정 변경 후에는 이전 기기 권한이 살아나지 않는다. 기존 탈퇴 처리의 auth session 일괄 회수에 기기 세션을 포함하고 기기 credential 및 미완료 작업도 회수한다. grant 회수 시 해당 grant에 묶인 기기 연결을 회수한다. 회수와 최종 저장의 경쟁은 실제 PostgreSQL 다중 연결 테스트로 검증한다.

기존 `applyMembership`의 pending 실패 처리와 `revokeAdministrator`의 grant/session 회수에 공통 desktop 회수를 연결했다. 관리자 회수는 회수된 grant ID에 묶인 desktop session/credential과 데스크톱 pending/job의 미완료 상태·claim을 같은 transaction에서 무효화하고 감사도 함께 기록한다. 완료 결과·canonical Blob·감사 이력은 보존한다. 계정 UUID 정렬 → auth session → grant → desktop session/credential → pending/job 순서와 각 종류의 ID 정렬을 공유하며 외부 Blob 삭제는 이 transaction에서 수행하지 않는다. 회수된 credential은 보존 의무와 무관하게 즉시 거부하고 물리 삭제는 기존 retention 규칙에 맡긴다.

감사 기록은 `AuditChanges` 타입과 `safeChanges`의 명시적 allowlist에 검증된 `deviceSessionId`, `channel`, `mode`, `replacedSessionId`를 추가해 기존 before/after JSON에 보존한다. `channel`/`mode`는 정해진 enum, session ID는 UUID로 검증하고 서버가 확인한 actor/승인 대상에서 채운다. 새 audit 전용 컬럼은 MVP에 추가하지 않는다. 단순히 이벤트 객체에 필드를 넣는 것으로 완료 처리하지 않으며 실제 저장 행을 조회해 값이 보존되고 credential/hash/code/verifier/서명 URL 등 비밀과 임의 필드는 제거되는지 검증한다.

현재 owner는 환경변수로 정해져 DB 변경 이력이 없으므로, owner 변경은 아래 운영 절차를 지켜야 이 보장이 성립한다. 매 owner 변경/rollback 전에 접근 가능한 과거 배포 URL을 포함한 모든 실제 serving version에서 desktop 기능을 비활성화하고 진행 중 발급을 drain한다. 전체 차단을 확인하지 못하면 owner 변경을 진행하지 않는다. 이어 감사와 같은 DB transaction에서 모든 기기 세션·미완료 인증 요청을 영구 회수한 뒤 owner 환경변수를 변경한다. 이전 credential 거부를 확인한 뒤에만 기능을 다시 켠다. 브라우저 세션은 이 절차로 회수하지 않는다. A→B→A 사이 기기 요청이 전혀 없어도 이전 A 토큰이 거부되는지를 검증한다. 임의 환경변수 편집을 자동 감지한다고 가정하지 않으며 이 절차를 배포/rollback의 필수 gate로 둔다.

갱신은 단일 비행(single-flight)으로 직렬화한다. 이미 소비한 refresh token의 재사용은 해당 기기 토큰 계열을 회수한다. 갱신 응답이 유실되면 자동 반복으로 복구하려 하지 않고 재로그인을 안내한다. 브라우저의 `/desktop/devices`에서는 본인 기기만 조회/해제하고 owner의 기존 관리 정책은 유지한다. 로그아웃 시 서버 회수를 시도하고 로컬 비밀은 항상 제거하며 서버 실패 시 미회수 상태를 알린다.

소비한 refresh credential의 HMAC·family 매핑은 해당 family의 절대 만료까지 보존한다. family를 영구 회수해 모든 access/refresh가 계속 거부되는 경우에만 그보다 일찍 정리할 수 있다. access 만료 정리와 이 tombstone 정리를 구분하고, 기존 auth session 정리도 필요한 결과/멱등 기록을 cascade 삭제하지 않게 한다. 활성 family의 오래된 refresh를 maintenance 후 재사용해도 family 회수가 동작해야 한다.

Windows의 로그인 유지·DPAPI·단일 인스턴스와 로컬 비밀 삭제는 앱의 `desktop-client-authorization` 명세가 소유한다. 서버는 transient 12시간/persistent 30일 절대 수명과 명시적 연결 회수·교체 계약을 보장한다.

### 새 API가 Blob 서명 URL을 발급하고 Go는 표준 HTTP PUT을 사용한다

설치된 `@vercel/blob` 2.5.0은 `issueSignedToken`과 `presignUrl`을 공개 export하고 정확한 pathname, operation, 만료, 크기, content type, overwrite 조건을 지원한다. 서버가 `operations: ['put']`와 정확한 예약 경로로 서명 URL을 만들고 Go는 raw HTTP PUT으로 파일을 보낸다. 서명 키/전체 저장소 토큰은 서버에만 둔다. Go에서 JS SDK의 내부 요청 규약을 복제하지 않도록 transfer 응답은 `{uploadUrl, method: 'PUT', headers: Record<string, string>, expiresAt}`로 정의한다. 서버의 버전 고정 Blob adapter가 URL과 필요한 헤더 값을 책임지고 Go는 검증한 HTTP 전송 지시를 적용한다.

전송 승인 수명은 `min(현재 시각 + 5분, 예약 만료)`로 제한하고, `application/octet-stream`, 64 MiB 상한, `allowOverwrite=false`, `addRandomSuffix=false`를 강제한다. public/private는 현재 서버의 Blob store 설정을 따른다. 제품에서 임의 리다이렉트를 따라가지 않고 LLVY bearer를 Blob 요청에 첨부하지 않는다. 서명 URL의 query도 자격 증명이므로 진단에서 지운다.

전송 요청 URL과 저장 객체 URL은 별도 검증 대상이다. 현재 `buildPresignedPutUrl`은 `https://vercel.com/api/blob/` Control API에 pathname/서명 query를 넣으며, 이 URL을 `*.blob.vercel-storage.com` 객체 URL로 검사하지 않는다. 서버와 앱은 제품 전송 endpoint의 HTTPS host/path allowlist를 확인한다. PUT 응답에 포함된 객체 URL은 configured store의 정확한 origin/path에 속해야 하며, process는 이 응답에 의존하지 않고 예약에서 URL을 도출한다.

현재 SDK의 `requestApi`/`createPutHeaders`는 access, content type, API version, store ID 등의 헤더를 붙이며 `presignUrl`만으로 access 헤더가 URL에 포함되는 것은 아니다. 초기 v1 헤더 allowlist 후보는 `content-type`, `x-vercel-blob-access`, `x-content-type`, `x-api-version`, `x-vercel-blob-store-id`, `x-add-random-suffix`, `x-allow-overwrite`다. 실제 필수 조합과 값은 선행 PUT 검증으로 확정해 계약 fixture에 고정하고, 버전 숫자나 store ID는 Go에 하드코딩하지 않는다. Go는 헤더 이름을 대소문자 무관하게 검증하고 중복 이름·CR/LF·미허용 헤더를 거부한다. `Authorization`, `Cookie`, `Host` 및 hop-by-hop/전송 길이 헤더는 응답 맵으로 설정하지 않으며 Content-Length는 검증한 파일 크기에서 HTTP 클라이언트가 설정한다. allowlist 확장이 필요하면 계약 호환성 검증 없이 이미 배포한 v1 앱에 새 필수 헤더를 보내지 않는다.

아직 Go→실제 Blob 서명 PUT은 검증하지 않았다. 구현 첫 단계에서 private/public store의 지원 범위, 실제 필수 헤더와 access 누락/변조, 요청 URL과 응답 객체 URL, 응답 형태, 초과 크기/다른 경로/만료/덮어쓰기 거부를 확인한다. 기능을 사용할 수 없으면 해당 작업을 미완료로 유지하고 설계를 수정한다. 서버리스 함수에 리플레이 본문을 프록시하거나 read/write token을 앱에 전달하는 우회는 하지 않는다.

| API                                          | 인증과 역할                                                      |
| -------------------------------------------- | ---------------------------------------------------------------- |
| `POST /api/desktop/v1/auth/requests`         | public + 공유 예산, 연결 시작                                    |
| `POST /api/desktop/v1/auth/token`            | 일회용 code + PKCE, 최초 토큰                                    |
| `POST /api/desktop/v1/auth/refresh`          | refresh token, 회전                                              |
| `POST /api/desktop/v1/auth/revoke`           | 본인 access 또는 refresh credential, 자신의 연결 회수            |
| `GET /api/desktop/v1/session`                | access bearer, 현재 계정/권한·프로토콜/한도 정보                 |
| `POST /api/desktop/v1/uploads`               | access bearer + `Idempotency-Key`, 파일 메타데이터로 예약        |
| `POST /api/desktop/v1/uploads/{id}/transfer` | access bearer + nonce, 제한된 PUT URL 발급                       |
| `POST /api/desktop/v1/uploads/{id}/process`  | access bearer + nonce, 예약에 저장한 store/path로 공유 처리 실행 |
| `GET /api/desktop/v1/uploads/{id}`           | access bearer, 해당 기기에 속한 작업 상태/최종 결과              |

예약 입력은 `filename`, `size`, `lastModified`, `clientSha256`이며 선택 보조인 경기 ID는 별도 진단 필드로만 받는다. 서버는 전송 바이트의 SHA-256을 직접 계산하고 client hash를 신뢰하지 않으며 불일치 시 저장하지 않는다. 새 JSON 오류는 `{error:{code,message,retryable},requestId}`이고 모든 인증/작업 응답은 `private, no-store`다. 웹 오류 DTO는 바꾸지 않는다. `401` 인증 만료, `403` 권한 회수, `409` 멱등 키 충돌/상태 충돌, `413` 크기 초과, `422` 파일 불일치/파싱 실패, `429` 공유 한도, `503` 일시 장애를 구분한다.

desktop process는 Blob URL을 입력받지 않는다. 서버가 `uploadId`에 바인딩된 configured store/path로 canonical 객체 URL을 도출하고 기존 정확한 origin/path 검증을 적용한다. 서명 PUT의 요청 URL은 객체 URL로 간주하지 않는다. PUT 응답을 한 바이트도 받지 못해도 앱은 이미 가진 uploadId/nonce만으로 존재 확인·처리를 요청할 수 있다. 기존 웹 process의 URL 입력 계약은 유지한다.

[Blob 소유권 델타](specs/blob-processing-ownership/spec.md)는 기존 `/api/uploads` → `/api/process` 바인딩과 새 desktop 예약 → desktop process 바인딩을 각각 명시한다. 서로 다른 경로의 예약이나 다른 기기의 예약으로 처리 권한을 얻을 수 없다. 웹의 소비·만료된 바인딩 거부는 유지한다. 데스크톱도 소비·만료된 예약으로 새 Blob 처리를 실행할 수 없으며, 보존 중인 결과 반환은 원래 기기의 현재 권한과 해당 API의 자격 증명을 검사한 뒤 Blob 읽기·저장·삭제 없이 수행한다. 결과 보존이 예약 수명을 연장하거나 회수된 기기 권한을 복구하지 않는다.

Proxy는 새 namespace에 명시적으로 기기 인증을 위임하고 Route Handler/DAL이 다시 검사한다. public auth 하위 경로를 허용해도 나머지 새 API가 익명이 되지 않도록 deny-by-default 테스트를 둔다. 브라우저 승인 페이지의 세션/CSRF 검증은 별도 유지한다. 웹 공개 계약에 bearer fallback을 추가하지 않는다.

### 순차 큐, 멱등 예약과 결과 재조회로 중복 전송을 줄인다

동시 파일 업로드는 1개다. 입력 100개 허용은 일일 예약 한도 증가를 의미하지 않는다. 사용자가 선택 목록을 확인하고 `업로드`를 눌러야 예약/전송을 시작한다. 상태는 `대기 → 예약 → 전송 → 처리 → 완료/이미 등록됨/실패`이며 별도로 `취소됨`, `결과 확인 필요`를 둔다.

`GET /api/desktop/v1/session`의 한도 snapshot은 `asOf`, account/global 각각의 `limit`, `remaining`, `resetAt`를 제공한다. 만료된 counter는 현재 구간의 잔여량으로 해석하며 아직 활성 구간이 없으면 resetAt은 null이다. UI는 `선택한 파일 N개`와 `현재 24시간 구간의 남은 예약 M회`를 업로드 전에 나란히 표시하고 M은 account/global 잔여량 중 작은 값으로 계산한다. 자정 초기화를 뜻하는 `오늘`은 쓰지 않는다. 중복·실패도 이미 생성한 예약 1회를 소비하며 환급하지 않음을 안내한다. 선택 수가 M보다 크면 일부만 가능하다는 경고와 선택 수정 기회를 제공한다. snapshot은 실행 권한/슬롯 예약이 아니므로 다른 웹·앱 요청으로 달라질 수 있으며 각 예약과 429가 최종 판단이고 이후 snapshot을 갱신한다. 클라이언트 hash만으로 서버 중복을 확정해 예약/바이트 검증을 건너뛰는 기능은 MVP에서 제외한다.

새 예약의 멱등 키는 기기 세션과 파일 메타데이터/hash에 바인딩한다. 같은 키·같은 입력은 같은 예약을 반환하고 다른 입력은 409다. 예약이 만료되어도 같은 키가 새 예약을 만들거나 만료를 연장하지 않으며, 사용자가 새 시도를 선택해야 새 키를 발급한다. 예약과 계정/전체 budget 소비, 작업 기록을 하나의 DB transaction에 묶어 네트워크 재시도나 동시 요청이 추가 한도를 소비하지 않게 한다. 기존 웹 quota의 키·수치·반환 계약을 보존하며 내부 budget helper의 transaction 지원은 별도 회귀 테스트한다.

현재 `consumeRequestBudgets`는 자체 transaction을 커밋하고 `createPendingUpload`는 이를 권한 transaction보다 먼저 호출하므로 desktop 예약에서 이 조합을 그대로 재사용하지 않는다. `consumeRequestBudgetsInTx(tx, budgets)`를 분리해 caller의 transaction만 사용하고 모든 예산 키를 정렬하여 upsert한다. 기존 wrapper도 같은 정렬 규칙을 사용하되 웹 공개 동작은 유지한다. desktop 예약은 `lockActor` → 기기 세션 행 `FOR UPDATE` → 같은 멱등 키/보존 기록 조회 → 신규 요청에만 정렬된 예산 차감 → pending/job/감사 삽입 순서다. 현재 `lockActor`의 SHARE 잠금만으로는 같은 기기의 두 최초 요청이 직렬화되지 않으므로 기기 행 잠금과 unique 제약을 함께 둔다. 예산 부족은 typed error를 outer transaction 밖까지 전파해 앞서 갱신한 예산도 모두 rollback하고 거기서 429로 변환한다. pending/job/감사 실패 역시 같은 transaction을 rollback한다. 예산 잠금을 잡은 채 나중에 권한 잠금을 얻는 경로는 도입하지 않는다.

상세 결과는 7일 보존하되 기기 ID·멱등 키·fingerprint·uploadId·예약 만료를 포함한 작은 tombstone은 기기 세션의 절대 만료까지 유지한다. 상세 결과 정리 후 같은 키·같은 입력은 `409 reservation_expired`, 다른 입력은 `409 idempotency_conflict`로 응답하고 새 예약/예산 소비를 하지 않는다. 기기가 영구 회수되어 모든 자격 증명이 거부되면 멱등 tombstone은 조기 정리할 수 있다. 결과 7일 보존 자체는 auth/pending cleanup과 독립적이며, 회수된 기기에 조회 권한을 다시 주지는 않는다.

reservation nonce는 DB에 hash만 남긴다. 응답 유실 복구를 위해 서버가 `AUTH_SECRET`에서 분리한 키로 `uploadId`에 대한 결정적 256비트 nonce를 생성/재생성하는 데스크톱 전용 방식을 사용하고, 기존 랜덤 웹 nonce는 유지한다. 응답 복구는 같은 기기와 멱등 요청에만 허용한다. 키 변경은 재인증/새 예약을 요구한다.

처리는 저장된 작업 상태를 먼저 검사하여 진행 중/terminal 요청을 반환하고, 신규 pending 작업에 대해서만 서버 자격 증명으로 정확한 객체의 존재를 제한된 HEAD로 확인한다. 확정된 404는 pending을 유지하는 `object_not_uploaded`로 반환하고, 5xx/timeout은 부재로 간주하지 않는다. 객체가 확인되면 pending을 원자적으로 한 번 claim하며 claim 만료는 `min(현재 시각 + 2분, 예약 만료)`로 둔다. 성공/duplicate 결과의 `gameId`와 서버 계산 hash를 게임 저장과 같은 최종 transaction에서 작업에 기록한다. 응답이 유실되어도 GET으로 완료 결과를 복구한다. 같은 process 요청은 진행 중이면 202, 완료되었으면 저장된 결과만 반환하며 Blob 재읽기/재삭제를 수행하지 않는다. 기존 웹 `/api/process`의 소비된 바인딩 거부 계약은 유지한다.

`ingestReplay`의 사전 duplicate, 신규 game 삽입, unique 충돌 duplicate 세 성공 분기를 모두 다룬다. shared ingestion에 서버 내부의 transaction finalizer를 두고 desktop 경로에서는 필수로 전달한다. 각 transaction은 authority와 해당 job/claim을 공통 순서로 먼저 잠그고, 커밋 전 finalizer에서 최신 시각 기준 claim 소유권/만료를 다시 검사해 `gameId`, `duplicate`, `serverSha256`, job terminal 및 pending 상태를 감사와 함께 기록한다. 사전 duplicate의 바깥 조회는 최적화일 뿐 완료 결과 확정은 이 transaction에서 한다. 신규 저장에서는 game/participants/cache revision도 같은 transaction에 포함한다. finalizer 실패 시 모든 해당 변경이 rollback되며 `ingestReplay()` 반환 후 별도 `finishPendingUpload()` 호출로 desktop 성공을 완성하지 않는다. HTTP/Blob 정리와 캐시 알림은 transaction 밖에서 수행하고, 롤백이 확정된 DB 오류의 재시도에만 finalizer를 함께 재실행한다. COMMIT 응답 유실은 상태 조회로 복구하며 보존해야 할 Blob을 삭제하지 않는다.

서버 처리 실행이 중단되어 처리 완료 여부가 확정되지 않은 작업은 중단됐다는 이유만으로 자동 재실행하지 않는다. 처리 기한 후 `outcome_unknown`을 표시하고 확인/수동 재시도를 제공한다. 이전 작업의 최종 저장은 활성 claim/만료를 다시 확인하여 새 작업과 경쟁하지 못하게 한다. 재예약이 필요하면 사용자에게 한도 소비 가능성을 알리고 새 키로 진행한다. 중복 해시는 최종 서버 방어선이다. 작업 결과는 예약 생성부터 7일 동안 조회 가능하도록 bounded 유지하고, 기존 pending 정리가 결과를 cascade 삭제하지 않도록 참조/정리 순서를 설계한다.

네트워크 오류 시 reservation/조회처럼 안전한 작업만 최대 3회 jitter backoff 재시도한다. PUT 응답 유실은 같은 경로의 overwrite를 시도하지 않고 처리 API가 정확한 객체 존재/바이트를 확인하도록 한다. 객체가 없다고 확인된 경우에만 같은 예약으로 재전송한다. access 만료는 한 번의 직렬 갱신 후 동일 작업을 재시도하고, refresh 응답 유실·403은 큐를 멈춘다. 429는 Retry-After/reset 정보를 표시하고 일일 예산 소진이면 전체 대기를 일시 중지한다. 단일 파일 오류는 다른 항목을 계속 진행할 수 있다.

취소는 이후 큐와 현재 HTTP 전송을 중단한다. 이미 시작된 서버 저장을 취소했다고 단정하거나 성공 데이터를 삭제하지 않고 상태를 확인한다. 앱 종료 후 자동 큐 복원은 MVP에 포함하지 않으며, 재실행 후 같은 파일 업로드는 서버 중복 방지를 따른다.

### 검증 책임

서버 단위·계약·기존 웹 회귀와 `npm run check`, 실제 PostgreSQL 다중 연결 검증은 LLVY에서 실행한다. 앱은 별도 저장소에서 고정 계약의 Go·Windows 검사를 실행한다. 실제 브라우저 승인→Go→Blob→ROFL 저장·중복·회수의 공동 스테이징 검증은 두 계획의 완료 조건이며, 상대 저장소의 필요한 결과를 commit/계약 버전과 함께 기록한다.

## Risks / Trade-offs

- [Win32 직접 UI의 구현 부담] → 화면을 하나로 제한하고 초기 spike로 한국어/DPI/접근성/스레드 모델을 먼저 확인한다.
- [LoL 설정 파일과 설치 흔적의 변화] → 문서 Known Folder와 수동 선택을 기본 탈출 경로로 유지하고 확인한 형식만 읽는다.
- [Blob 서명 PUT의 실제 store 호환성] → 현재 SDK 타입은 확인했지만 배포 기능을 가정하지 않고 스테이징 계약 검증을 선행한다.
- [인증 권한 확대 또는 기존 웹 회귀] → 별도 namespace/kind/scope를 사용하고 기존 URL/DTO/로그인에 영구 회귀 테스트를 둔다.
- [회수 후 이미 발급한 Blob URL] → 발급 후 최대 5분 동안 바이트 전송은 가능할 수 있다. 새 승인과 최종 저장은 즉시 현재 DB 권한으로 차단하고 잔여 객체는 기존 정리 작업에 맡긴다.
- [큰 큐와 작은 현재 한도] → 계정별 10회·전체 50회/24시간을 유지하며 명확한 중단/잔여 안내를 제공한다. 배치가 한도를 우회하지 않는다.
- [기기 토큰 회전 응답 유실] → 자동 재시도 대신 재로그인으로 복구해 재사용 감지 정책을 단순하고 검증 가능하게 유지한다.
- [일반 Windows와 CI 환경 차이] → runner는 빌드/자동 테스트 증거로만 사용하고 사용자 권한·실제 LoL·DPI는 별도 검증한다.
- [진행 중인 다른 OpenSpec changes] → 캐시 등 무관한 변경은 건드리지 않는다. `harden-security-scan-findings`의 미완료 외부 검증과 업로드 소유권 요구는 함께 재확인하되 이 change의 성공으로 완료 처리하지 않는다.

## Migration Plan

1. UI/서명 PUT spike와 API fixture를 먼저 확정하고, 기존 웹 업로드 테스트 baseline을 기록한다.
2. 추가 테이블/nullable 참조와 `auth_sessions.kind='browser'` 기본값을 준비한다. disposable DB에서 기존 계정/쿠키/예약 보존과 강제 실패 rollback을 검증한다.
3. 서버 기능은 `DESKTOP_UPLOADER_ENABLED` 기본 false로 배포 가능하게 한다. 비활성화 시 앱 인증/refresh/업로드를 거부하고 본인 연결 해제·maintenance는 유지한다. 실제 운영 DB 적용 전 backup 및 검증 branch 절차를 따른다.
4. 스테이징에 migration과 서버 API를 적용하고 기존 웹 및 새 앱의 end-to-end를 검증한다. 사용자 PC 검증이 남으면 작업을 미완료로 유지한다.
5. 운영 서버 호환 API를 먼저 준비하고 승인된 배포 절차로 기능을 활성화한 다음 고정 commit의 exe를 릴리스한다. session 응답은 `protocol`으로 현재 API 호환성을 안내한다. 최소 앱 semver 필드는 현재 v1 계약에 없으며 이를 요구하려면 별도 계약 변경과 호환성 검토가 필요하다. 자동 실행 업데이트는 하지 않는다.
6. 문제 발생 시 새 진입점/발급을 비활성화하고 필요 시 기기 세션을 회수한다. 기존 웹은 유지하며 기존 테이블/게임/감사/Blob을 되돌려 삭제하지 않는다. 추가 schema는 보존하고 별도 검증 없이 destructive down migration을 실행하지 않는다.
   owner 설정 변경 및 그 rollback은 별도로 모든 serving version의 desktop 비활성화·발급 drain → 모든 기기/미완료 인증 요청의 영구 회수 → 설정 변경 → 이전 토큰 거부 확인 → 재활성화 순서를 반드시 따른다.
7. 모든 구현·검증·문서 작업 완료 후에만 델타와 정식 명세를 대조하고 archive 및 `openspec validate --all --strict`를 수행한다.

## Open Questions

다음은 구현 초기에 증거로 확정할 항목이며, 현재 구현 완료를 의미하지 않는다.

- 실제 대상 Blob store에서 현재 SDK 서명 PUT의 동작과 응답: private/public 및 제한 enforcement를 staging에서 확인해야 한다.
- 실제 Windows 10/11 및 스테이징에서 필요한 검증 접근성: 확보되지 않으면 해당 작업과 change를 열린 상태로 유지한다.

## References

- [Riot Replay FAQ](https://support.riotgames.com/en-us/league-of-legends/gameplay/replays-faq-pro-tips/): 클라이언트에서 리플레이 저장 위치를 바꿀 수 있음. 특정 로컬 설정 파일 형식의 근거로 사용하지 않는다.
- [Native Apps OAuth / RFC 8252](https://www.rfc-editor.org/rfc/rfc8252.html): 외부 브라우저, loopback 및 PKCE.
- [Windows DPAPI](https://learn.microsoft.com/en-us/windows/win32/api/dpapi/nf-dpapi-cryptprotectdata): 사용자 범위 로컬 자격 증명 보호.
- [Windows Cloud Files 호환성](https://learn.microsoft.com/en-us/windows/win32/cfapi/build-a-cloud-file-sync-engine) 및 [Reparse tags](https://learn.microsoft.com/en-us/windows/win32/fileio/reparse-point-tags): cloud placeholder와 name-surrogate를 구분하며 실제 사용 API의 노출/읽기 동작은 Windows 검증으로 확인한다.
- [Go Windows cross-compiling](https://go.dev/wiki/WindowsCrossCompiling): 크로스 빌드와 CGo 제약.
- [GitHub runner specifications](https://docs.github.com/en/actions/reference/runners/github-hosted-runners): `windows-2025` x64와 기본 관리자 실행 환경.
- [Vercel client uploads](https://vercel.com/docs/vercel-blob/client-upload): 함수 본문을 경유하지 않는 직접 전송. 서명 API의 구체적인 현 버전 계약은 설치된 `@vercel/blob` 2.5.0의 `dist/index.d.ts`와 `dist/create-folder-DFjrvss1.d.ts`에서 확인했으며 실제 전송 검증은 미수행이다.

위 외부 자료와 SDK 관찰은 분리 전 계획의 근거다. 이번 작업에서 외부 서비스 동작을 다시 검증한 기록이 아니며 구현 전 재확인한다.

## 로컬 구현 근거 (2026-10-18)

`src/lib/desktop/`와 API/브라우저 경로, migration 0009를 구현했다. 제품 앱의 origin은 앱 빌드의 `LLVY_SERVER_ORIGIN`으로 지정한다. 고정 JSON의 `productOrigin`은 당시 계약 메타데이터이며 실행 주소 기본값이 아니다. @vercel/blob 2.5.0의 서명 전송은 `https://vercel.com/api/blob/`를 사용하며 후보 descriptor를 `contracts/desktop-v1/`에 기록했다. 실제 PUT spike는 남아 있으므로 헤더 계약과 릴리스는 미확정이다. 기본 false를 유지하고 실제 환경 검증 전 change를 아카이브하지 않는다.

## 복구 경계 보완

기기 목록은 활성 연결을 먼저, 이후 최신 이력을 반환하며 전체 100개로 제한한다. 계정의 최대 5개 활성 연결이 과거 기록에 가려지지 않는다. 연결 요청 생성은 공유 예산 승인 후 만료 요청 최대 10개를 먼저 정리한다. 만료 순서의 행 잠금과 SKIP LOCKED로 동시 생성의 중복 정리 경쟁을 피하고 활성 요청은 보존한다. 일일 maintenance는 같은 정리 함수로 최대 500개를 추가 회수한다. 계속 유입되는 요청마다 생성보다 많은 만료 기록을 정리하여 일일 Cron 처리량에만 의존하지 않는다.

## 운영 전체 회수 명령

`npm run desktop:revoke-all`은 환경파일을 자동으로 읽거나 DB에 연결하지 않고 실행 계획만 출력한다. `--apply` 실행에는 `DESKTOP_UPLOADER_ENABLED=false`, 명시적 `POSTGRES_URL`, URL과 일치하는 `--database-target host[:port]/database`, `--all-deployments-disabled`, `--issuance-drained`가 필요하다. 인자는 운영자가 완료한 외부 차단과 drain을 확인하는 것으로, 명령 자체가 배포 상태를 검증하거나 변경하지 않는다. 실행은 기존 `revokeAllDesktopConnections()`를 재사용하며 브라우저 세션을 보존한다. 임시 Node 번들은 실행 후 제거하며 자격 증명이나 DB 오류 본문은 출력하지 않는다. LoL 경로·exe 성능·리소스·코드 서명 관련 미결정과 Windows 검증은 앱 설계에서 관리한다.

### 한도 소진 재시도 시각

공유 예산 helper는 정렬된 키 순서와 transaction rollback을 유지하며, 거부한 카운터의 `resetAt`을 같은 transaction에서 조회해 `BudgetExceeded`에 전달한다. desktop 429는 응답 시점 기준 남은 초를 올림하고 최소 1초로 표시한다. 시각 근거가 없으면 Retry-After를 생략한다. 여러 한도가 소진된 경우 이 값은 현재 거부한 카운터의 최소 재시도 대기 시간이며 다음 요청의 성공이나 슬롯을 보장하지 않는다. 기존 웹의 boolean 예산 API와 한도 소비 정책은 유지한다.

### 업로더 역할 변경과 합성

`add-uploader-role`의 네 역할·생년 조회·grant 전환·파일 감사 delta를 합성한다. desktop 요청/세션에는 별도 uploaderGrantId를 보존한다. desktop 기본 change를 먼저 동기화하고 uploader delta를 최종 정책으로 적용한다. 순서가 바뀌어도 이 합성된 delta가 구권한으로 되돌리지 않아야 한다. 기존 desktop 실환경 수용 검증 체크 상태는 그대로 유지한다.
