## 1. P0 — 기준선과 즉시 개선

- [x] 1.1 재확인한 `game-list-v2`·`game-detail-v2`·`member-history-v2` DTO를 기준으로 구현 시작 시 추가 변경 여부와 모든 업무 writer·실행 중 배포를 조사한다. 목록의 `members`·`accounts` 의존성을 유지한다.
- [x] 1.2 인증, revision, Redis, 업무 로더, 인덱스 구축·게시 및 별도 에셋 카탈로그 구간의 비민감 계측과 cache outcome을 추가한다.
- [x] 1.3 드문 방문·연속 검색·쓰기 직후·동시 miss·장애의 고정 workload와 기준선을 기록한다. 경기 목록은 현재 10경기·count 1회+페이지 1회+참가자 1회를 기준으로 삼고, Redis와 카탈로그의 cold/warm 조합을 구분한다. 운영 결과와 로컬 결과를 구분한다.
- [x] 1.4 기존 60초 TTL을 유지하면서 일반 조회의 bounded single-flight, 객체 격리, 실패 후 재시도 회귀를 추가한다.
- [x] 1.5 업로드 예약만으로 전체 캐시가 무효화되는 경로를 제거하고 예약/저장/중복 업로드를 구분해 검증한다.

## 2. P1 — 트랜잭션 변경 버전

- [x] 2.1 `cache_revisions`와 활성 상태/epoch의 additive migration 및 Drizzle 메타데이터를 작성한다. 기본 활성 상태는 false로 둔다.
- [x] 2.2 scope 배치 조회와 정밀도를 보존하는 revision 표현, 요청 내 읽기 공유, metadata 실패 시 우회를 구현한다.
- [x] 2.3 mutation별 변경 scope 수집·중복 제거·정렬 갱신을 구현하고 실제 no-op을 구분한다. 기존 권한·business 잠금 순서를 유지한다.
- [x] 2.4 회원 생성·수정·삭제와 계정 연결·해제·이동에 revision 갱신을 연결한다.
- [x] 2.5 경기 댓글·날짜·제외·복원과 새 리플레이 저장에 revision을 연결한다. 계정 이름이 실제 갱신된 경우와 보존된 경우를 구분한다.
- [x] 2.6 커밋 중 Redis 쓰기 차단, rollback, 늦은 fill, epoch 교체, revision 누락의 회귀를 추가한다.
- [x] 2.7 실제 PostgreSQL 다중 연결로 계정 연결/삭제, 경기 변경/ingest와 revision 업데이트의 교차 잠금 순서를 검증한다.

## 3. P1 — 버전 기반 읽기와 TTL 전환

- [x] 3.1 역할·환경·epoch·dependency vector·정규 인자를 포함하는 새 캐시 namespace를 도입한다. 공존 기간에는 기존 무효화도 유지한다.
- [x] 3.2 읽기 모델과 두 자동완성 소스에 필요한 scope를 연결한다. 모임원 이름/삭제와 계정 이동·연결/해제·이름 변경이 active/excluded 목록 및 상대 참가자 표시에 전파되는지 검증한다.
- [x] 3.3 명명된 TTL 정책을 추가한다. 연결 계정 정보를 포함한 모임원 목록은 jitter 없이 86,400초로 고정하고, 다른 정책의 jitter·null TTL·절대 만료를 구분한다. 동일 인덱스 키들의 만료 시각은 일치시킨다.
- [x] 3.4 100ms 개별 제한·5초 cooldown을 유지하고 캐시 읽기/조정 총 150ms 예산 및 Redis 미사용 시 revision 조회 생략을 검증한다.
- [x] 3.5 2분·10분 재방문, 댓글 변경 후 검색 재사용, 삭제/연결 변경 직후 조회와 권한 폐기를 실제 Redis에서 검증한다.
- [x] 3.6 제어 가능한 시계로 모임원 목록의 24시간 직전/경계 만료와 읽기 시 수명 비연장을 검증하고, 실제 Redis의 86,400초 초기 TTL 및 하루 이내 회원·계정 변경 반영을 별도 검증한다. 기존 58초 이상 단정은 정책별로 갱신한다.

## 4. P2 — 집계 재사용과 인덱스 게시

