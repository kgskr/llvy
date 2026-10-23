## 1. 구현 기준과 병행 변경 정합성

- [x] 1.1 현재 코드·활성 desktop 변경·네 역할 권한표를 대조하고 `role !== viewer` 및 owner 전용 경로/쿼리 전체를 upload/management/owner/read capability로 분류한다. Next.js 관련 수정 전 설치된 가이드를 읽는다.
- [x] 1.2 `add-desktop-replay-upload-api`의 승인·refresh·세션·예약·감사·최종 저장 명세와 본 delta를 합성한다. 구현/아카이브 순서를 기록하고 기존 웹/desktop 계약과 병행 작업 체크 상태를 보존한다.
- [x] 1.3 Windows 앱의 `internal/desktop/client.go` 역할 검증과 지원 릴리스/고정 계약 revision을 확인하고 uploader enum 추가의 호환 배포 순서를 확정한다.
- [x] 1.4 활성 member-history/cache 변경의 viewer 생년 제한을 본 계획과 대조하고 구현/아카이브 시 모든 로그인 역할의 생년 조회 정책이 되돌아가지 않도록 delta를 합성한다.

## 2. 저장소와 역할 모델

- [x] 2.1 `uploader_grants`와 계정당 활성 grant unique index/FK를 추가한다. 기존 계정 역할·admin grant·세션·감사 데이터를 바꾸지 않는 additive migration을 현재 마지막 번호 다음으로 만든다.
- [x] 2.2 Actor·감사·예약·desktop 승인 요청/세션에 uploader grant 전용 바인딩을 추가하고 desktop role CHECK를 확장한다. adminGrantId 기존 의미와 과거 nullable 행을 보존한다.
- [x] 2.3 네 역할 도출과 명시적 upload/management/owner guard를 구현한다. 업로드 transaction guard와 관리 transaction guard를 분리하고 잘못된 grant 종류·알 수 없는 역할을 거부한다.
- [x] 2.4 migration 적용·재실행 정책·기존 행 호환성과 활성 admin/uploader 중첩 방지를 실제 PostgreSQL로 검증한다. rollback 시 보존할 신규 컬럼·역할/감사 이력을 기록한다.

## 3. 업로더 부여·회수·승격

- [x] 3.1 owner/admin 전용 업로더 부여 service/action을 구현한다. active viewer 대상, 최신 bot 가입 확인, membership version 보호, duplicate conflict와 원자적 감사를 검증한다.
- [x] 3.2 owner/admin 전용 업로더 회수 service/action을 구현한다. 외부 조회 없이 모든 기존 browser/desktop 세션·기기 credential·미완료 승인을 폐기하고 재부여 시 새 ID를 사용한다.
- [x] 3.3 owner 전용 관리자 승격에 uploader→admin 원자 전환을 추가한다. 이전 uploader grant/세션/기기 폐기, 관리자 회수 후 viewer, admin/owner 대상 업로더 변경 금지를 검증한다.
- [x] 3.4 로그인 중 탈퇴 판정·권한 부여 중 탈퇴 판정·일일 reconciliation에서 uploader grant도 폐기한다. 재가입 시 viewer 복귀와 provider 장애 시 기존 권한 보존을 검증한다.
- [x] 3.5 권한 감사 allowlist·DB projection·정리 actor snapshot을 갱신한다. uploader grant/revoke·업로드·승격·탈퇴의 grant ID 보존과 감사 실패 rollback을 readback 테스트로 검증한다.
- [x] 3.6 웹·desktop 업로드 감사에 계정/역할/grant snapshot, 업로드 ID, 채널/기기, 검증된 파일명·서버 SHA-256, 결과·gameId를 연결한다. 예약과 성공을 구분하고 성공/중복 원자성·재시도 중복 감사 방지·실패/만료 복구를 DB readback으로 검증한다.

## 4. 웹 권한과 개인정보

