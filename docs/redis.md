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
