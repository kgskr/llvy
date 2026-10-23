# 2026-10-22 저장 제한과 refresh 복구 검증

## 수정 범위

- 게임 버전·챔피언 이름은 앞뒤 공백 제거 후 각각 UTF-8 256바이트, 원본 파일명은 입력 그대로 1,024바이트까지 허용한다. 파서와 저장 전 검사가 진단용 JSON 제한과 독립적으로 동작하며 초과 값을 잘라내지 않고 거부한다. 파일명은 중복 처리 전에도 검사한다. 스키마 마이그레이션과 과거 데이터 변경은 없다.
- 웹·desktop의 기존 `invalid_replay` 실패 감사와 무삽입 보장을 유지한다. 웹은 bound Blob의 즉시 정리를 시도하고 desktop은 기존 만료 정리로 삭제한다. 감사 파일명은 기존 정제·길이 제한을 유지한다.
- 업로더는 refresh의 HTTP 429와 `rate_limited` 코드가 함께 확인된 경우에만 메모리·보관 토큰 및 기기별 예약을 유지하고 원래 오류와 Retry-After를 전달한다. 그 밖의 오류·응답 유실·손상에는 기존 재로그인 정책을 유지한다.
- 시작 시 보관 연결 복구가 제한되면 즉시 Session으로 재호출하지 않는다. 이후 명시적인 로그인은 보관 토큰으로 재시도하며 새 브라우저 승인을 만들지 않는다. 업로드 뒤 한도 조회도 `rate_limited` 직후에는 생략한다. 일일 예약 한도 오류의 snapshot 조회는 유지한다.
- 위키는 이전 공개 계약 `f6c218f8d9b0476623b73dc75579722c8872d479`와 현재 앱이 고정한 로컬 계약 `fe32e8a93a426b0446338d24c201c5b778dab682`를 구분한다. 현재 source.json과 계약 JSON·체크섬은 변경하지 않는다.

## 로컬 검증

- Node 24.21.0에서 `VITEST_MAX_WORKERS=2 npm run check` 통과: 966 tests passed, 93 skipped. lint·typecheck·Next build·format도 통과했다.
- 파서·저장 예산·업로더 역할 통합 회귀 136개 통과. 두 ROFL 형식, ASCII·다중 바이트 경계와 초과 값, 약 1MiB 버전/파일명, 웹·desktop 422/실패 감사·무삽입·Blob 정리, 중복 경로 파일명 검사를 포함한다.
- Go 1.27.0에서 `go test -race -timeout 120s ./...`, `go vet ./...`, `go mod verify` 및 `GOOS=windows GOARCH=amd64 CGO_ENABLED=0 go build` 모두 통과했다. refresh 제한 뒤 같은 기기 복구, 보관 토큰 회전, 불확실한 응답의 재사용 금지, 시작 복구와 한도 조회의 즉시 재호출 방지를 검사한다.
- OpenSpec strict 서버 28개·앱 1개, 문서 상대 링크 375개·앵커 37개와 공백 검사를 통과했다. 계약 JSON 3개는 서버·앱 사본과 source.json SHA-256이 일치한다.

PGlite·모의 HTTP/Blob과 교차 빌드는 실제 PostgreSQL 경쟁·Windows UI/DPAPI·Discord·Blob·운영 배포·릴리스 검증이 아니다. 기존 미완료 작업은 서버 `harden-security-scan-findings` 6.9·6.10 및 앱 `add-go-windows-replay-uploader`에 남긴다. 두 change는 이 로컬 수정으로 아카이브하지 않는다.