- [x] 4.1 layout·관리 landing·모임원/게임 화면·OAuth callback 경로 분류를 명시적 capability로 변경한다. uploader는 업로드만 추가로 표시하고 관리 UI는 숨긴다.
- [x] 4.2 `/admin/users`와 계정 조회를 admin/owner에 제공하고 `업로더 권한 부여`/`업로더 권한 회수`를 구현한다. 관리자 controls·감사·가입 점검 운영 정보는 owner 전용으로 유지한다.
- [x] 4.3 viewer/uploader 모두 member projection에 생년 조회를 허용하고 role별 cache key 타입과 영향받는 projection 버전을 갱신한다. 기존 TTL/revision을 유지하며 네 역할의 생년 제공 화면·API·HTML·RSC props와 목록의 `이름(생년)`/생년 없음 표시를 확인한다. 자동완성/검색 suggestion의 기존 최소 필드 계약은 유지한다.
- [x] 4.4 `/upload`, `/api/uploads`, `/api/blob/upload`, `/api/process`, 최종 ingest를 upload guard로 연결한다. 기존 요청/응답·Blob 소유권·검증·중복/공유 예산을 보존하고 수동 관리 action은 uploader를 거부한다.
- [x] 4.5 공통 role 표시, 직접 접근 실패, 부여/회수 성공·중복·provider 실패·재로그인 안내를 정리한다. 네 역할별 page/query/action/route 접근 행렬을 테스트한다.
- [x] 4.6 오너 감사 화면에 업로드한 계정·파일·채널·결과·gameId와 게임 링크를 표시한다. 이름 변경·권한 회수·예약 정리·게임 삭제 후에도 귀속 정보가 유지되며 다른 역할은 조회하지 못하는지 검증한다.

## 5. Desktop와 교차 채널

- [x] 5.1 연결 승인·코드 교환·refresh·session/기기 조회·업로드 전 단계에 uploader의 현재 role/grant 검증을 적용한다. 기기 scope와 원래 grant 바인딩을 유지한다.
- [x] 5.2 uploader 회수/재부여·관리자 승격 후 기존 desktop credential/미완료 승인/예약 재사용이 실패하는지 검증한다. 다른 기기·계정·채널의 예약 사용도 계속 거부한다.
- [x] 5.3 `contracts/desktop-v1/schema.json`과 fixtures/계약 안내를 갱신한다. uploader role을 admin으로 위장하지 않고 기존 URL/DTO 필드/scope·admin/owner 호환을 검증한다.
- [x] 5.4 `llvy-uploader`의 고정 계약 사본·revision/hash 기록·`internal/desktop/client.go` 파서·관련 UI/테스트/안내를 별도 변경한다. 네 역할 응답 처리와 기존 admin/owner 흐름을 검증하고 연계 revision을 기록한다. 미완료면 서버 계획에서도 완료 처리하지 않는다.

## 6. 동시성과 로컬 회귀 검증

- [x] 6.1 실제 PostgreSQL에서 업로더 동시 부여, admin/uploader 경쟁 부여, 부여자 admin 회수 경쟁, 회수/승격/탈퇴와 최종 ingest 경쟁을 검증한다. 공통 잠금 순서와 회수 완료 후 이전 권한의 커밋 금지를 증명한다.
- [x] 6.2 승인→교환 사이 회수, refresh 경쟁, 오래된 grant/예약, 늦은 Blob 콜백/PUT과 정리, 반복 회수, 감사 실패 rollback을 테스트한다.
- [x] 6.3 viewer/uploader의 관리·권한·감사 접근 거부, admin의 관리자 부여 거부, warm cache 이후 네 역할의 생년 조회 허용과 viewer/uploader의 다른 관리자 전용 데이터 미노출, owner 기존 기능·구형 admin/owner 예약 회귀를 검증한다.
- [x] 6.4 관련 테스트와 `npm run check`, `openspec validate --all --strict`, `git diff --check`를 실행하고 새 파일 형식도 검사한다. 로컬/모의 결과와 실제 외부 결과를 구분한다.

## 7. 문서와 실제 환경 수용 검증

