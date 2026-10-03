# 운영 배포 확인 — 2026-10-04

## 확인된 배포

- GitHub: [kgskr/llvy](https://github.com/kgskr/llvy), 기본 브랜치 `main`.
- 최초 게시 커밋: `d3c2f95fd5d1c4bd7c2f07b3d2d4afae54597a6c`.
- Vercel 프로젝트: `kimgs-projects/llvy`.
- 최초 배포: `dpl_5tNcvEB8aaDeVbQ7bczonWE2w5M2`, `production`, `READY`.
- 운영 검증 커밋: `555330e8728359ed5ddfc0bd9785efb5f85150cc` — private Blob 지원.
- 운영 검증 배포: `dpl_GVtqMSTnAkVPoSc8fkqck7BT93RX`, `production`, `READY`.
- 운영 별칭: [llvy.vercel.app](https://llvy.vercel.app).
- GitHub 배포 상태와 Vercel 배포 API의 커밋·브랜치·운영 별칭이 일치한다.
- 운영 별칭에 브라우저로 접근하면 앱의 공유 비밀번호 로그인 화면으로 이동한다.

최초 확인 시 최근 24시간의 해당 운영 배포 로그에서 HTTP 200 5건과 307 5건을 확인했다.
warning/error/fatal 로그는 0건이었다. 이는 로그인 화면 접근에 관한 제한적인 관찰이며
DB·Blob 또는 로그인 이후 처리 흐름이 정상이라는 증거는 아니다.
빌드 로그 조회 도구가 서버에서 제공되지 않아 상세 빌드 로그는 확인하지 못했다.
빌드·배포 완료는 GitHub 성공 상태와 Vercel `READY` 상태로 확인했다.

## 연결 상태

최초 확인 시 프로젝트 환경변수는 비어 있었다. 이후 Chrome의 Vercel 대시보드에서 기존
`llvy-neon-db`를 `llvy`의 **Production에만** 연결했다. 프로젝트 환경변수 목록에서
`POSTGRES_URL`, `POSTGRES_URL_NON_POOLING`이 Production의 Secret 변수로 생성된 것을 확인했다.
변수 값은 공개하거나 저장소에 복사하지 않았다.

기존 **비공개** `llvy-blob`도 Production에 연결했다. 연결 목록과 프로젝트 환경변수에서
`BLOB_READ_WRITE_TOKEN` 생성을 확인했으며, 사용자가 `UPLOAD_PASSWORD`를 Production의
Secret 변수로 직접 저장했다. 저장소 접근 방식은 Config 변수 `BLOB_ACCESS=private`로 설정했다.
이 설정을 반영한 운영 배포에서 Chrome 로그인과 아래 실제 업로드 흐름을 확인했다.

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

## private Blob 지원과 자동 검사

기존 코드가 공개 Blob만 전제로 하던 점을 수정했다. `BLOB_ACCESS`를 서버에서 검증하고
클라이언트에는 접근 모드만 전달한다. 비공개 파일은 저장소·경로·nonce를 검증한 뒤에만
동일 스토어의 원본 URL로 Bearer 인증을 전송하며, 리디렉션 차단과 다운로드 제한 시간을 유지한다.
독립 코드 검토에서 차단할 결함은 발견되지 않았다.

제공된 실제 솔랭 리플레이를 `LLVY_REPLAY_FILE`로 지정한 `npm run check`가 통과했다.
20개 테스트 파일·360개 테스트, ESLint, TypeScript, Next.js production build, Prettier를 포함한다.
이 자동 검사와 별개로 아래 운영 브라우저 검증을 수행했다.

## 운영 브라우저와 DB 검증

공유 비밀번호로 운영 앱에 로그인한 Chrome에서 파일을 선택하고 실제 업로드 UI를 사용했다.
전송은 브라우저에서 Vercel Blob으로 직접 수행하고 앱의 처리 라우트가 운영 Neon DB에 저장했다.

| 입력                                | 크기                     | SHA-256                                                            | 저장된 게임                            |
| ----------------------------------- | ------------------------ | ------------------------------------------------------------------ | -------------------------------------- |
| 실제 솔랭 `KR-8398474046.rofl`      | 18,517,442 bytes         | `5baa6b9b9cdcb6b9dc11002c576c9836b0f1f70b6b9c68dcbad020825bb339ee` | `0ea45c93-ccb5-488d-a71f-f46ba0481a4d` |
| 합성 `LLVYTEST-30MiB-20261004.rofl` | 31,457,280 bytes (30MiB) | `e4f1ebfb99a0446c0ffdfa37fd7ae8ddc3f060ad99a0aa76672151b25f125d5c` | `94a6f0ff-447d-4112-b2ff-e409ecfd36e2` |

- 실제 솔랭 파일을 총 3회 업로드했다. 처음에는 저장 성공, 이후에는 이미 저장된 리플레이라는
  안내와 동일 게임 링크를 표시했다. DB에는 해당 해시의 게임 1개와 참가자 10명만 남았으며,
  게임 상세에서도 양 팀 참가자 10명을 확인했다.
- 실제 파일의 `played_at`은 `2026-10-03 03:17:44+00`, `played_at_source`는 `file_mtime`이었다.
  이는 파일 수정 시각이며 실제 경기 시작 시각으로 확인된 값은 아니다.
- 30MiB 합성 리플레이가 함수 본문 제한에 걸리지 않고 직접 업로드·저장됐으며 참가자 10명과
  `file_mtime` 날짜 출처를 확인했다. 이 파일은 전송 크기 검증용이며 실제 내전 표본은 아니다.
- 66 bytes 텍스트 파일은 업로드 전에 “.rofl 파일만 업로드할 수 있습니다.”로 거부됐다.
- 유효한 리플레이 헤더가 없는 66 bytes `.rofl`은 업로드 후 `/api/process`의 HTTP 422와
  magic 오류로 거부됐다. 이후 DB의 게임 수는 2개로 유지됐고 `pending_uploads`는
  `processed` 4개, `failed` 1개였다.
- 합성 경기의 날짜를 하루 수정하면 “직접 수정” 출처를 표시하면서 원래 날짜를 보존했다.
  원본 날짜 복원도 운영 UI에서 성공했다.
- 합성 경기의 제외→복구→다시 제외를 운영 UI에서 확인했다. 최종 상태는 실제 솔랭 경기만
  활성, 합성 경기 1개는 제외이며 복구할 수 있다. 기본 경기 목록에는 실제 경기 1개와
  참가자 10명이 표시되며 합성 경기의 날짜는 원본으로 돌아갔다.

## Blob 보존과 접근 검증

- Vercel의 private 스토어 `replays/` 목록에는 실제 원본과 합성 원본 2개만 남아 있었다.
  각각 DB에 저장된 canonical Blob URL과 일치했으며 표시 크기는 약 18.5MB·31.5MB,
  전체 스토어 표시 용량은 약 50MB였다.
- 실제 파일의 중복 업로드 2회와 손상 파일 1회에 해당하는 Blob은 남아 있지 않았다.
  저장된 두 게임의 원본은 유지됐으며 합성 경기 제외도 Blob을 삭제하지 않았다.
- 실제 경기의 private 원본 URL을 Chrome 새 탭에서 직접 열면 `Forbidden` 본문이 표시됐고
  원본은 다운로드되지 않았다. 도구에서 HTTP 상태 코드를 별도로 확인하지 않았으므로
  이 기록은 특정 상태 코드에 대한 주장은 하지 않는다.
- 최종 점검 시 최근 30분의 운영 로그에서 `error`·`fatal`은 0건이었다.
  상태별 요청 수는 HTTP 200 44건, 307 1건, 422 1건이었으며 422는 위 손상 파일 검증에 해당한다.

계획한 운영 업로드·조회·중복·오류·Blob 정리·비인증 접근·경기 관리 검증을 모두 완료했다.

## 검증 범위

실제 사용자설정 게임·비표준 조합의 포지션 정확도, 다른 패치의 호환성 및 Neon 다중 연결의
잠금 경합은 이번 검증에 포함하지 않았다. 로컬 회귀 테스트나 솔랭 표본으로 이를 대신하지 않는다.

원본 리플레이와 환경변수 값은 저장소에 게시하지 않았다.
