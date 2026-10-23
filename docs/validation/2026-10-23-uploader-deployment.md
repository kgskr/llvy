# 업로더 역할 운영 마이그레이션·배포 검증

## 적용 범위

2026-10-23 운영 DB에 미적용 상태였던 `0008` 캐시 정책, `0009` desktop API, `0010` 업로더 역할 migration을 순서대로 적용했다. 기존 계정·권한·세션·게임·감사 데이터는 유지했다. 새로운 업로더 권한을 부여하지 않았으며 장기 캐시 정책은 비활성 상태다. 첫 서버 배포는 desktop 비활성 상태로 검증했으며, 이후 운영 활성화는 아래 별도 기록을 따른다.

영구 백업 브랜치를 보존하고, 별도 만료형 검증 브랜치에서 마지막 단계 강제 실패에 의한 전체 rollback과 정상 적용을 각각 확인했다. 저장소 Drizzle SQL과 journal hash를 대조한 원자적 SQL을 운영에 적용하고 migration 이력, 새 컬럼, 인덱스 유효성, 기존 데이터 보존을 다시 확인했다. 운영 DB 비밀값과 내부 데이터는 이 기록에 포함하지 않는다.

## 배포 전 검증

- Node.js 24.21.0, PostgreSQL 17, Valkey 9에서 `npm run check` 통과: 테스트 1,054개 통과, 5개 건너뜀. lint·typecheck·Next.js build·format 통과.
- `scripts/test-desktop-migration.mjs`, `scripts/test-uploader-role-migration.mjs`의 강제 rollback과 기존 행 보존 검사 통과.
- 운영 적용 SQL 자체도 별도 PostgreSQL DB에서 강제 rollback·정상 적용·journal 일치를 확인했다.
- 독립 코드 리뷰의 최종 배포 차단 지적 0건. `openspec validate --all --strict` 28개 통과, `git diff --check` 통과.
- 업로더 앱의 고정 계약 revision은 `fe32e8a93a426b0446338d24c201c5b778dab682`다. 서버 원본과 앱 사본의 schema·fixture·protocol 해시가 일치한다.

## 운영 서버 배포 결과

서버 코드 `2fbcb7e6488d03543e08e68732eda2ae126433e4`를 main에 게시하고 Vercel production 배포가 READY에 도달한 것을 확인했다. `www.llvy.my`와 `llvy.my`의 alias 할당이 성공했다. 계약 revision의 `uploader-role-contract` ref도 원격에 게시했다.

배포 직후 확인한 범위는 다음과 같다.

- `/login` 200, Discord 로그인 표시, 비밀번호 입력 없음. 비로그인 `/`는 `/login`으로 307 응답.
- 비로그인 자동완성과 두 maintenance API는 401 응답.
- desktop session GET과 auth requests POST는 503 `desktop_disabled`, `private, no-store` 응답. 기능 비활성 정책이 운영에서도 유지됨.
- 기존 일반 사용자 브라우저 세션에서 모임원·게임 목록 조회 성공. `/upload`는 게임 화면, `/admin/users`는 홈으로 이동하여 관리·업로드 접근을 차단함.
- 새 배포로 범위를 제한한 배포 직후 runtime error/fatal 로그 조회에서 반환된 오류 없음. 이는 장시간 관찰이나 전체 외부 흐름 검증을 의미하지 않음.

## 운영 업로더 활성화

운영 환경에는 이후 `DESKTOP_UPLOADER_ENABLED=true`를 설정하고 동일 코드 `d75e72ef804da626cef732c2c9a6959ee898ef57`를 재배포했다. 배포 `dpl_GWjKoiCQDpZXrXyxYToLRLgYKUVo`가 READY에 도달하고 운영 도메인 연결이 완료된 것을 확인했다. 기본값 false는 유지하며 preview/development의 설정은 변경하지 않았다.

운영 도메인에서 `/login` 200, 무인증 desktop session 401 `invalid_token`, 빈 JSON의 auth requests 400 `invalid_request`를 확인했다. 이전의 `desktop_disabled`가 사라지고 인증·입력 검증 단계가 실행된다. 배포 직후 해당 배포의 error/fatal 로그 조회에 오류가 반환되지 않았다. 기능 활성화만으로 아래 수용 검증을 완료 처리하지 않는다.

## 남은 수용 검증

서버 배포와 실제 Windows 앱 릴리스는 별도 단계다. 네 역할의 실제 브라우저 권한 전환, Discord·Blob 업로드, 실제 Windows 연결·refresh·회수, 구버전 요청 drain과 운영 rollback은 아직 전체 수용 검증을 마치지 않았다. 따라서 `add-uploader-role`과 `add-desktop-replay-upload-api`는 열린 상태를 유지한다. 캐시도 모든 active writer 확인과 성능·전환 검증 전에는 활성화하지 않는다.

연계 문서의 릴리스 상태 갱신 대상은 `llvy-uploader/contracts/desktop-v1/source.json`과 `llvy-wiki/wiki/uploader.md`다. 이번 서버 배포 기록만으로 앱 릴리스나 연계 저장소 문서 동기화 완료를 의미하지 않는다.
