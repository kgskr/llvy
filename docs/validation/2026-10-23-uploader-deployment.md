# 업로더 역할 운영 마이그레이션·배포 검증

## 적용 범위

2026-10-23 운영 DB에 미적용 상태였던 `0008` 캐시 정책, `0009` desktop API, `0010` 업로더 역할 migration을 순서대로 적용했다. 기존 계정·권한·세션·게임·감사 데이터는 유지했다. 새로운 업로더 권한을 부여하지 않았으며 장기 캐시 정책은 비활성 상태다. desktop 기능도 기본 비활성 정책을 유지한다.

영구 백업 브랜치를 보존하고, 별도 만료형 검증 브랜치에서 마지막 단계 강제 실패에 의한 전체 rollback과 정상 적용을 각각 확인했다. 저장소 Drizzle SQL과 journal hash를 대조한 원자적 SQL을 운영에 적용하고 migration 이력, 새 컬럼, 인덱스 유효성, 기존 데이터 보존을 다시 확인했다. 운영 DB 비밀값과 내부 데이터는 이 기록에 포함하지 않는다.

## 배포 전 검증

- Node.js 24.21.0, PostgreSQL 17, Valkey 9에서 `npm run check` 통과: 테스트 1,054개 통과, 5개 건너뜀. lint·typecheck·Next.js build·format 통과.
- `scripts/test-desktop-migration.mjs`, `scripts/test-uploader-role-migration.mjs`의 강제 rollback과 기존 행 보존 검사 통과.
- 운영 적용 SQL 자체도 별도 PostgreSQL DB에서 강제 rollback·정상 적용·journal 일치를 확인했다.
- 독립 코드 리뷰의 최종 배포 차단 지적 0건. `openspec validate --all --strict` 28개 통과, `git diff --check` 통과.
- 업로더 앱의 고정 계약 revision은 `fe32e8a93a426b0446338d24c201c5b778dab682`다. 서버 원본과 앱 사본의 schema·fixture·protocol 해시가 일치한다.

## 남은 수용 검증

서버 배포와 실제 Windows 앱 릴리스는 별도 단계다. 네 역할의 실제 브라우저 권한 전환, Discord·Blob 업로드, 실제 Windows 연결·refresh·회수, 구버전 요청 drain과 운영 rollback은 아직 전체 수용 검증을 마치지 않았다. 따라서 `add-uploader-role`과 `add-desktop-replay-upload-api`는 열린 상태를 유지한다. 캐시도 모든 active writer 확인과 성능·전환 검증 전에는 활성화하지 않는다.

연계 문서의 릴리스 상태 갱신 대상은 `llvy-uploader/contracts/desktop-v1/source.json`과 `llvy-wiki/wiki/uploader.md`다. 이번 서버 배포 기록만으로 앱 릴리스나 연계 저장소 문서 동기화 완료를 의미하지 않는다.
