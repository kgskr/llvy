## Why

Vercel에서 Web Analytics를 활성화했지만 앱에 수집 SDK가 없어 페이지 방문 통계가 연결되지 않았다. 기본 페이지 조회 통계를 수집할 수 있도록 Next.js 통합을 추가한다.

## What Changes

- `@vercel/analytics`를 설치하고 공통 루트 레이아웃에 Next.js용 `Analytics`를 한 번 배치한다.
- Vercel의 `/_vercel/insights` 경로만 인증 Proxy 대상에서 제외하고 유사한 접두사의 경로는 계속 보호한다.
- 배포 후 통계 수집 확인 절차를 배포 문서에 추가한다.

## Capabilities

### New Capabilities

- `web-analytics`: 앱 전역 페이지 조회 수집 SDK와 수집 경로, 운영 확인 절차.

### Modified Capabilities

없음. 기존 앱 페이지와 API의 로그인·권한 계약은 유지한다.

## Impact

- `package.json`, `package-lock.json`, `src/app/layout.tsx`, `src/proxy.ts` 및 인증 경로 테스트.
- `docs/deployment.md`와 신규 Web Analytics 명세.
- Vercel Web Analytics 기본 페이지 조회만 연결한다. 요금제 변경, 커스텀 이벤트, Speed Insights, 실제 배포는 이 변경의 범위에 포함하지 않는다.
