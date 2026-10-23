# Windows 업로더와 LLVY 서버

상태: 2026-10-23 운영 DB에 `0008`~`0010` migration을 적용하고 호환 서버를 배포했다. 운영 환경은 `DESKTOP_UPLOADER_ENABLED=true`로 활성화했으며, 미설정 시 기본값은 false다. 서버 배포 결과와 남은 실제 Blob/Discord/Windows 검증은 [운영 검증 기록](validation/2026-10-23-uploader-deployment.md)을 따른다.

## 관리 경계

- [서버 계획](../openspec/changes/add-desktop-replay-upload-api/proposal.md): 브라우저 승인, 기기 인증·회수, 업로드 API, DB·감사·공유 한도.
- [앱 저장소](../../llvy-uploader/README.md): Go·Win32, 파일 탐색, 사용자 범위 자격 증명, 순차 전송·복구, Windows 검사.
- [계약 원본](../contracts/desktop-v1/README.md): 서버가 관리하는 후보 스키마·fixture. 앱은 commit·체크섬이 고정된 사본만 소비한다.
- [검증 기록](validation/2026-10-18-desktop-uploader.md): 자동 검사와 실제 서비스 미검증 범위.
- [위키](../../llvy-wiki/wiki/uploader.md): 프로젝트 연결 맥락.

제품 앱은 빌드 시 필수 `LLVY_SERVER_ORIGIN`에 고정한 HTTPS origin의 `/api/desktop/v1/`와 서버가 승인한 Blob PUT에 직접 연결한다. 서버 `DESKTOP_UPLOADER_ENABLED`는 기능 활성화를 제어하며 앱의 연결 주소를 변경하지 않는다. 고정 계약 JSON의 `productOrigin`은 출처 메타데이터이고 앱의 기본 주소가 아니다. Worker·QStash·형제 저장소는 런타임/빌드 조건이 아니다. 웹 업로드 경로와 쿠키 계약은 유지한다.

## 연결과 해제

앱의 `LLVY 로그인`은 기존 Discord 브라우저 로그인을 사용한다. `/desktop/connect`에서 계정·권한·연결 수명을 확인하고 `연결 허용`을 눌러야 기기가 발급된다. PKCE S256·일회용 코드·literal loopback callback을 사용한다. uploader/admin/owner는 승인할 수 있고 viewer는 승인할 수 없다.

기본 임시 연결은 최대 12시간, 로그인 유지는 최대 30일이다. access는 최대 15분이며 refresh 회전으로 절대 수명이 연장되지 않는다. 계정별 활성 기기 합계는 5개다. 승인 화면에서 본인의 임시 연결 하나를 명시적으로 선택하면 교환 transaction 안에서 교체한다. 이전 refresh 재사용은 해당 기기를 회수한다. 불확실한 갱신 응답은 재로그인이 필요하다.

refresh의 `429 rate_limited`는 토큰 교체 전에 반환한다. 앱은 이 응답에서 보관 토큰·기기·예약 정보를 유지하고 Retry-After를 안내한다. 시작 시 보관 연결 복구와 업로드 후 한도 조회가 제한된 refresh를 즉시 재호출하지 않으며 사용자가 다시 시도한다. 응답 유실·손상처럼 교체 여부가 불확실하면 계속 재로그인을 요구한다.

`/desktop/devices`는 본인의 기기만 보여 주고 해제한다. 활성 기기를 먼저 표시하고 최신 비활성 이력을 포함해 최대 100개를 반환하므로 과거 연결이 활성 기기의 해제·교체를 가리지 않는다. 앱 로그아웃은 본인 access/refresh로 자신만 회수한다. 기능이 꺼져도 해제와 maintenance는 작동한다. 브라우저 로그아웃과 기기 로그아웃은 독립적이다. 업로더/관리자 회수·업로더의 관리자 승격·탈퇴는 미완료 기기 작업과 claim을 함께 무효화한다.

## 업로드와 복구