- [x] 7.1 README와 `docs/discord-auth.md`, `architecture.md`, `development.md`, `deployment.md`, `desktop-uploader.md`, desktop-v1 안내에 최종 권한·전환·호환 배포·rollback 절차를 반영하고 색인/링크를 검사한다.
- [x] 7.2 `llvy-wiki/wiki/uploader.md`, `wiki/architecture.md`, `wiki/decisions.md`와 관련 색인/log에 네 역할과 관리자 위임 범위를 반영한다. 접근/변경이 불가하면 대상과 남은 수정을 기록하고 동기화 완료로 표시하지 않는다.
- [ ] 7.3 실제 브라우저에서 네 역할의 메뉴·직접 URL·권한 부여/회수·오너 전용 controls·개인정보·재로그인 흐름을 검증한다.
- [ ] 7.4 스테이징 Discord와 Blob에서 uploader 웹 업로드·가입 확인/회수·회수/승격 중 처리 차단을 확인하고 이미 발급된 PUT 권한의 한계를 기록한다.
- [ ] 7.5 실제 Windows 호환 앱에서 uploader 연결·파일 업로드·상태·refresh·회수/재부여 뒤 재연결을 검증한다. desktop 활성 변경의 기존 미완료 수용 항목도 별도로 유지한다.
- [ ] 7.6 운영 활성화 시 적용 migration/서버/계약/앱 revision, 구버전 서버 drain, 기존 계정 불변과 승인된 테스트 계정의 네 역할 동작을 확인한다. 업로더 회수→작업 drain→구코드 rollback 절차의 실행 가능성을 확인하고 검증 범위를 남긴다.

## 8. 명세 동기화와 아카이브

- [ ] 8.1 모든 필수 작업/검증과 외부 계약 준비를 확인하고 병행 desktop delta를 다시 대조한다. 미완료나 차단이 있으면 change를 유지한다.
- [ ] 8.2 최종 구현과 정식 명세의 차이를 검토하고 `openspec archive add-uploader-role --yes`로 동기화·아카이브한다. 나중에 desktop delta가 네 역할 정책을 덮어쓰지 않도록 합성 상태를 확인한다.
- [ ] 8.3 `openspec validate --all --strict`를 재실행하고 활성 목록 제외·정식 명세와 구현 일치·아카이브 위치를 기록한다.

## 9. 구현 리뷰와 회귀 검증

- [x] 9.1 관리자 대상 업로더 부여의 비회원 응답·대기 중 승격·부여자 회수에서도 보호 대상과 현재 권한을 변경 직전에 재검증하고 회귀 테스트를 추가한다.
- [x] 9.2 desktop 처리 중 권한 회수와 일시 감사 저장 장애에서도 관찰한 실패 원인·서버 해시·예약 귀속을 보존하고 복구·중복 방지를 검증한다.
- [x] 9.3 웹 처리의 선택적 파일명 생략 시 예약 파일명을 결과 감사에 보존하고 앱 연결 안내의 허용 역할을 맞춘다.
- [x] 9.4 수정 후 독립 리뷰를 반복하고 지적 0건인 최종 코드에서 관련 회귀 검사·전체 check·OpenSpec strict 검증을 수행한다.

## 구현 기록

2026-10-23 운영 DB backup과 별도 검증 브랜치의 강제 rollback·정상 적용을 확인하고 `0008`~`0010`을 운영에 적용했다. 기존 계정·권한·세션·감사 데이터 보존을 검증했다. 7.6의 schema-first 부분 증거이며, 역할 전환·drain·rollback 전체 완료를 뜻하지 않는다. [운영 검증 기록](../../../docs/validation/2026-10-23-uploader-deployment.md)을 함께 따른다.

로컬 구현·검증 범위와 미완료 이유는 [검증 기록](../../../docs/validation/2026-10-19-uploader-role.md)을 따른다. 5.4는 앱 파서·테스트·안내와 로컬 계약 `fe32e8a93a426b0446338d24c201c5b778dab682` 및 사본/hash를 갱신했다. 원격 계약 공개는 배포 전 필요하다. 7.3~7.6은 실제 환경 확인이 필요하며 완료 처리하지 않는다.
