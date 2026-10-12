# 2026-10-08 Discord 인증 전환 로컬 검증

후속 리뷰 수정과 PostgreSQL 경합 검증은 [2026-10-09 기록](2026-10-09-discord-auth-review-fixes.md)을 참고하세요.

[설계와 작업](../../openspec/changes/replace-password-auth-with-discord/) · [운영 설정](../discord-auth.md)

## 결과

`replace-password-auth-with-discord`의 구현과 로컬 검증을 완료했습니다.
실제 리플레이와 임시 로컬 Valkey 9를 포함한 `npm run check`에서 **39개 파일·702개 테스트가
모두 통과**했습니다. skipped 항목은 없습니다. ESLint, TypeScript, Next.js 16.3.8 production
build, Prettier도 통과했습니다. OpenSpec strict 검증은 valid입니다.

```bash
LLVY_VALKEY_TEST_URL=redis://127.0.0.1:16380 \
LLVY_REPLAY_FILE=/Users/gilsu/Downloads/TalkFile_KR-8390006818.rofl \
npm run check
OPENSPEC_TELEMETRY=0 openspec validate replace-password-auth-with-discord --strict
```

Valkey는 로컬에 있던 공식 `docker.io/valkey/valkey:9` 이미지로 만든 임시 컨테이너입니다.
테스트는 UUID namespace를 사용하고 종료 시 정리합니다. 실제 Layerbase TLS에는 연결하지 않았습니다.
리플레이 원본은 읽기만 했으며 Blob 전송은 모의 처리했습니다.

## 확인한 동작

| 범위          | 증거                                                                                                                                                                  |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| DB 전환       | 실제 SQL migration을 격리 PGlite에 적용. 암호 시대 credential retire, nullable/SET NULL FK, 게임·Riot 연결·과거 감사 보존, 새 계정 자동 매칭 없음                     |
| OAuth         | 실제 시작/callback handler와 모의 Discord 응답. identify-only·Bot 인증 분리, state/binding 해시·원자 일회 소비·교차 브라우저/중복/만료/취소 거절, 사용자 token 미저장 |
| 가입 확인     | non-pending 멤버만 입장. Unknown Member/pending 정지와 구성/timeout/다른 404 구분, 본문까지 5초·64KiB 제한                                                            |
| 세션·역할     | 실제 v5 서명·DB hash session, v4 이하 거부, 만료·secret/guild/owner 전환, 기존 viewer/admin/owner의 외부 장애 중 DB 접근                                              |
| 관리자 부여   | 등록 계정 검색·owner-only DAL/Action·대상 세션 없는 지정·중복/동시 grant 고유 제약·전체 세션 회수·재지정 시 old grant/예약 거절                                       |
| 권한 경쟁     | 과거 membership 응답 거부, 부여 중 새 거절 발견 시 실패, 기억한 actor와 회수 transaction의 직렬화, 권한 폐기 후 mutation 실패                                         |
| 원자성        | audit DB trigger 실패 시 로그인·부여·회수·정지와 업로드 예약 폐기를 함께 rollback. logout DB/audit 실패에도 쿠키 삭제                                                 |
| 봇 차단       | 같은 DB의 여러 호출자가 401/403·Unknown Guild·전역/bucket 429 대기를 공유. 긴 Retry-After·토큰 회전·단일 시험·죽은 lease·늦은 성공·공유 DB 실패·실패한 probe 재차단   |
| 일일 정리     | duplicate `busy`, owner 포함, 세션 없는 계정 포함, 부분 cursor 재개. 206계정이 200개/6개 batch로 전체 완료되고 미확인 계정은 유지                                     |
| 재가입        | 동일 계정의 새 로그인만 활성화. 이전 세션·grant 비복원. 오너도 과거 pending/processing 예약은 failed 상태로 유지                                                      |
| 캐시·개인정보 | 실제 Valkey 9에서 권한별 business cache, 매 요청 DB 인가, 회수 후 warm cache 접근 거절. viewer 실명 마스킹·생년 누락과 UI 관리 범위 유지                              |
| 업로드·감사   | 계정별 안정 예산, account/role/grant 비교, ingest 최종 권한 재검증, 기존 정확한 Blob 경로/nonce/state/resource 회귀, 신규·legacy 감사 snapshot cleanup                |
| API 장애      | 미인증 401·부족 권한 403·권한 DB 장애 503과 정적인 오류. 장애 시 binding/Blob 접근을 시작하지 않음                                                                    |

