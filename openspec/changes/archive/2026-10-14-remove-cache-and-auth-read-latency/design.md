## Context

Redis 클라이언트는 연결·준비·명령에 각각 1초 제한을 둔다. API 핸들러와 검색 DAL이 각각 `assertSession()`을 실행한다. React 레이아웃과 페이지의 `getSession()`도 동일한 DB join을 반복한다.

## Goals / Non-Goals

**Goals:** 캐시 장애 검출의 1초 대기를 100ms로 줄이고, 동일한 읽기 요청의 인증 join을 한 번으로 합친다. 요청 간 권한 회수와 변경 시점의 최신 인증 확인을 유지한다.

**Non-Goals:** 세션의 Redis 캐싱, 요청 간 인증 TTL, DB 마이그레이션, 업로드·변경 작업 직전 재검증 제거, DB 장애 우회.

## Decisions

- Redis 연결·준비·명령 제한은 100ms로 설정한다. 오류 후 공유 연결을 끊고 기존 5초 재시도 간격을 유지한다. 싱가포르 내부 캐시 지연보다 넉넉한 짧은 제한이며, 무한 대기·재전송·오프라인 큐는 허용하지 않는다. 각 I/O 제한이지 전체 HTTP 요청의 SLA는 아니다.
- `getSession()`은 항상 최신 DB 조회로 유지한다. 별도의 `getReadSession()`만 React `cache()`로 렌더 패스 안에서 공유한다. 요청 간 Redis/전역 Map 캐싱은 사용하지 않는다.
- React 렌더 밖의 자동완성 GET에는 명시적 `AsyncLocalStorage.run` 범위를 둔다. 핸들러와 DAL의 인증 경계를 유지하면서 동일 요청의 진행 중 Promise·실패·null을 공유한다. 각 HTTP 호출은 별도 범위를 만든다.
- 읽기 전용 owner DAL은 읽기 인증 도우미를 사용한다. `assertAdmin`·`assertOwner`, Blob 발급 직전 확인과 트랜잭션의 권한 잠금은 최신 조회를 유지한다.
- 캐시와 검색의 TTL·원자 게시·권한별 투영·DB 오류 전파는 변경하지 않는다. 동작 중인 Redis 응답을 로컬 프록시에서 끊어 실제 시간 제한을 검증한다.

## Risks / Trade-offs

- [100ms 이상 느려진 정상 캐시도 대체됨] → DB가 원본으로 동작하고 재시도 간격 후 복구한다. 운영에서 캐시 키 생성과 반복 조회·경고를 확인한다.
- [요청 중간의 권한 변경] → 읽기 요청은 첫 인증 시점의 스냅샷을 사용한다. 다음 요청 및 변경·업로드 직전 검증은 새 DB 상태를 확인한다.
- [React cache가 Route Handler에 적용되지 않음] → GET에만 명시적 요청 범위를 사용하고 concurrent 요청 격리 회귀를 둔다.

## Migration Plan

실제 Redis·PostgreSQL·리플레이 포함 전체 검사와 OpenSpec strict를 통과한 커밋을 배포한다. 운영 캐시·인증된 읽기·401·배포 SHA를 확인한다. 문제 시 이전 커밋 배포로 복구한다.
