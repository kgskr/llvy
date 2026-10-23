기존 혼합 계획의 번호를 유지한다. 번호가 빠진 항목은 다른 저장소가 담당한다. 공동 검증은 각 저장소의 책임을 나눈다. 서버 로컬 구현과 자동 검사를 진행했고 실제 Blob·Discord·Windows·배포 검증은 남아 있다. [검증 기록](../../../docs/validation/2026-10-18-desktop-uploader.md)을 참고한다.

## 1. 구현 기반과 선행 기술 검증

- [x] 1.1 현재 웹 로그인·업로드 공개 계약과 관련 활성 changes를 재확인하고 기존 회귀 테스트 baseline을 기록한다.
- [ ] 1.4 현재 Blob SDK 서명 PUT을 Go로 실제 테스트 store에 전송하고 public/private 필수 헤더, access 누락/변조, Control API 요청 URL과 객체 응답 URL 구분, 다른 경로·초과 크기·만료·덮어쓰기 거부를 확인한다. 미검증이면 후속 전송 구현 완료를 주장하지 않는다.
- [ ] 1.5 `/api/desktop/v1/` 요청·응답·오류·버전 정책과 공유 JSON 계약 fixture를 작성한다. transfer의 URL/method/headers/만료 및 헤더 allowlist, session의 account/global 한도 snapshot을 포함하고 실제 관찰에 맞춰 design/specs를 조정한다.

## 2. 추가 데이터 모델과 권한 기반

- [x] 2.1 `auth_sessions.kind`의 browser 기본값과 desktop 세션/연결 요청/credential 테이블을 추가하는 마이그레이션을 작성하고 모드·교체 대상·절대 만료·refresh tombstone 보존을 반영한다.
- [x] 2.2 desktop upload job의 기기/예약 바인딩, 멱등 키·fingerprint unique 제약, 서버 hash·terminal 결과 7일 보존 및 기기 절대 만료까지의 멱등 tombstone 구조를 추가한다.
- [x] 2.3 disposable DB에서 기존 browser 세션/예약/게임 보존, 중간 migration 실패 rollback과 제약을 검증한다.
- [x] 2.4 device actor·scope 및 kind-aware 인증 어댑터를 추가하고 기존 cookie 경로에서 desktop credential을 거부한다.
- [x] 2.5 기존 계정 → 세션 → grant 잠금 순서에 desktop/credential/job 잠금을 일관되게 연결하고 최종 저장까지 scope·원래 grant·활성 claim을 재검증한다.
- [ ] 2.6 `revokeAdministrator`와 `applyMembership` 양쪽에서 대상 grant/계정의 desktop session·credential·미완료 pending/job·claim 무효화 및 감사를 공통 잠금 순서의 같은 transaction에 연결한다. 완료 이력을 보존하고 owner 변경/secret rotation을 포함한 전체 기기/미완료 인증 요청 영구 회수 절차를 준비한다.
- [x] 2.7 `AuditChanges`/`safeChanges`에 검증된 deviceSessionId/channel/mode/replacedSessionId를 명시적으로 허용하고 저장 행 조회로 메타데이터 보존·비밀/임의 필드 제거를 검증한다.

## 3. 브라우저 승인과 기기 토큰 서버

- [x] 3.1 연결 시작 API에 고정 client ID, literal loopback URI, PKCE S256/state 검증과 trusted IP/global 예산 및 짧은 수명 요청 저장을 구현한다.
- [ ] 3.2 `/desktop/connect`에 기존 Discord 로그인 복귀, 계정/권한·모드/수명 표시, 명시적 승인/거절, same-origin/CSRF 검증과 요청에 바인딩한 임시 연결 교체 선택을 추가한다.
- [x] 3.3 승인 시 60초 일회용 코드 발급, 교환 시 승인 browser session/현재 권한 재검증 및 원자적 소비를 구현한다.
- [x] 3.4 최대 15분 access·transient 12시간/persistent 30일 절대 수명, domain-separated hash 저장, 계정 잠금 아래 활성 기기 합계 5개 제한과 승인된 transient 회수/신규 발급의 원자적 교체를 구현한다.
- [x] 3.5 refresh rotation·소비 token 재사용 시 family 회수·bounded 갱신 예산을 구현하고 tombstone 유지, cleanup 후 재사용 감지 및 응답 유실/동시 갱신 정책을 검증한다.
- [x] 3.6 본인 기기 목록/해제 화면과 앱 자체 revoke API를 추가하고 browser/device 로그아웃의 독립성을 검증한다.
- [x] 3.7 만료 요청·code·credential의 bounded cleanup, 비밀 없는 감사/진단, provider 장애와 무관한 maintenance를 구현하고 기존 auth-session cleanup이 refresh/멱등 tombstone 및 7일 결과를 조기 삭제하지 않게 한다.