한 파일은 64 MiB 이하이며 웹과 함께 계정 10회·전체 50회/24시간 예약 한도를 쓴다. session의 한도는 관찰 시점의 안내값이다. 한도 소진 429의 `Retry-After`는 거부한 카운터의 실제 초기화까지 남은 초를 올림한다(최소 1초). 초기화 시각이 없으면 헤더를 생략한다. 이 대기 시간은 슬롯이나 다음 요청의 성공을 보장하지 않으며, 다른 한도도 소진됐다면 이후 요청에서 다시 거부될 수 있다. 중복·처리 실패도 예약을 소비한다. 같은 기기의 같은 멱등 키·메타데이터는 같은 uploadId/nonce를 복구하고 추가 차감하지 않는다. 앱은 예약 시도 여부를 별도로 보관하여 잔여 0에서도 복구하며, process 전에 access 수명 2분을 확보한다.

예약은 30분, claim은 최대 2분이다. process는 nonce만 받고 예약에 저장한 store/path를 사용한다. 서버가 size/SHA-256을 확인하고 기존 파서로 처리한다. 게임·참가자·cache revision·pending/job 결과·감사는 같은 transaction에서 확정된다. 이미 처리한 요청은 Blob을 다시 읽거나 삭제하지 않고 저장 결과를 반환한다.

정규화된 게임 버전·챔피언은 UTF-8 256바이트, 원본 파일명은 1,024바이트의 저장 상한을 적용한다. 초과 값은 `invalid_replay`로 거부하며 앱 예약 요청의 기존 255 UTF-16 코드 단위 파일명 계약은 유지한다. [저장 제한과 refresh 복구 검증](validation/2026-10-22-review-fixes.md)에 로컬 검사 범위를 기록한다.

PUT 응답 유실 후 overwrite하지 않고 process로 존재를 확인한다. 정확한 HEAD 404만 `object_not_uploaded`이며 저장소 오류는 부재로 해석하지 않는다. 처리 응답 유실은 GET 상태로 복구한다. claim이 만료된 미확정 작업은 `outcome_unknown`으로 남고 자동 재처리하지 않는다. 결과는 예약 생성부터 7일, 상세 정리 후 멱등 tombstone은 기기 절대 만료까지 보존한다. Blob 정리는 기존 canonical 게임 확인 절차를 따른다.

만료된 연결 요청은 예산 검사를 통과한 새 요청마다 최대 10개를 정리한 후 한 개를 생성한다. 만료 순서의 행 잠금과 SKIP LOCKED로 동시 작업의 중복 정리를 피하고 유효한 승인 요청을 보존한다. 일일 인증 maintenance도 최대 500개를 정리한다. 기기 credential·결과·멱등 기록의 보존 기간은 바꾸지 않는다.

## 배포 순서와 운영 회수

1. DB 백업/복원 계획을 확인한 뒤 `0009_desktop_uploader.sql`과 `0010_uploader_role.sql`을 schema-first로 적용한다. 2026-10-23 백업과 별도 검증 브랜치의 강제 rollback 확인 후 운영에 적용했다.
2. `DESKTOP_UPLOADER_ENABLED=false`로 호환 서버를 배포한다. 기존 웹 회귀와 maintenance를 확인한다.
3. 별도 스테이징 Blob/Discord 및 실제 Windows에서 계약·헤더·권한 회수·한도·전체 업로드 흐름을 검증한다. Go 교차 빌드는 Windows 실행 증거가 아니다.
4. 서버/계약/앱 revision과 검증 범위를 기록하고 flag 활성화·앱 릴리스를 구분한다. 2026-10-23 서버의 운영 flag를 활성화했다. 실제 Windows·Discord·Blob 전체 수용 검증과 앱 릴리스 완료를 의미하지 않는다.

