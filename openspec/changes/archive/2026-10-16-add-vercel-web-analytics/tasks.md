## 1. Analytics 통합

- [x] 1.1 `@vercel/analytics` 의존성과 잠금 파일을 갱신하고 루트 레이아웃에 Next.js Analytics를 한 번 연결한다.
- [x] 1.2 Analytics 경로만 Proxy matcher에서 제외하고 수집 경로·유사 접두사·보호 경로의 회귀 테스트를 추가한다.
- [x] 1.3 배포 문서에 재배포와 브라우저·대시보드 확인 절차를 기록한다.

## 2. 검증 및 완료

- [x] 2.1 Node.js 24에서 `npm run check`, `openspec validate --all --strict`, `git diff --check`를 통과하고 명세와 구현을 대조한다.
- [x] 2.2 검증 기록에 로컬 결과와 미수행 운영 수집 확인을 구분해 남긴다.
