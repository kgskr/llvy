# 2026-10-19 desktop 한도 재시도 안내

## 수정 범위

`BudgetExceeded`는 거부한 공유 카운터의 `resetAt`을 같은 transaction에서 조회해 전달한다. desktop 429의 `Retry-After`는 응답 시점의 잔여 초를 올림하며 최소 1초다. 시각이 없거나 유효하지 않으면 헤더를 생략한다. 기존 고정 86400초 응답을 제거했다.

정렬된 카운터 잠금과 전체 rollback, 기존 웹의 boolean 예산 API는 유지한다. 여러 카운터가 소진된 경우 현재 거부한 카운터의 재시도 대기 시간이며 다음 요청의 성공을 보장하지 않는다. 앱은 기존 헤더 파서와 표시를 그대로 사용한다. 고정 계약 JSON·체크섬은 변경하지 않았다.

## 검증

- 새 회귀 9개가 수정 전 고정 86400초 때문에 실패했고 수정 후 통과했다.
- 실제 예약 route의 계정·전체·양쪽 한도 소진에서 10.5초 잔여 시간이 11초로 반환됨을 PGlite로 확인했다. 거부된 요청에서 count/resetAt·pending/job/audit가 바뀌지 않고 기존 boolean 호출은 false를 반환한다.
- 초기화 시각 없음·invalid·과거·현재·소수점 경계에서 헤더 생략/올림/최소 1초를 검사했다.
- 데스크톱 및 기존 웹 예약 scoped tests 35개 통과. Node 24.21.0에서 `VITEST_MAX_WORKERS=2 npm run check` 통과: 902 tests passed, 81 skipped. lint·typecheck·Next build·format도 통과했다.
- OpenSpec strict 27개, 문서 링크·공백 검사 통과. 독립 수정 후 검토에서 추가 결함은 발견하지 못했다.

PGlite와 로컬 검사는 실제 PostgreSQL 다중 연결 경쟁·운영 DB·Windows·Blob·Discord 검증이 아니다. 운영 한도 변경, 배포 및 원격 푸시는 수행하지 않았다. 외부 검증이 남은 desktop change는 열린 상태로 유지한다.
