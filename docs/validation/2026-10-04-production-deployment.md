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

최초 확인 시 프로젝트 환경변수는 비어 있었다. 이후 Chrome의 Vercel 대시보드에서 기존
`llvy-neon-db`를 `llvy`의 **Production에만** 연결했다. 프로젝트 환경변수 목록에서
`POSTGRES_URL`, `POSTGRES_URL_NON_POOLING`이 Production의 Secret 변수로 생성된 것을 확인했다.
변수 값은 공개하거나 저장소에 복사하지 않았다.

Vercel의 Neon Query에서 적용 전 DB를 조회했다. DB명은 `neondb`, 현재 스키마는 `public`이며,
`public` 테이블 목록은 비어 있고 `drizzle.__drizzle_migrations`도 없었다.
전체 스키마 조회에서는 Neon 관리용 `neon_auth` 테이블 9개만 확인했다.
앱 마이그레이션의 대상은 `public`·`drizzle`이며 이 관리용 테이블은 변경하지 않는다.

## 운영 DB 마이그레이션

`0000_init.sql`, `0001_new_scream.sql`, `0002_match_management.sql`을 운영 DB에 적용했다.
Vercel Query는 단일 prepared statement만 허용하므로, 원문 SQL과 Drizzle 이력 INSERT를
하나의 `DO` 문 안에서 원자적으로 실행했다. `public`·`drizzle`에 기존 relation이 있으면
DDL 전에 중단하도록 검사했으며, 별도 `neon_auth` 스키마는 대상으로 삼지 않았다.
같은 SQL의 정상 적용·재실행 거부·기존 데이터 보존·중간 실패 롤백은 PGlite에서도 확인했다.

적용 후 운영 DB의 읽기 전용 쿼리에서 다음을 확인했다.

- 앱 테이블 5개: `members`, `riot_accounts`, `games`, `game_participants`, `pending_uploads`.
- `games.played_at_override`, `games.excluded_at`과 활성·제외 경기 조회 인덱스 2개.
- `neon_auth` 테이블 9개 보존.
- Drizzle 이력 3행의 hash·timestamp가 저장소 원본 및 설치된 migrator와 일치.

| Migration               | created_at      | SHA-256                                                            |
| ----------------------- | --------------- | ------------------------------------------------------------------ |
| `0000_init`             | `1782745103949` | `444d2028df3548efd6f4c5cc8e4ce336d635f72e30c0cb0e87d5f3473acd99c1` |
| `0001_new_scream`       | `1784605417381` | `05ae293e0157014db9020a2efabab79597003e2d3155cc4e786c503cdd22fea3` |
| `0002_match_management` | `1791039652248` | `6043d11c0f4600d5ac3071eb74396f93bedfc678ca4bc97e361bb30671a3668e` |

## 남은 검증

다음 항목을 완료한 뒤 서비스 전체 검증을 마무리한다.

1. 기존 Blob을 Production에 연결하고 `BLOB_READ_WRITE_TOKEN`을 확인한다.
2. 공유 비밀번호를 설정하고 변경된 환경변수를 배포에 반영한다.
3. 인증 후 실제 솔랭 리플레이의 업로드·파싱·저장·조회와 중복 처리를 확인한다.
4. 30MB 파일의 브라우저→Blob 직접 전송, 비-rofl 거부와 관련 상태·원본 보존을 확인한다.

원본 리플레이와 환경변수 값은 저장소에 게시하지 않았다.