- [x] 4.1 전적 신원·계정, 전체 통계, 페이지 경기/참가자 로더를 분리한다. `member-history-v2`의 버전·본인 레벨/7개 아이템·양 팀 참가자·멤버 강조, 모호한 값 처리 및 전체 연결 계정 집계 의미를 보존한다.
- [x] 4.2 다음 페이지 진입에서 전체 집계가 다시 실행되지 않는 회귀를 추가한다. 현재 신원 확인과 revision SELECT 통합 가능성을 측정한다.
- [x] 4.3 두 자동완성 source revision을 배치 조회하고 독립적인 Redis 읽기를 pipeline으로 묶어 명령/왕복 수와 무결성을 검증한다.
- [x] 4.4 자동완성에 owner token lease, 원자적 소유권 확인 게시/해제, 50ms 제한 대기와 coalesced fallback을 추가한다.
- [x] 4.5 여러 프로세스에서 정상 단일 게시, lease 만료 후 늦은 게시 거절, 프로세스 종료·partial eviction 복구를 검증한다.
- [x] 4.6 설치된 Next.js 가이드에 따라 `after()` lifecycle을 주입해 DB 응답 뒤 게시를 수행한다. 일반 실행의 awaited 경로와 callback 누락 복구를 검증한다.
- [x] 4.7 기존 이름·초상화 공동 로딩, 성공 카탈로그의 24시간 TTL, 패치별 최대 8개·2초 fallback과 버전별 묶음 요청 회귀를 유지한다. 카탈로그 URL을 업무 Redis DTO에 넣지 않고 목록 링크의 prefetch 비활성도 보존한다.

## 5. P2 — 메모리와 키 수 관리

- [x] 5.1 경기 목록은 visibility별 count와 실제 page로 키를 정규화한다. 화면의 경기 10개·전적 25개와 DB 로더 범위를 유지하고, 페이지 참가자 1회/빈 페이지 0회 조회를 재사용한다.
- [x] 5.2 첫 20페이지 admission, 256KiB payload 제한, bounded pending map과 임시 키 TTL을 검증한다.
- [ ] 5.3 검색어별 캐시의 실제 사용·적중률을 측정해 유지 여부를 정하고 인덱스 크기·build p95로 게시 상한과 lease 기간을 확정한다.
- [ ] 5.4 과거 revision 키의 자연 만료와 최대 메모리/명령 수를 측정한다. 전역 키 스캔이나 flush 없이 정리되는지 확인한다.

## 6. 검증과 단계 배포

- [x] 6.1 실제 Redis·PostgreSQL에서 검색 Unicode/정렬/legacy DTO, 기존 세 v2 투영과 이전 shape 격리, 역할별 투영, revoked session, 중복 로더와 실패 복구를 회귀 검증한다.
- [ ] 6.2 동일 workload로 업무 로더 80% 감소 목표, 전체 warm p95 5% 이내 비악화, 키 수·메모리·명령 수를 평가한다. 목표 미달이면 확대 전에 설계를 조정한다.
- [x] 6.3 `npm run check`와 `openspec validate --all --strict`를 실행하고 `docs/redis.md`, 아키텍처/개발 문서, 날짜별 검증 기록을 갱신한다.
- [ ] 6.4 운영 DB migration은 backup 및 disposable branch 강제 rollback 검증 후 적용한다. 모든 active writer의 revision 지원을 검증할 때까지 장기 캐시를 비활성으로 유지한다.
- [ ] 6.5 검증 환경에서 정책별 TTL을 확인하고 이전 writer가 사라진 전환 창에서 epoch를 교체하고 업무 캐시를 활성화한다. 확인된 커밋의 인증된 배포 smoke와 반복 timing을 남긴다.
- [ ] 6.6 정책 비활성 → writer rollback, 재활성 시 epoch 교체, DB 복원과 legacy namespace 격리 절차를 검증하고 runbook에 기록한다.

## 구현/운영 경계

- 코드 구현과 로컬 검증은 `docs/validation/2026-10-15-redis-cache-efficiency.md`에 기록한다.
- 5.3/5.4/6.2의 운영 사용률·최대 메모리·전체 HTTP p95는 미측정이다. 로컬 workload 결과만 기록하며 완료로 과장하지 않는다.
- 6.4/6.5는 운영 전환 작업이다. 이전 writer가 남아 있는 것을 확인했으므로 활성화하지 않는다. 운영 DB migration과 인증 smoke를 실행한 것으로 표시하지 않는다.

## 최종 코드 검증

- 독립 서브에이전트 3개로 3차 리뷰까지 진행했다. 확인한 2건을 수정했고 최종 지적은 0건이다.
- Node 24.21.0에서 실제 Redis·PostgreSQL·리플레이 및 벤치마크를 포함한 전체 검사 867개가 통과했다.
- 운영 전환 항목은 미실행 상태를 유지한다. 이번 전달 범위는 구현·검증·main push다.