장애 시 모든 접근 가능한 serving deployment에서 flag를 끄고 발급 중 요청이 끝날 때까지 drain한다. 단순 flag 변경은 기존 토큰의 영구 회수가 아니다. owner/secret 변경 및 rollback 전에는 동일한 차단을 적용한 뒤 `npm run desktop:revoke-all` 운영 명령을 아래 절차로 실행한다. 이 명령은 `src/lib/desktop/maintenance.ts`의 `revokeAllDesktopConnections()`를 재사용한다. 이 함수는 계정/기기 잠금 아래 모든 기기와 미완료 연결 요청을 영구 회수하고 브라우저 세션은 보존한다. 임의 HTTP 관리 endpoint는 제공하지 않는다.

과거 배포 URL을 포함한 모든 serving version 차단을 보장하지 못하면 owner 변경을 진행하지 않는다. 변경 후 이전 토큰 거부를 확인하고 다시 활성화한다. 실제 스테이징에서 이 절차 검증은 남아 있다.

## 전체 기기 회수 명령

Node.js와 `npm ci`로 설치한 개발 의존성(esbuild 포함)이 있는 서버 체크아웃에서 실행한다. 먼저 `npm run desktop:revoke-all`로 계획을 확인한다. 기본 실행은 DB에 접속하지 않으며 `.env*` 파일을 자동으로 읽지 않는다.

모든 serving deployment와 과거 배포 URL에서 기능 차단 및 발급 drain을 완료한 뒤, 비밀 관리 도구에서 **회수할 DB의** `POSTGRES_URL`을 현재 프로세스에 주입하고 `DESKTOP_UPLOADER_ENABLED=false`를 명시한다. URL의 host[:port]/database와 같은 대상 확인 인자를 전달한다. 다음 주소는 가상 예시다.

```sh
npm run desktop:revoke-all -- --apply --database-target db.example.invalid/llvy --all-deployments-disabled --issuance-drained
```

이 확인 인자는 운영자가 완료한 외부 절차의 확인이며 원격 배포 상태를 자동 검증하지 않는다. 명령은 단일 회수 transaction과 감사를 실행하고 계정 검사 수·잔여 요청 회수 수만 출력한다. 이미 계정별로 회수된 요청은 잔여 요청 수에서 제외되며 이 값은 전체 기기 수가 아니다. 브라우저 세션과 완료 게임은 유지한다. DB 오류 원문과 자격 증명은 출력하지 않는다. 실패 또는 커밋 응답 유실이면 차단을 유지하고 DB 감사·이전 토큰 거부를 확인한 뒤 필요 시 다시 실행한다. 전체 회수는 반복 실행할 수 있다.

현재 session은 `protocol`을 제공하며 최소 앱 semver 필드는 제공하지 않는다. 앱 버전 강제가 필요하면 v1 계약의 별도 호환성 변경으로 검토한다. 이 CLI의 로컬 자동 검사와 실제 스테이징 차단·drain·회수 검증은 별개다.

## 업로더 역할 호환과 감사

`desktop-v1` session role에 `uploader`를 추가했다. URL·DTO 필드·scope·기기 수명과 한도는 유지한다. 관리자/오너가 업로더를 부여·회수하며 앱에 권한 관리 API를 제공하지 않는다. uploader grant는 별도 컬럼으로 연결 승인·기기·예약·감사에 고정하며 회수·재부여·승격 후 옛 연결은 재사용할 수 없다.

서버 schema/fixture와 앱 파서를 수정하고 계약 `fe32e8a93a426b0446338d24c201c5b778dab682`를 `uploader-role-contract` ref로 원격에 공개했다. 앱 사본/hash가 일치하며 실제 앱 릴리스·실환경 검증은 남아 있다. [계약 배포 순서](../contracts/desktop-v1/README.md#업로더-역할-확장)와 [역할 적용/rollback](deployment.md#업로더-역할-적용)을 따른다.

오너는 감사 화면에서 제출 계정, 당시 역할/grant, 파일명과 서버 SHA-256, 업로드 ID, 기기·채널, 결과·게임을 확인한다. 실패·만료는 서버가 확보한 정보만 기록한다. 예약 정리와 게임 삭제 후에도 귀속은 유지한다. 앱의 로컬 진단에는 파일명·계정 정보를 추가하지 않는다.
