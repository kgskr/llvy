# 2026-10-09 Discord 인증 리뷰 후속 수정

[설계와 작업](../../openspec/changes/replace-password-auth-with-discord/) · [이전 검증](2026-10-08-discord-auth.md)

## 수정

- 가입 거절 저장도 대상과 실행자 계정을 UUID 순서로 먼저 잠근다. 회수자 외래키가
  오너 계정에 요구하는 잠금 때문에 관리자 회수와 서로 기다리던 순서를 제거했다.
- 요청 제한을 통과한 로그인 시도 생성은 같은 transaction에서 만료 시도를 최대 20개
  회수하고 1개를 저장한다. 잠긴 만료 행은 건너뛰고 유효한 바인딩은 유지한다.
  생성 실패 시 회수도 롤백한다. 일일 Cron 일정과 기존 세션 만료 정책은 유지한다.

## 회귀 검증

PGlite에 기존 SQL migration을 적용하여 다음을 확인했다.

- 600회 시작 요청을 IP 제한 이내로 진행해도 저장량은 최근 유효한 시도 범위로 유지되고,
  다음 날 일일 정리에서 모두 제거된다. 사용자 계정·Discord API 호출은 필요하지 않다.
- 기존 만료 backlog는 호출당 20개씩 줄고 유효한 callback 바인딩은 소비 가능하다.
- 새 시도 insert 실패 시 만료 행 삭제도 롤백된다.
- 대상이 없을 때 실행자 계정에 가입 결과를 적용하지 않는다.
- 관리자 지정 중 거절도 계정·세션·grant·오너 감사가 함께 커밋하거나 롤백된다.

격리된 PostgreSQL 17 컨테이너에 실제 migration을 적용하고 `pg` 드라이버를 연결했다.
실제 `grantAdministrator`/`revokeAdministrator` 함수가 겹치도록 DB trigger/advisory lock으로
순서를 제어했다. 오너 UUID가 대상보다 앞/뒤인 두 경우 모두 deadlock 없이 정지·권한 회수가
직렬화됐다. 다른 연결이 만료 행 20개를 잠근 동안 두 `createLoginAttempt`도 대기 없이
나머지 만료 행을 회수했고, `consumeLoginAttempt`는 유효한 시도를 소비했다.

이 PostgreSQL 테스트 3개는 `npm run test:auth-postgres`로 재실행할 수 있다.
[설정과 격리 조건](../development.md#postgresql-인증-경합-테스트)을 따른다.

## 전체 검사

실제 리플레이·격리 PostgreSQL 17·Valkey 9를 지정한 `npm run check`에서 **40개 파일,
710개 테스트가 모두 통과**했다. skipped 항목은 없다. ESLint, TypeScript, Next.js 16.3.8
production build와 Prettier도 통과했다. OpenSpec strict 검증은 valid다.
이번에 추가한 회귀는 PGlite 5개와 실제 PostgreSQL 3개다.

```bash
LLVY_POSTGRES_TEST_URL=postgres://postgres:isolated-fix-only@127.0.0.1:15439/llvy_auth_test \
LLVY_VALKEY_TEST_URL=redis://127.0.0.1:16389 \
LLVY_REPLAY_FILE=/Users/gilsu/Downloads/TalkFile_KR-8390006818.rofl \
npm run check
OPENSPEC_TELEMETRY=0 openspec validate replace-password-auth-with-discord --strict
```

연결값은 이번 검증 전용 로컬 fixture이며 운영 비밀이 아니다. 로그는
`/private/tmp/llvy-auth-review-fix-check.log`에 남겼다. 임시 컨테이너
`llvy-auth-fix-pg`와 `llvy-auth-fix-valkey`는 검증 종료 후 제거했다.

## 범위

실제 리플레이는 로컬에서 읽으며 Blob I/O는 모의 처리한다. Valkey와 PostgreSQL은
폐기 가능한 로컬 컨테이너이고, 실제 Discord·Neon·Layerbase TLS·Vercel Cron/배포 검증은
수행하지 않는다. 운영 migration·배포·push는 이번 수정에 포함하지 않는다.
