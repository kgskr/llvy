## Why

공유 관리자 키로는 실행자를 식별하거나 특정 관리자의 권한만 취소할 수 없다. 일반 조회 사용자에게는 개인정보를 제한하고, 서비스 오너가 모임원별 관리자 권한과 감사 기록을 관리해야 한다.

## What Changes

- **BREAKING** 기존 uploader/admin 공유 키를 viewer/admin/owner로 교체하고 기존 세션을 폐기한다.
- 일반 사용자는 게임과 모임원만 조회하며 이름은 마스킹되고 생년은 전달되지 않는다.
- 오너가 모임원별 16자 영문 대소문자·숫자 키를 최초 한 번 발급하고 SHA-256 해시만 저장한다. 취소 후 재지정만 가능하다.
- 관리자는 기존 업로드와 데이터 관리 기능을 이용한다. 관리자 지정/취소와 감사로그 조회는 오너만 가능하다.
- 관리자·오너의 데이터 변경과 로그인 사건을 기록하고 DB 변경과 성공 로그를 원자적으로 저장한다.

## Capabilities

### New Capabilities

- `owner-managed-access`: 세 역할, 개별 관리자 키, 즉시 취소와 오너 전용 관리.
- `member-privacy`: 일반 조회자의 실명 마스킹과 생년 제거.
- `administrative-audit`: 실행자별 변경/인증 사건과 오너 전용 조회.

### Modified Capabilities

없음. 확정된 openspec/specs는 없으며 이전 역할 변경은 별도 change에 있다.

## Impact

인증/세션/Proxy, DB 및 migration, 로그인, 업로드 API/ingest, 관리 Action, 조회 데이터와 화면, 환경변수 및 운영 문서, 회귀 검증을 변경한다. 새 외부 서비스나 인증 라이브러리는 추가하지 않는다.
