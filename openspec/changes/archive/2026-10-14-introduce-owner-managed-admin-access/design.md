## Context

Next.js 16.3 App Router/Server Actions/Proxy와 Drizzle/PostgreSQL을 사용한다. 기존 v3 세션에는 역할만 있고 개별 관리자는 식별되지 않는다. 데이터 변경은 서버 Action과 ingest에서 수행되며 성공 감사로그가 없다. 일반 조회에도 실명/생년을 전달한다.

## Goals / Non-Goals

**Goals:** 세 역할, 개별 키 발급/취소, 현재 권한의 서버 검증, 서버 개인정보 투영, 변경과 성공 로그의 원자성, 오너 전용 로그 조회.

**Non-Goals:** OAuth, 사용자 선택 비밀번호, 재발급/키 재조회, 조회 사건 전부 기록, 원격 배포나 기존 Blob 저장소의 전환.

## Decisions

1. READ_PASSWORD/OWNER_PASSWORD와 독립 AUTH_SECRET을 필수로 사용한다. 공유키는 서로 다르게 설정한다. v4 세션은 역할·발급시각·UUID·관리자 모임원/credential ID를 서명한다. 공유키 교체는 해당 역할의 세션을 폐기하고 AUTH_SECRET 교체는 전체를 폐기한다. 관리자 서명에는 키 원문이 필요하지 않다. Proxy는 서명만 검사하고 실제 데이터 접근은 DB의 활성 credential을 검사한다.
2. admin_credentials는 발급마다 새 UUID를 갖고 모임원당 활성 행 하나, 키 해시 고유 제약을 둔다. 암호학적 randomInt로 생성한 16자리 alphanumeric에는 대문자·소문자·숫자가 최소 하나 포함된다. SHA-256만 저장하고 성공 응답에 원문을 한 번 반환한다. 중복 발급/동시 클릭은 제약과 모임원 행 잠금으로 직렬화한다.
3. getSession/assertAdmin/assertOwner는 검증된 실행자 정보를 반환한다. DB 변경 transaction에서는 관리자 credential에 공유 행 잠금을 잡고 revokedAt을 재확인한다. 취소는 credential 배타 잠금 후 모임원 잠금 순서를 사용해 직렬화하고 자기 정보 수정과의 잠금 순서 역전을 피한다. 취소 완료 후 이전 세션의 새 변경은 커밋되지 않는다. 이미 커밋한 데이터는 유지한다.
4. audit_logs는 실행자 ID/당시 이름/역할/credential ID, 사건·대상·결과·허용된 변경값·request ID를 기록한다. 비밀키/해시/쿠키/원시 요청은 기록하지 않는다. 서비스 코드에는 로그 수정/삭제 기능을 제공하지 않는다. DB 변경과 성공 로그는 같은 transaction으로 저장하고 로그인/실패 사건은 별도로 기록한다. 관리자와 viewer는 조회가 차단된다.
5. 서버의 공통 개인정보 projection을 사용한다. viewer는 첫/끝 글자를 제외한 이름을 *로, 두 글자는 첫 글자+*로, 한 글자는 *로 표시하고 birthYear 속성을 제거한다. 현재 문자열 모델의 복성 인식 한계를 문서화한다. 역할별 개인정보 응답은 공유 cache에 저장하지 않는다.
6. 업로드 세 API는 admin/owner만 허용한다. 예약에 실행자를 연결해 같은 credential/owner가 처리하고 ingest commit 직전 활성 권한을 검사한다. 성공/중복/실패는 예약 ID로 연계한다. Blob callback은 기존 서명 검증을 유지한다.

## Risks / Trade-offs

- [키 전달로 다른 사람이 모임원 명의 사용] → 감사 실행자는 그 키의 소유 모임원을 의미함을 안내한다.
- [발급 응답 유실] → 취소 후 재지정만 지원한다.
- [DB 장애로 권한/로그 확인 불가] → 보호 데이터와 변경은 실패 처리한다.
- [SHA-256의 빠른 추측] → 사용자가 정하는 비밀번호를 금지하고 약 95비트 무작위 키만 사용한다.
- [서비스 DB 자격증명 소유자는 로그 수정 가능] → 앱에서만 불변성을 보장하며 외부 불변 로그 저장은 범위 밖이다.

## Migration Plan

DB migration을 먼저 적용하고 새 READ_PASSWORD/OWNER_PASSWORD를 설정한다. 기존 UPLOAD_PASSWORD 값은 조회용으로 이전할 수 있으나 이전 ADMIN_PASSWORD는 폐기하고 새 오너 키를 생성한다. 새 앱은 기존 세션을 거부한다. 운영 배포/DB 변경은 이 로컬 구현의 검증 범위에 포함하지 않는다. 이전 앱으로의 롤백은 이 권한/마스킹 보장을 제거하므로 접근 제한 후 수행한다.

## Open Questions

없음. 감사로그는 데이터 변경/로그인 사건이며 조회는 오너 전용으로 확정되었다.
