# 데스크톱 업로더 서버 구현·검증

확인 기간: 2026-10-18~19. 상태: 로컬 코드 구현 및 disposable DB 검사. 운영 DB 마이그레이션·배포·flag 활성화는 하지 않았다.

## 구현 범위

`src/lib/desktop/`, `/api/desktop/v1/`, 브라우저 승인·본인 기기 관리, migration `0009_desktop_uploader.sql`을 추가했다. PKCE·일회용 코드·기기 수명·refresh 회전·재사용 회수, kind/scope 분리, 공유 한도·멱등 예약, 제한된 Blob descriptor, 서버 size/hash 확인과 ingestion transaction finalizer, 결과/credential/tombstone 정리를 구현했다.

기존 웹 URL/DTO를 유지하고 desktop credential을 일반 웹 mutation에 사용할 수 없게 했다. 관리자 회수·탈퇴와 기기 회수를 transaction 안에서 연결했다. feature flag는 기본 false이며 해제와 maintenance는 독립적으로 동작한다.

## 수행한 검사

- Node.js 24.21.0과 26.5.0, 설치된 Next.js 16.3.8 및 @vercel/blob 2.5.0 기준 타입·lint·production build·형식 검사.
- PGlite 기반 새 desktop integration 17개: PKCE/코드 소비, 역할·기기 격리, refresh 회전/재사용, 5개 한도와 교체, 비활성화 중 해제, 영구 회수, 웹 공유 예산/rollback, 8일차 tombstone, HEAD 404와 장애 구분, 신규/duplicate 결과와 pending 정리 후 조회, finalizer/claim 실패, HTTP 크기/쿠키 격리.
- 전체 회귀: `VITEST_MAX_WORKERS=2 npm run check`. 테스트는 870개 통과, 80개 생략이며 실환경 조건이 없는 검사는 별도로 남겼다.
- 실제 localhost PostgreSQL 17: `LLVY_POSTGRES_TEST_URL`을 disposable `llvy_auth_test`로 지정하고 `npm run test:auth-postgres`, 20개 통과. 새 desktop 경쟁 8개와 기존 권한/캐시 경쟁 12개를 포함한다. 동일 code/refresh/멱등 키 경쟁, 마지막 공유 한도, 반대 budget 순서, 감사 실패 rollback, unique 경합 duplicate finalizer 성공·실패, 최종 commit과 기기 회수 경쟁을 확인했다.
- `node scripts/test-desktop-migration.mjs`: 같은 localhost 테스트 설정으로 별도 임시 DB를 만들고 migration 0009의 transaction rollback, 기존 browser session·pending·game 보존과 기본값을 검사한 뒤 임시 DB를 삭제한다.
- OpenSpec strict 30개와 공백 검사. schema·HTTP·서버 검증은 앱/Windows 실행 증거와 분리한다.

## 계약 출처

후보 JSON 계약 원본 commit은 `f6c218f8d9b0476623b73dc75579722c8872d479`다. 이 commit은 계약 파일만 포함하고 서버 기능 구현의 배포 commit이 아니다. 앱 사본은 파일별 SHA-256을 기록하며 일반 빌드에서 형제 소스를 읽지 않는다.

## 미완료 검증

실제 Blob public/private 서명 PUT·헤더/경로/크기/만료/overwrite 거부와 실제 Discord·ROFL staging 흐름은 미수행이다. SDK 소스·타입 기반 descriptor를 실제 provider 검증 완료로 표시하지 않는다. 실제 replay fixture를 사용하는 환경 의존 검사도 별도로 필요하다.

모든 serving deployment 차단·owner 변경/rollback·구 토큰 거부 절차, 스테이징 한도/회수/고아 객체 정리와 Windows 일반 사용자 전체 흐름을 검증해야 한다. 서버 change를 아카이브하거나 운영 활성화하지 않았다. [운영 순서](../desktop-uploader.md)와 [앱 검증](../../../llvy-uploader/docs/validation/2026-10-18-server-integration.md)을 참고한다.

## 2026-10-19 인증 목록과 만료 요청 회귀 검사

활성 기기를 우선 반환하고 최신 비활성 이력과 합쳐 최대 100개를 표시한다. 회수된 연결 105개가 있어도 오래된 활성 연결과 새 임시 연결을 모두 조회·해제·교체할 수 있는 PGlite 회귀를 추가했다.

공개 연결 요청 생성 시 예산 검사 후 만료 요청 최대 10개를 정리한다. 521개 만료 기록에서 새 요청 3개가 30개를 회수하고 유효한 승인 요청을 보존하는 회귀를 추가했다. 일일 maintenance는 같은 함수로 최대 500개를 정리한다. 실제 localhost PostgreSQL 다중 연결에서 한 행을 잠근 채 두 정리 작업이 서로 다른 10개씩 삭제하고, 잠금 해제 후 새 요청이 남은 만료 행을 회수하는 것을 확인했다.

Node.js 24.21.0 전체 검사 기준 테스트 872개 통과·81개 생략, desktop PGlite 19개 통과, 실제 disposable PostgreSQL 17 경쟁 테스트 21개 통과다. PostgreSQL 컨테이너는 검사 후 제거했다. 기기·결과·refresh 보존 기간, API DTO·고정 계약·schema는 변경하지 않았으며 운영 DB·외부 서비스는 검증하지 않았다.
