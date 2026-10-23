# Vercel Web Analytics 통합 검증

## 변경

- `@vercel/analytics` 2.0.1을 설치하고 Next.js용 `Analytics`를 공통 루트 레이아웃에 한 번 추가했다.
- SDK 기본 환경 감지를 유지하고 별도 커스텀 이벤트나 사용자 식별 속성을 추가하지 않았다.
- 인증 Proxy에서 `/_vercel/insights`와 하위 경로만 제외했다. 일반 페이지·API와 유사 접두사는 계속 보호한다.
- 배포 문서에 활성화, 코드 배포, 브라우저 요청 및 대시보드 확인 절차를 기록했다.

## 로컬 검증

- Node.js 24.21.0에서 `VITEST_MAX_WORKERS=2 npm run check` 통과: 54개 테스트 파일, 853개 테스트 통과, 4개 파일·72개 테스트 건너뜀. lint, typecheck, production build, format 모두 통과했다.
- 최초 기본 동시성 검사에서는 기존 Discord 로그인 시도 저장량 테스트가 5초 제한을 초과했다. 해당 파일 단독 재실행은 54개 모두 통과했고 worker 2개로 전체 검사를 다시 통과했다. 제품 코드나 테스트 제한 시간은 변경하지 않았다.
- 새 Proxy 경로 테스트 16개가 Analytics 요청 허용과 유사 접두사·기존 보호 경로 유지를 확인했다. 현재 설치된 Next.js가 실제로 내보내는 `unstable_doesMiddlewareMatch`를 사용했다.
- `openspec validate --all --strict`: 아카이브 전후 각각 28개 항목 통과. `web-analytics` 정식 명세에 요구사항 3개를 동기화하고 활성 목록에서 변경이 제거된 것을 확인했다.
- `git diff --check` 통과. 의존성 잠금 변경은 Analytics 패키지 추가에 한정된다.
- 소스 대조 결과 루트 레이아웃은 서버 컴포넌트이며 Analytics 삽입은 한 곳이다. 앱에서 기본 모드·수집 경로를 덮어쓰지 않는다.

아카이브: `openspec/changes/archive/2026-10-16-add-vercel-web-analytics/`.

## 운영 확인 범위

Vercel 대시보드 활성화 여부는 이번 검증에서 직접 확인하지 않았다. 이 문서의 로컬 검증 범위에는 운영 배포와 실제 브라우저 수집 요청, 대시보드 집계 확인이 포함되지 않는다. 로컬 검사 및 Next.js 빌드는 운영 수집 성공의 증거가 아니다.

코드 배포 후 [Web Analytics 확인 절차](../deployment.md#web-analytics)에 따라 로그인 전후 페이지 방문, 스크립트와 조회 요청 성공, 대시보드 반영을 확인한다.
