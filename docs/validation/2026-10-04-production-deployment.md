# 운영 배포 확인 — 2026-10-04

## 확인된 배포

- GitHub: [kgskr/llvy](https://github.com/kgskr/llvy), 기본 브랜치 `main`.
- 최초 게시 커밋: `d3c2f95fd5d1c4bd7c2f07b3d2d4afae54597a6c`.
- Vercel 프로젝트: `kimgs-projects/llvy`.
- 최초 배포: `dpl_5tNcvEB8aaDeVbQ7bczonWE2w5M2`, `production`, `READY`.
- 운영 별칭: [llvy.vercel.app](https://llvy.vercel.app).
- GitHub 배포 상태와 Vercel 배포 API의 커밋·브랜치·운영 별칭이 일치한다.
- 운영 별칭에 브라우저로 접근하면 앱의 공유 비밀번호 로그인 화면으로 이동한다.

최초 확인 시 최근 24시간의 해당 운영 배포 로그에서 HTTP 200 5건과 307 5건을 확인했다.
warning/error/fatal 로그는 0건이었다. 이는 로그인 화면 접근에 관한 제한적인 관찰이며
DB·Blob 또는 로그인 이후 처리 흐름이 정상이라는 증거는 아니다.
빌드 로그 조회 도구가 서버에서 제공되지 않아 상세 빌드 로그는 확인하지 못했다.
빌드·배포 완료는 GitHub 성공 상태와 Vercel `READY` 상태로 확인했다.

## 연결 상태와 남은 검증

Chrome의 Vercel 대시보드에서 프로젝트 환경변수가 비어 있음을 확인했다.
팀에는 기존 `llvy-neon-db`, `llvy-blob` 리소스가 있지만 프로젝트의 연결 대상으로 표시된다.
현재 이 기록은 연결이나 마이그레이션 완료를 증명하지 않는다.

다음 항목을 완료한 뒤 서비스 전체 검증을 마무리한다.

1. 기존 Neon·Blob을 필요한 배포 환경에 연결하고 `POSTGRES_URL`, `BLOB_READ_WRITE_TOKEN`을 확인한다.
2. 공유 비밀번호를 설정하고 변경된 환경변수를 배포에 반영한다.
3. 기존 DB의 테이블·Drizzle 적용 이력을 조회한 뒤 미적용 SQL 마이그레이션만 적용한다.
4. 인증 후 실제 솔랭 리플레이의 업로드·파싱·저장·조회와 중복 처리를 확인한다.
5. 30MB 파일의 브라우저→Blob 직접 전송, 비-rofl 거부와 관련 상태·원본 보존을 확인한다.

원본 리플레이와 환경변수 값은 저장소에 게시하지 않았다.