## 4. 기존 웹을 보존하는 데스크톱 업로드 서버

- [x] 4.1 기존 업로드 handler에서 재사용할 검증·저장·정리 서비스를 추출하고 웹 URL/DTO/권한/오류 회귀 테스트를 유지한다.
- [x] 4.2 새 namespace의 Proxy 분기, 각 handler/DAL의 bearer·scope 검사, `DESKTOP_UPLOADER_ENABLED` 기본 false 및 비활성화 동작을 구현한다. Worker 연동과 별도로 제어하고 Worker/QStash 없이 데스크톱 API를 사용할 수 있게 한다.
- [x] 4.3 `consumeRequestBudgetsInTx`를 분리하고 actor → 기기 행 FOR UPDATE → 멱등 키 조회 → 정렬된 budget 차감 → pending/job/감사 삽입을 같은 transaction으로 묶는다. 기존 wrapper도 같은 예산 키 정렬을 사용하고 예산 부족/후속 실패 시 전체 rollback, 기존 키의 미차감 및 nonce 재생성을 구현한다.
- [ ] 4.4 정확한 store/path, PUT only, 5분 이하 만료, content type/크기/overwrite 제한을 갖는 전송 승인 API와 서버 소유의 URL/method/headers descriptor를 구현하고 전송 endpoint와 객체 URL 검증을 분리한다.
- [x] 4.5 desktop process가 uploadId/nonce만 받아 예약 store/path에서 canonical URL을 도출하도록 하고 기기 바인딩·서버 hash/size 검증·기존 파서 budget·duplicate·mtime 정책을 연결한다.
- [x] 4.6 `ingestReplay`의 사전 duplicate·신규 삽입·경합 duplicate 세 분기에 transaction finalizer를 연결해 최신 claim 검사, 서버 hash, pending/job terminal·감사·신규 게임/참가자/cache revision을 함께 커밋한다. 반환 후 별도 상태 갱신에 의존하지 않고 동일 요청의 202/저장된 결과 및 상태 조회를 구현한다.
- [x] 4.7 처리 claim 만료/worker 종료/취소의 unknown 결과와 정리 정책을 구현하고 pending cleanup이 7일 job 결과나 canonical Blob을 삭제하지 않게 한다. 결과 정리 후에도 기기 수명 동안 같은 키 요청을 tombstone으로 거부하고 추가 예산을 소비하지 않게 한다.

## 8. 웹 빌드와 배포의 독립성

- [x] 8.1 LLVY 단독 체크아웃의 기존 npm 빌드·검증·배포가 업로더나 Worker 파일에 의존하지 않음을 확인한다. Windows CI·client-only 경로 필터는 LLVY에 추가하지 않는다.

## 9. 자동 회귀 및 실제 PostgreSQL 검증

