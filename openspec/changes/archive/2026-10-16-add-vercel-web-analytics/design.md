## Context

앱은 Next.js App Router와 공통 서버 루트 레이아웃을 사용한다. 현재 인증 Proxy는 로그인 등 명시적인 예외를 제외한 요청을 검사하므로 기본 Analytics 경로도 검사 대상이다. Vercel 대시보드 활성화는 사용자가 완료했다.

## Goals / Non-Goals

**Goals:** 공통 레이아웃에서 기본 페이지 조회 수집을 연결하고 로그인 페이지에서도 Analytics 요청을 허용한다.

**Non-Goals:** 커스텀 이벤트, 사용자 식별 속성 추가, Speed Insights, 유료 요금제 설정, 운영 배포.

## Decisions

- 공식 `@vercel/analytics/next`의 `Analytics`를 루트 `body`에 한 번 추가한다. Next.js 경로 변경 통합을 활용하고 루트 레이아웃은 서버 컴포넌트로 유지한다. 개별 페이지 삽입이나 별도 전역 클라이언트 래퍼는 필요하지 않다.
- SDK의 기본 환경 감지를 유지한다. 로컬 개발에서 운영 수집 모드를 강제하지 않는다.
- Proxy의 정적 matcher에서 `/_vercel/insights`와 그 하위 경로만 제외한다. `/_vercel` 전체 제외는 피하고 Next.js matcher 테스트로 유사 접두사 및 일반 보호 경로를 검증한다.
- 운영 수집 성공은 재배포 후 브라우저 Network와 Vercel 대시보드로 확인하도록 문서화한다. 로컬 품질 검사 성공을 운영 수집 증거로 기록하지 않는다.

## Risks / Trade-offs

- [브라우저 차단 기능이나 Vercel 설정으로 수집 실패] → 배포 후 스크립트·조회 요청 및 대시보드 확인 절차를 제공한다.
- [인증 예외 범위가 넓어질 위험] → 경로 세그먼트 경계를 고정하고 회귀 테스트로 검사한다.

## Migration Plan

DB 및 환경변수 변경은 필요 없다. 코드 배포 후 로그인 페이지와 로그인 후 화면을 방문해 수집을 확인한다. 롤백은 SDK 렌더링과 의존성, 해당 Proxy 예외를 되돌린다.

## Open Questions

없음. 운영 재배포와 실제 수집 확인은 별도 배포 단계에서 수행한다.
