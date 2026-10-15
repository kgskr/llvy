# Redis

[문서 목록](README.md) · [Vercel 첫 배포](deployment.md)

## Redis를 연결하면

반복되는 조회와 검색에 캐시를 사용해 PostgreSQL 부하를 줄일 수 있습니다.

- **경기 조회**: 경기 목록과 상세 정보를 캐시합니다.
- **모임원 조회**: 모임원 목록과 전적을 캐시합니다.
- **검색 자동완성**: 모임원 이름과 Riot ID 추천에 필요한 인덱스를 캐시합니다.

데이터가 변경되면 관련 캐시를 갱신합니다. Redis는 선택 사항이며,
연결하지 않거나 장애가 발생해도 PostgreSQL을 통해 조회와 검색을 계속할 수 있습니다.

## Upstash Redis 연결

1. [Vercel의 Upstash 연동](https://upstash.com/docs/redis/howto/vercelintegration)으로
   Redis 데이터베이스를 만들고 프로젝트에 연결합니다. 리전은 앱과 가까운 곳을 선택하세요.
2. Upstash의 연결 정보에서 **TCP/TLS 연결 URL**을 확인하고 Vercel 환경변수
   `REDIS_URL`에 설정합니다. REST URL 대신 `rediss://`로 시작하는 주소를 사용합니다.
3. 환경변수를 적용할 배포 대상을 확인하고 앱을 다시 배포합니다.

```dotenv
REDIS_URL="rediss://default:<password>@<host>:6379"
```

연결 주소는 서버 전용 환경변수로 보관하며 `NEXT_PUBLIC_` 접두사를 붙이지 않습니다.

## 보관 시간과 변경 반영

| 데이터                         | 기본 TTL          | 변경을 확인하는 범위                            |
| ------------------------------ | ----------------- | ----------------------------------------------- |
| 모임원 목록과 포함된 연결 계정 | **86,400초 고정** | members, accounts                               |
| 경기 목록·개수                 | 30분              | game-list; 목록은 members, accounts도 포함      |
| 경기 상세                      | 6시간             | 해당 game, members, accounts                    |
| 전적 전체·챔피언·포지션 통계   | 1시간             | history                                         |
| 전적 관계별 승률·만남 통계     | 1시간             | history, members, accounts                      |
| 전적 경기 페이지               | 30분              | history, members, accounts                      |
| 전적의 별도 연결 계정 목록     | 30분              | accounts                                        |
| 호환용 닉네임 부분 검색        | 5분               | members, accounts, riot-eligibility             |
| 이름·Riot ID 자동완성 인덱스   | 6시간             | members/accounts 또는 accounts/riot-eligibility |

모임원 목록에는 jitter가 없습니다. 나머지 양수 결과에는 저장 시 ±10% jitter를 적용하고,
단일 자원 없음(null)은 30초 보관합니다. 읽기로 수명을 연장하지 않습니다.
인덱스의 names/hash/ready는 같은 절대 시각에 만료됩니다.

쓰기와 관련 revision 증가를 같은 PostgreSQL 트랜잭션에서 커밋합니다.
Redis 무효화 요청이 실패해도 다음 요청은 새 revision으로 조회합니다.
댓글 수정은 경기 목록·해당 상세만 바꾸며 검색·전적 통계를 버리지 않습니다.
업로드 예약, 중복 리플레이와 실제 값이 같은 수정은 업무 revision을 바꾸지 않습니다.
세션·권한은 요청마다 현재 DB에서 확인하며 공유 캐시에 넣지 않습니다.

## 제한과 장애 처리

- 일반 조회의 동시 miss는 인스턴스 안에서 하나의 로더로 합칩니다. 반환 객체는 호출별로 분리합니다.
- 자동완성은 두 source revision을 한 SQL로 읽고 두 Redis 조회를 pipeline으로 묶습니다.
  인덱스 구축 lease는 10초이며 소유자만 원자적으로 게시·해제합니다.
  다른 프로세스는 최대 50ms 기다린 뒤 DB로 조회합니다. API는 `after()`에서 게시하고,
  callback 누락 시 로컬 pending도 10초 뒤 해제합니다.
- Redis 연결·명령 제한은 각각 100ms, 읽기·조정 누적 예산은 150ms입니다.
  장애 후 5초 동안 연결 재시도를 쉬며 DB로 조회합니다. 이 제한은 전체 API 응답 시간 제한이 아닙니다.
- 일반 결과는 256KiB 이하, 페이지 캐시는 첫 20페이지, pending map은 256개로 제한합니다.
  인덱스 게시 상한은 10,000행·8MiB이며 임시 키는 60초 뒤 만료됩니다.
  과거 revision 키는 TTL로 정리하며 전체 키 스캔·flush를 사용하지 않습니다.

`CACHE_METRICS=1`이면 인증, revision, Redis, 업무 로더, 인덱스 구축·게시,
에셋 조회 시간과 적중 결과·payload 크기를 JSON 로그로 남깁니다.
검색어·계정 ID·연결 URL·인증 정보는 기록하지 않습니다. 자동완성 API에는
같은 요청의 `Server-Timing`이 포함됩니다. `after()` 게시 시간은 응답 후 로그에서 확인합니다.

## 활성화와 복구

`0008_cache_revisions.sql`의 기본값은 `cache_policy.enabled = false`입니다.
비활성·metadata 누락/조회 실패 시 새 코드는 업무 DB를 직접 조회합니다.
Redis 미연결 또는 장애 cooldown 중에는 revision 확인용 DB 조회도 생략합니다.
이전 배포와 공존하는 동안 이전 60초 캐시의 generation 무효화도 유지합니다.

1. 운영 DB backup branch를 유지하고 disposable branch에서 migration의 정상 적용과
   마지막 단계 강제 실패 rollback을 검증합니다. Drizzle 이력과 고정 SQL을 대조한 뒤 적용합니다.
2. 같은 DB를 쓰는 production·preview·이전 배포·관리 작업 모두 revision을 갱신하는지 확인합니다.
   이전 writer를 확인할 수 없으면 비활성을 유지합니다. 먼저 검증 환경에서 정책별 TTL을 확인합니다.
3. 전환 창에서 새 epoch와 활성 상태를 한 SQL로 설정합니다. 업무 캐시 전체에 적용됩니다.

   ```sql
   UPDATE cache_policy SET epoch = gen_random_uuid(), enabled = true WHERE id = 'business';
   ```

4. 확인된 배포 커밋에서 인증된 반복 조회·변경 직후 조회·권한 회수와 지연을 확인합니다.
   업무 로더뿐 아니라 revision SQL, Redis 명령 수, 전체 p50/p95와 메모리도 비교합니다.

이전 writer로 코드 rollback하거나 revision을 기록하지 않는 직접 SQL 작업을 하기 **전**에
`UPDATE cache_policy SET enabled = false WHERE id = 'business'`를 실행합니다.
진행 중 요청이 끝난 후 작업하며 additive schema는 유지합니다.
재활성화나 DB restore 후에는 반드시 새 epoch를 설정합니다.
이전 reader로 되돌아갈 때는 이전 namespace를 교체하거나 이전 60초 TTL 만료를 확인합니다.
DB restore 중에는 트래픽·writer를 중지하고, 복구된 정책을 비활성화한 뒤 재개합니다.
