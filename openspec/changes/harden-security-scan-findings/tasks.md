## 1. 기준 테스트와 설정

- [x] 1.1 Codex Security finding별 회귀 테스트 초안을 추가한다: rotated `x-forwarded-for`, same-store Blob URL cleanup, oversized `statsJson`
- [x] 1.2 로그인 throttle 한도와 replay ingestion budget 상수를 정의하고 테스트에서 주입 가능하게 만든다
- [x] 1.3 현재 정상 업로드/파싱/중복 처리 테스트가 hardening 변경 전후에도 기대 동작을 설명하도록 정리한다

## 2. 로그인 rate-limit hardening

- [x] 2.1 `clientKey()`가 raw `x-forwarded-for`를 단독 신뢰하지 않도록 변경하고 stable global pre-auth bucket을 항상 적용한다
- [x] 2.2 over-limit 요청이 password verification까지 도달하지 않는지 검증한다
- [x] 2.3 header rotation으로 독립 bucket이 생기지 않는 회귀 테스트를 통과시킨다

## 3. Blob pending upload ownership

- [x] 3.1 pending upload binding 방식(Postgres table 또는 signed short-lived token)을 확정하고 최소 데이터 구조를 구현한다 → Postgres `pending_uploads` 테이블 (design.md Open Questions 참고)
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

- [x] 5.1 `npm test`와 lint/build 검증을 실행하고 실패 시 hardening 변경 범위 안에서 수정한다 (56 tests / lint / build / format 모두 통과)
- [x] 5.2 staging 또는 disposable Vercel 리소스에서 Blob delete/readback과 Postgres rollback/timeout behavior를 검증하는 절차를 문서화한다 → README "스테이징 검증 절차" 섹션
- [x] 5.3 OpenSpec task 체크 상태와 README 또는 운영 문서의 보안 제한/설정 값을 최종 반영한다
