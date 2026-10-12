## Context

기존 인증은 계정 행에 가입 판정 버전을 보관한다. 등록 전 거절은 사라지며 오래된 긍정 결과가 등록을 완료할 수 있다. 검색은 JavaScript의 NFC·trim·소문자 일치를 사용하므로 DB 기본 collation의 lower()로 단순 교체하면 결과가 달라진다.

## Goals / Non-Goals

**Goals:** 리뷰 4건과 제출 검색의 전체 조회를 수정하고 실제 호출 경로와 기존 데이터 마이그레이션을 검증한다.

**Non-Goals:** 권한 모델 변경, 외부 Riot API 조회, 자동완성 전체 인덱스의 재설계, 운영 배포.

## Decisions

1. `auth_membership_decisions`에 guild·Discord ID별 최신 버전을 보존한다. 등록/콜백 판정은 이 행을 먼저 잠근 뒤 기존 계정 잠금 순서를 따른다. `applyMembership()` 내부에는 새 잠금을 추가하지 않아 관리자 부여·정리 경로의 역순 잠금을 방지한다. 거절된 신규 사용자의 로그인 계정은 생성하지 않는다.
2. Riot 계정의 표시명 관측 시각을 별도로 저장한다. 유효한 파일 수정 시각을 비교하며 시각을 모르는 업로드는 알려진 최신 표시명을 덮어쓰지 않는다. 동시 upsert는 DB 조건으로 최신성을 비교하고 계정 ID·모임원 연결은 유지한다. 기존 계정은 연결 경기의 추정 일자를 이용해 보수적으로 초기화한다.
3. PostgreSQL에 저장할 텍스트와 JSON 스칼라는 NUL·고립 surrogate를 공통 검증한다. 리플레이는 `RoflParseError`로 422와 기존 Blob 정리 경로를 사용하고, 모임원은 Action 및 mutation 경계에서 저장 전에 거부한다. 정상 emoji와 결합 문자는 허용한다.
4. DB 저장 generated 검색 컬럼을 사용해 직접 SQL·fixture·모든 mutation에도 정규화가 자동 적용되게 한다. 버전이 고정된 immutable 정규화 SQL 함수는 JavaScript Unicode 소문자 매핑과 Final Sigma 문맥 규칙을 생성 도구로 고정한다. 기본 collation이나 ICU 설치에 의존하지 않는다. NFC와 ECMAScript trim을 적용한다. 문자열 길이 제한에 부딪히지 않는 hash equality 인덱스로 정확 이름·닉네임 후보를 찾고 UNION으로 모임원 ID를 중복 제거한다. 총수와 20명 페이지는 DB에서 계산하고 선택된 페이지의 계정 미리보기만 조회한다. 정렬은 C collation의 UTF-8 순서와 UUID 순서를 유지한다.

## Risks / Trade-offs

- 파일 수정 시각은 실제 경기 시각의 보장이 아니다 → 현재 날짜 추정 계약을 유지하며 알 수 없는 시각은 더 최신이라는 근거로 사용하지 않는다.
- Unicode 규칙 변경 → 정규화 함수는 버전 고정, 생성 스크립트와 JS/DB 동등성 테스트를 유지한다. PostgreSQL 17의 이전 Unicode NFC 테이블과 다른 신규 문자는 공식 Unicode 17 데이터로 분해·결합 순서·조합을 보완하고, 나머지는 native NFC를 사용한다. 모든 canonical decomposition 및 기존/신규 결합 문자 순서를 실제 PostgreSQL에서 비교한다. 향후 변경은 새 함수와 컬럼 재계산 마이그레이션으로 수행한다.
- 인덱스·generated 컬럼 생성은 테이블 작업을 요구한다 → 배포 전 마이그레이션하고 실제 PostgreSQL에서 기존 데이터와 쿼리 계획을 확인한다.
- 로컬 서비스 검증은 운영 증거가 아니다 → Discord·Neon·Blob·Vercel 검증 범위를 문서에서 분리한다.

## Migration Plan

새 SQL migration은 가입 판정 테이블, 표시명 관측 시각, 정규화 함수·generated 컬럼·인덱스를 추가하고 기존 값을 초기화한다. 새 앱 배포 전에 `npm run db:migrate`로 적용한다. 앱 rollback 시 추가 컬럼은 유지할 수 있으나 이전 앱에는 수정된 보안/정확성 보장이 없으므로 forward fix를 우선한다.