- [ ] 9.1 기존 웹 로그인/업로드 contract, viewer·다른 계정·다른 기기·재부여 grant·owner A→B→A 및 중간 요청 없음·scope 우회·정확 Blob 경로 회귀를 실행한다. 웹의 소비·만료된 바인딩 거부, desktop 전용 예약 처리, 경로 간 예약 재사용 거부, 예약 만료·pending 정리 후 권한 있는 결과 재조회와 Blob 재읽기·재저장·재삭제 없음, 회수된 기기의 결과 조회 거부를 포함한다.
- [ ] 9.2 실제 disposable localhost PostgreSQL 다중 연결로 code 소비, refresh 회전, 마지막 예산 경쟁, 동일 기기/키 최초 동시 예약, 반대 순서로 입력한 budget 키, 삽입/감사 실패 후 예산 rollback, 명시적 grant 회수 및 탈퇴/device 회수와 최종 저장의 lock 경쟁을 재현해 검증한다.
- [ ] 9.3 응답 유실·미확정 PUT·8일차 멱등 키 재사용·429·처리 실행 중단의 서버 계약 fixture와 서버 측 테스트를 구현하고 앱이 소비할 버전을 기록한다.
- [ ] 9.4 서버 변경에 대해 실제 replay 회귀, npm run check, git diff --check를 통과시키고 연계 앱 검증은 그 저장소의 commit/계약 버전과 결과를 연결한다.
- [ ] 9.5 LLVY에서 openspec validate --all --strict와 서버 정식/델타 명세 대조를 수행한다. `blob-processing-ownership`의 웹·데스크톱 바인딩과 소비·만료·결과 조회 규칙이 `desktop-replay-upload-api` 및 구현과 일치하는지 확인한다. 앱의 별도 검증 결과를 서버 구현 증거로 대신하지 않는다.
- [ ] 9.6 사전 duplicate·신규 game·unique 경합 duplicate 각각에서 finalizer 실패/claim 만료의 전체 rollback, 성공 후 응답 유실의 결과 복구, canonical Blob 보존과 웹 회귀를 검증한다. 감사 메타데이터 실제 저장 및 한도 snapshot 이후 다른 클라이언트의 소진 UI도 확인한다.

## 10. 외부 서비스와 실제 사용자 PC 검증

- [ ] 10.1 스테이징에서 기존 browser 업로드와 브라우저 승인 → Go token → 실제 Blob → 실제 ROFL 저장/duplicate 전체 흐름을 검증한다.
- [ ] 10.2 스테이징에서 웹·앱 공유 한도, 연결 해제/탈퇴 후 refresh·처리 거부, 서명 URL 잔여 수명과 고아 객체 정리를 확인한다.

## 11. 문서와 릴리스 준비 및 아카이브

- [x] 11.1 서버 기기 연결·해제, 인증·API·한도·운영/장애 대응 문서를 작성하고 별도 앱 사용 설명서로 연결한다.
- [ ] 11.2 schema 선행 적용, 기능 flag 활성화, server-first 호환 배포, device-only 비활성화/회수 rollback 절차를 정리하고 staging에서 검증한다. owner 변경/rollback은 과거 URL을 포함한 모든 serving version 차단·발급 drain·기기/미완료 인증 요청 영구 회수·기존 token 거부 검증을 필수 gate로 둔다.
- [ ] 11.4 서버 구현과 이 서버 change의 필수 검증 완료 후에만 add-desktop-replay-upload-api를 아카이브하고 strict 검증과 정식 명세 일치를 확인한다. 앱 change는 별도로 관리한다.

## 12. 인증 목록과 만료 요청 회귀 수정

- [x] 12.1 활성 기기 우선 목록과 요청 생성 시 만료 요청 bounded cleanup을 구현하고 보존·배치·동시 호출 회귀 테스트를 추가한다.
- [x] 12.2 서버 check·OpenSpec strict·문서 검사를 수행하고 실제 provider·Windows 검증은 열린 상태로 유지한다.

## 13. 운영 실행 도구와 계약 안내 정합성

- [x] 13.1 기본 dry-run과 명시적 대상/차단/drain 확인을 갖는 전체 기기 회수 CLI를 추가하고 입력 거부·무접속 미리보기·기존 회수 transaction 회귀를 검증한다.
- [x] 13.2 빌드 origin·프로토콜 호환성·현재 서버 구현 상태와 앱 소유 검증 항목의 안내를 실제 구현에 맞춘다.

## 14. 한도 소진 재시도 안내 수정

- [x] 14.1 거부한 카운터의 실제 초기화 시각을 전달하고 남은 초 올림·최소 1초·근거 없는 헤더 생략을 구현한다.
- [x] 14.2 계정/전체 한도와 부분 차감 rollback, 초기화 경계 회귀, 전체 check·strict·독립 리뷰를 수행하고 관련 안내를 갱신한다.
