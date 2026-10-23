# 업로더 역할 구현과 검증

상태: 로컬 구현. 운영 DB 적용·배포·실제 브라우저/Windows·Discord/Blob 검증은 미완료다.

## 구현 범위

- viewer/uploader/admin/owner를 명시적으로 구분하고 uploader에는 일반 조회와 웹·desktop 업로드만 허용한다. 관리자는 업로더를 부여·회수하고 관리자 지정·감사 조회·가입 점검 운영 정보는 오너만 사용한다.
- `0010_uploader_role.sql`은 별도 uploader grant, nullable actor/grant snapshot과 desktop role CHECK를 추가한다. 기존 역할·쿠키 버전·admin grant 의미는 유지한다.
- 회수·재부여·승격·탈퇴는 세션·기기·미완료 승인을 폐기한다. 새 grant가 이전 예약·기기를 되살리지 않으며 관리자 회수는 viewer로 돌아간다.
- 모든 로그인 역할은 기존 모임원 목록/상세의 생년을 조회한다. query identity 버전을 변경하고 역할별 캐시 분리·TTL·revision과 최소 검색/명단 DTO를 유지한다.
- 파일 감사는 제출 계정·당시 역할/grant·업로드 ID·basename·서버 SHA-256·채널/기기·결과·게임 ID를 남긴다. 예약은 처리 성공과 구분한다. 중복도 제출자별로 기록하고 불확실한 commit을 실패로 덮어쓰지 않는다. 회수·이름 변경·예약/게임 삭제 후 감사 귀속을 보존한다.
- 앱 session 파서는 uploader/admin/owner를 허용하며 viewer/unknown을 거부한다. 위키 권한·구조·결정 요약을 갱신했다.

## 로컬 검증

Node.js 24.21.0, 폐기 가능한 로컬 PostgreSQL 17과 Valkey 9를 사용한다. Discord·Blob은 모의 처리하고 실제 회원/리플레이 데이터를 사용하지 않는다.

- `LLVY_POSTGRES_TEST_URL=... npm run test:auth-postgres`: 26개 통과. uploader 동시 부여, admin/uploader 경쟁, 부여자 회수 중 provider 응답, 회수·승격·탈퇴와 최종 저장 경합을 포함한다.
- `LLVY_POSTGRES_TEST_URL=... node scripts/test-uploader-role-migration.mjs`: transaction 실패 rollback, 기존 행 보존, 활성 grant unique, raw SQL 재실행 거부를 확인했다. 정상 운영 적용은 Drizzle journal을 사용하는 `npm run db:migrate`다.
- PostgreSQL·Valkey를 연결한 `VITEST_MAX_WORKERS=2 npm run check`: 1,010개 통과, 5개 선택 검사 생략. lint·타입·프로덕션 빌드 통과. 마지막 포맷 단계의 문서 서식 한 건을 수정했고 `npm run format` 재실행이 통과했다.
- `openspec validate --all --strict`: LLVY 28개, 앱 1개 통과. `git diff --check`와 신규 파일 형식 검사를 통과했다.
- 앱 저장소: `go test ./...`, `go vet ./...`, `go test -race ./...`, Windows amd64 교차 빌드 통과. 교차 빌드 산출물은 실제 Windows 실행 증거가 아니다.
- React 점검: Server Action과 서비스의 현재 권한 재검증, owner 조건 안의 운영 조회, 독립 조회의 병렬 실행, 최소 Client props, pending 버튼 비활성화와 상태 안내를 확인했다. 실제 화면 조작·접근성 검증은 별도다.

PostgreSQL/Redis 테스트 URL은 localhost 전용 폐기 DB/캐시를 사용한다. 검증 스크립트를 운영 DB에 연결하지 않는다. 기존 실제 리플레이·외부 환경 검사 조건은 유지한다.

## 구현 리뷰 회귀 범위

- 업로더 부여의 보호 대상 검사를 외부 조회 전에 수행한다. 긍정·부정 응답 모두 계정 잠금 아래 부여자와 대상 역할을 재검증해 관리자 승격·부여자 회수 경합에서 기존 권한을 변경하지 않는다.
- 웹·desktop 실패 관찰을 nullable `pending_uploads.audit_metadata`에 먼저 보존한다. 감사 삽입 장애가 복구되면 정리 작업이 원래 원인·계산된 서버 해시를 사용한다. 처리 중 회수·가입 정지에도 원래 예약/claim의 실패만 기록하며 성공 저장 권한은 복구하지 않는다.
- 웹의 선택적 처리 파일명 생략에는 예약 basename을 사용하고, 저장 불가능한 Unicode가 실패 감사까지 막지 않도록 정규화한다. 기존 terminal 성공·중복은 실패로 덮어쓰지 않는다.
- 앱 사용 절차의 연결 허용 역할을 업로더·관리자·서비스 오너로 맞췄다.

권한 경합 PostgreSQL 30개와 변경된 migration의 기존 행 보존·rollback 검사가 통과했다. 수정 후 독립 교차 리뷰는 추가 지적 0건이며 관련 6개 파일의 집중 검사 115개가 통과했다. 최종 `VITEST_MAX_WORKERS=2 npm run check`는 PostgreSQL·Valkey 연결 상태에서 테스트 1,022개 통과·선택 검사 5개 생략, lint·타입·프로덕션 빌드·포맷까지 종료 코드 0으로 완료됐다. `openspec validate --all --strict` 28개와 `git diff --check`도 통과했다. 브라우저·Windows·외부 서비스·운영 검증의 미완료 상태는 그대로다.

## 남은 완료 조건

1. 계약 원본 `fe32e8a93a426b0446338d24c201c5b778dab682`를 LLVY의 별도 로컬 `uploader-role-contract` ref에 고정하고 앱의 `contracts/desktop-v1/source.json`, 사본·파일별 SHA-256을 맞췄다. 이 commit은 schema/fixture 두 파일만 변경하며 현재 main과 기존 인덱스는 유지했다. 원격 계약 공개와 호환 서버/앱 배포는 아직 남아 있다.
2. 실제 브라우저에서 네 역할의 메뉴·직접 URL·부여/회수·생년·재로그인을 확인한다.
3. 스테이징 Discord·Blob에서 실제 가입 확인, 웹/Windows 업로드, 회수/승격 중 처리 차단과 이미 발급된 PUT의 잔여 수명·정리를 확인한다.
4. 실제 Windows 호환 앱에서 로그인·파일 업로드·상태·refresh·회수 후 재연결을 확인한다.
5. 운영 migration·서버·계약·앱 revision과 구서버 drain, 기존 계정 보존, rollback 절차를 확인한다. 이번 작업은 운영 변경을 수행하지 않았다.

[작업 목록](../../openspec/changes/add-uploader-role/tasks.md)에서 완료한 로컬 항목만 체크한다. 필수 외부 조건이 남아 `add-uploader-role`은 열린 상태이며 정식 명세 동기화·아카이브는 하지 않는다. desktop/member-history/cache 활성 델타를 합성했고 다른 변경의 검증 체크 상태는 유지한다.
