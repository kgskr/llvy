# 개발·테스트

[프로젝트 README](../README.md) · [문서 목록](README.md)

## 개발 명령

Node.js 24.x에서 `npm ci`로 의존성을 설치합니다.
앱 실행에 필요한 환경변수는 [README](../README.md#실행)를 참고하세요.

| 명령                         | 용도                                         |
| ---------------------------- | -------------------------------------------- |
| `npm run dev`                | 개발 서버 실행                               |
| `npm test`                   | 전체 테스트 실행                             |
| `npm run test:watch`         | 파일 변경 시 테스트 재실행                   |
| `npm run test:integration`   | 저장·업로드·경기 관리 DB 통합 테스트 실행    |
| `npm run test:auth-postgres` | 실제 PostgreSQL의 인증 경합·검색 통합 테스트 |
| `npm run test:redis`         | 실제 Redis의 캐시·자동완성 통합 테스트       |
| `npm run lint`               | ESLint 검사                                  |
| `npm run typecheck`          | TypeScript 타입 검사                         |
| `npm run build`              | 배포용 빌드                                  |
| `npm run format`             | 코드 포맷 검사                               |
| `npm run format:write`       | 코드 포맷 적용                               |
| `npm run check`              | 테스트 → 린트 → 타입 → 빌드 → 포맷 전체 검사 |

## 테스트

테스트는 Vitest를 사용하며 구현 파일 가까이에 `*.test.ts`로 둡니다.
기본 DB 테스트는 메모리에서 실행되는 PGlite를 사용하고, Discord와 Blob 등 외부 연동은
모의 처리합니다. 별도 서비스 자격증명 없이 `npm run check`를 실행할 수 있습니다.

`test:integration`은 일부 DB 테스트만 실행합니다. 전체 테스트는 `npm test`로 실행하세요.
실제 PostgreSQL·Redis 연결이나 리플레이 파일이 필요한 테스트는 해당 설정이 없으면
건너뜁니다. 컨테이너 환경을 구성할 수 있다면 아래 실제 PostgreSQL·Redis 테스트도
함께 실행하세요. DB·캐시 관련 변경은 기본 검사만으로 검증을 끝내지 않습니다.

특정 테스트 파일만 실행하려면 다음과 같이 지정합니다.

```bash
npx vitest run src/lib/champions.test.ts
```

## PostgreSQL·Redis 컨테이너 테스트

Docker, Podman 등 사용 가능한 도구로 테스트용 PostgreSQL 17과 Redis 7 컨테이너를
준비합니다. 특정 컨테이너 도구를 요구하지 않습니다. PostgreSQL에서는 여러 연결 사이의
잠금 경합과 검색 쿼리를, Redis에서는 실제 명령·TTL·캐시 무효화와 자동완성을 검증합니다.
캐시 테스트는 하루 TTL 경계, revision과 업무 변경의 원자적 rollback,
독립 Node 프로세스 간 인덱스 게시 권한·프로세스 종료 복구까지 포함합니다.

컨테이너 포트는 `127.0.0.1`에 연결하고 PostgreSQL DB 이름은 `llvy_auth_test`로 지정합니다.
테스트가 데이터를 초기화하므로 개발·운영 데이터와 분리된 폐기 가능한 인스턴스를 사용하세요.

두 서비스가 연결을 받을 준비가 된 뒤 실행합니다. 아래는 PostgreSQL 포트가 `15439`,
Redis 포트가 `16379`인 예시이며 비밀번호와 포트는 만든 컨테이너 설정에 맞춥니다.

```bash
export LLVY_POSTGRES_TEST_URL="postgres://postgres:local-test-only@127.0.0.1:15439/llvy_auth_test"
export LLVY_REDIS_TEST_URL="redis://127.0.0.1:16379"

npm run test:auth-postgres
npm run test:redis
```

같은 환경변수를 설정한 상태에서 `npm run check`를 실행하면 전체 검사에도 포함됩니다.
전용 테스트 명령은 연결 설정이 없으면 실패합니다. 테스트가 끝나면 컨테이너를 정리하세요.

고정된 2분 간격 전적 재방문 workload의 로컬 비교는 `LLVY_CACHE_BENCHMARK=1`을
추가해 `npm run test:redis`로 실행합니다. 실제 Redis와 PGlite를 사용하며,
운영 네트워크·인증 제공자·에셋 카탈로그 지연을 재현하지 않습니다.

## 실제 리플레이 테스트

실제 `.rofl` 파일로 파싱·저장·조회를 확인하려면 파일 경로를 지정합니다.

```bash
LLVY_REPLAY_FILE="/absolute/path/to/match.rofl" npm run test:replay
```

원본은 읽기만 하며 저장소에 복사하지 않습니다. 인증과 Blob 통신은 모의 처리합니다.
전체 검사에 포함하려면 같은 환경변수로 `npm run check`를 실행하세요.

## 관련 문서

- [내부 구조](architecture.md): 데이터 모델과 주요 처리 흐름
- [OpenSpec](../openspec/README.md): 현재 요구사항과 변경 이력
