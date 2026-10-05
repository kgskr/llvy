## 1. 기준 테스트와 설정

- [x] 1.1 Codex Security finding별 회귀 테스트 초안을 추가한다: rotated `x-forwarded-for`, same-store Blob URL cleanup, oversized `statsJson`
- [x] 1.2 로그인 throttle 한도와 replay ingestion budget 상수를 정의하고 테스트에서 주입 가능하게 만든다
- [x] 1.3 현재 정상 업로드/파싱/중복 처리 테스트가 hardening 변경 전후에도 기대 동작을 설명하도록 정리한다

## 2. 로그인 rate-limit hardening

- [x] 2.1 Vercel 정규화 IP만 신뢰하고 Postgres IP별 로그인 예산을 적용한다. 신뢰 가능한 운영 IP가 없으면 전역 폴백 없이 거부한다
- [x] 2.2 over-limit 요청이 password verification까지 도달하지 않는지 검증한다
- [x] 2.3 raw XFF 무시·정규화 IP 선택·IP별 격리·동시 요청 제한·신뢰 IP 누락 거부 회귀 테스트를 통과시킨다

## 3. Blob pending upload ownership

- [x] 3.1 Postgres `pending_uploads` 테이블로 id·nonce hash·예약 경로·상태·만료 시각을 저장한다 (design.md 구현 결정 참고)
- [x] 3.2 `/api/blob/upload` 토큰 발급 시 upload id/nonce와 expected Blob pathname 또는 URL constraint를 생성해 클라이언트에 전달한다 → 발급은 신설 `/api/uploads`가 담당, `/api/blob/upload`는 바인딩된 pathname에만 토큰 발급
- [x] 3.3 업로드 UI가 `/api/process` 호출 시 Blob URL과 pending upload binding을 함께 전달하도록 수정한다
- [x] 3.4 `/api/process`가 active pending upload와 일치하지 않는 Blob URL을 fetch/delete 전에 거부하도록 변경한다
- [x] 3.5 duplicate/error cleanup이 current pending upload의 exact Blob URL만 삭제하도록 변경한다
- [x] 3.6 consumed/expired pending upload binding 재사용을 거부하는 테스트를 추가한다

## 4. Replay parser and ingestion resource limits

- [x] 4.1 `parseStats()`에서 participant count, `statsJson` byte length, raw object size, nesting depth budget을 검증한다
- [x] 4.2 기본 participant limit을 MVP 지원 범위인 10명으로 두고, 초과 replay는 unsupported parse error로 실패시킨다
- [x] 4.3 `ingestReplay()`가 transaction 시작 전 participant count와 DB work budget을 재검증하도록 한다
- [x] 4.4 `raw_stats` 저장을 bounded allowlist로 줄이거나, configured raw JSON budget 초과 시 저장 전 실패하도록 한다 → 둘 다 적용: 스칼라 allowlist로 축소 + 저장 전 예산 검증
- [x] 4.5 20,000 participant PoC 형태의 over-budget replay가 DB write 없이 실패하는 테스트를 추가한다

## 5. 통합 검증과 운영 확인

- [x] 5.1 `npm test`와 lint/build 검증을 실행하고 실패 시 hardening 변경 범위 안에서 수정한다 (초기 구현 당시 56 tests / lint / build / format 통과; 현재 전체 검증 수는 아래 후속 기록 참고)
- [x] 5.2 staging 또는 disposable Vercel 리소스에서 Blob delete/readback과 Postgres rollback/timeout behavior를 검증하는 절차를 문서화한다 → README "스테이징 검증 절차" 섹션
- [x] 5.3 OpenSpec task 체크 상태와 README 또는 운영 문서의 보안 제한/설정 값을 최종 반영한다

## 6. 공유 예산 및 만료 업로드 정리 (현재 로컬 구현)

- [x] 6.1 `request_budgets` 테이블과 원자적 고정 기간 카운터를 구현한다
- [x] 6.2 로그인은 IP당 60초에 10회, 업로드 예약은 세션당 24시간에 10회·전체 50회로 제한한다
- [x] 6.3 새 로그인 세션에 임의 nonce를 넣고 비밀번호 또는 서명 키 교체로 세션을 무효화한다
- [x] 6.4 `cleanup_claimed_at` 마이그레이션과 `cleaning` 상태를 사용해 만료 정리 작업을 점유하고 오래된 점유를 재시도한다
- [x] 6.5 만료 후 24시간이 지난 예약을 최대 50개씩 정리하며 저장된 경기 원본은 보존한다
- [x] 6.6 `/api/maintenance/uploads`의 CRON_SECRET 인증과 `vercel.json`의 일일 03:00 UTC 스케줄을 구현한다
- [x] 6.7 공유 예산·정리 실패/재시도·원본 보존을 PGlite 및 모의 Blob으로 검증한다
- [x] 6.8 현재 코드 기준으로 제안·설계·스펙·작업 문서를 동기화한다
- [ ] 6.9 후속 마이그레이션 `0003`·CRON_SECRET·Cron 스케줄의 운영 반영과 실제 정리 실행을 검증한다
- [ ] 6.10 운영 ingress의 정규화 IP 및 실제 Postgres 다중 연결에서 공유 예산 동작을 검증한다

2026-10-05 로컬 `npm run check`: 361개 테스트 통과, 실제 리플레이 4개 건너뜀,
lint·typecheck·build·format 통과. 문서 대조 시 로그인·계정 저장·업로드 예약·만료 정리 관련
4개 파일의 테스트 45개를 독립 실행해 통과했다. 2026-10-04 운영 검증 기록은 이전
마이그레이션 3개와 업로드/경기 관리 흐름에 대한 과거 증거이며 이 후속 변경의 운영 증거가 아니다.