PGlite는 단일 연결이므로 위 경쟁 테스트는 원자 상태·순서·폐기 후 재검증을 보여줍니다.
실제 PostgreSQL의 다중 연결 잠금 경합이나 네트워크 partition을 증명하지 않습니다.
프로필 변경·동명 게임 멤버·게임 멤버 삭제가 Discord 계정 권한을 바꾸지 않는 것도 확인했습니다.
React client 권한 controls에는 account UUID와 상태만 전달하며 서버 비밀·session credential을
전달하지 않습니다. 실제 권한 판단은 독립 서버 검사와 transaction에 있습니다.

## 봇 조회 경합 후속 검증

정상 permit 경합을 즉시 실패시키던 동작을 제한된 대기로 교체했습니다.
로그인·관리자 부여는 로컬 호출 예산 대기를 포함해 최대 10초, Cron은 45초 실행 예산에서
provider timeout 5초를 남긴 범위에서 기다립니다. 대기 중 DB 행 잠금을 유지하지 않으며
새 공유 차단이 열리면 추가 외부 호출 없이 반환합니다.

12개 회귀를 추가했고 인증 integration 51개 테스트와 전체 702개 테스트가 통과했습니다.
실제 handler·PGlite·제어된 모의 Discord 응답으로 다음을 확인했습니다.

- 두 사용자 OAuth callback이 각각 code를 한 번만 교환하고 모두 세션을 발급합니다.
- Cron 조회 중 로그인, 로그인 중 Cron, 다른 조회 중 관리자 부여가 대기 후 완료됩니다.
- 로컬 permit 대기 시간 초과는 provider 호출·차단 개방 없이 반환합니다.
- Cron의 대기 예산 소진은 오류 횟수를 늘리지 않고 unchecked cursor를 보존하며 다음 실행에서 재개합니다.
- 로컬 초당 호출 예산이 다시 열리면 같은 조회가 계속 진행합니다.
- provider 호출 전 로컬 예산이 끝난 복구 lease는 실패한 probe로 기록하지 않습니다.
- 대기 중 401/403/전역 429가 발생하면 추가 호출을 막고, 성공한 단일 복구 probe 뒤에는 대기자를 처리합니다.

로그는 `/private/tmp/llvy-discord-contention-targeted.log`와
`/private/tmp/llvy-discord-contention-check.log`에 남겼습니다.
이번 검증의 임시 컨테이너는 `llvy-discord-contention-valkey`이며 종료 후 제거합니다.
실제 Discord·다중 연결 PostgreSQL·운영 Cron에서의 경합 검증은 아래 운영 대기에 포함됩니다.

## 로컬 브라우저

운영 DB에 연결하지 않는 테스트 설정의 Next 개발 서버 `127.0.0.1:3137`을 사용했습니다.
Codex in-app browser에서 다음을 확인한 뒤 탭과 개발 서버를 종료했습니다.

- `/login`: `Discord로 로그인`, `GET /api/auth/discord` form, password input 0개.
- 미인증 `/admin/users`: `/login?redirectTo=%2Fadmin%2Fusers`로 이동.
- `/login?error=unavailable`: 정적 Discord 확인 실패 안내 표시.

실제 브라우저에서 Discord에 동의하거나 사용자 계정을 생성·지정하지 않았습니다.
로그인 이후 역할별 화면과 Action/API 흐름은 모의 provider·PGlite·서버 렌더링 테스트입니다.

## 운영 대기

현재 실행 환경에 Discord CLIENT_ID/SECRET/BOT_TOKEN/GUILD_ID/OWNER_USER_ID/REDIRECT_URI가
설정되지 않았습니다. 실제 Portal callback·봇 설치와 Discord 성공/거절, 운영 Neon migration,
실제 Blob 업로드, Vercel Cron·공유 IP·ingress, 실제 다중 연결 PostgreSQL은 **미수행**입니다.
이전 배포 기록은 이번 변경의 운영 검증으로 사용하지 않았습니다.

[Discord smoke checklist](../discord-auth.md#staging운영-smoke-checklist)와
[전환 절차](../deployment.md#discord-인증으로-전환)를 별도 환경에서 완료해야 운영 적용할 수 있습니다.
이번 작업은 production migration·배포·push를 수행하지 않았습니다.
