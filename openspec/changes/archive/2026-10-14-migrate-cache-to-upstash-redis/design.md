## Context

현재 캐시는 `ioredis` TCP/TLS 연결과 Redis 표준 GET/SET, MULTI/EXEC, Lua EVAL 및 Sorted Set 명령을 사용한다. Valkey 전용 SDK나 모듈은 없다. 싱가포르 함수에서 미국 Layerbase 연결이 실패해 DB로 대체되는 운영 경고를 확인했다.

## Goals / Non-Goals

**Goals:** 싱가포르 Upstash Redis를 운영 캐시로 연결하고 제공자 이름에 종속된 설정·코드를 정리한다. 현재 인가·개인정보 투영·TTL·무효화·UTF-8 검색 계약과 장애 대체를 유지한다.

**Non-Goals:** DB 마이그레이션, 세션 캐싱, 검색 DTO 변경, 기존 캐시 데이터 복사, 과거 검증 기록 재작성.

## Decisions

- `ioredis`를 유지한다. Redis 클라이언트이고 Upstash TCP/TLS와 호환된다. REST SDK 전환은 Buffer 경계값, 트랜잭션 응답 및 Lua 직렬화 변경을 요구하므로 이번 제공자 전환에 포함하지 않는다.
- 연결 모듈을 `redis.ts`로 바꾸고 `REDIS_URL`과 `REDIS_KEY_PREFIX`만 읽는다. 이전 `VALKEY_URL`로 조용히 되돌아가면 장애가 지속될 수 있어 자동 대체값을 두지 않는다. URL 미설정 시에는 기존 계약대로 DB를 사용한다.
- Upstash primary와 Vercel 함수 모두 싱가포르를 사용한다. Production에만 운영 자격증명을 연결한다. 새 캐시는 비어 있는 상태로 시작해 첫 조회가 채운다.
- URL은 서버 환경변수이며 TLS 검증·SNI, 연결 공유, 1초 제한, 5초 재시도 간격, 비밀정보 없는 경고를 유지한다.
- 공식 Redis 7 컨테이너에서 기존 통합 회귀를 실행한다. Redis 7의 BYLEX·Lua 지원과 Upstash 실제 운영 연결 확인을 구분한다.

## Risks / Trade-offs

- [Upstash 명령 지원 차이] → 기존 Lua·원자 게시·부분 eviction 회귀를 실제 Redis로 실행하고 운영 검색·캐시 키 존재를 별도로 확인한다.
- [새 캐시의 첫 요청 비용] → DB 원본에서 재구축하며, 과거 캐시는 복사하지 않는다.
- [캐시 장애 시 지연] → 기존 제한 시간과 DB 대체를 유지한다. 이번 작업은 장애 정책 변경보다 리전·제공자 이동에 집중한다.
- [이전 설정 잔존] → 새 코드는 VALKEY_URL을 읽지 않는다. 기존 리소스 삭제는 별도 작업으로 남긴다.

## Migration Plan

1. Upstash Free Redis를 싱가포르에 생성하고 Vercel Production에 연결한다.
2. REDIS_URL 주입을 값 노출 없이 확인한다. 소스·문서·테스트를 변경한다.
3. 로컬 Redis 통합 회귀, 전체 품질 검사, OpenSpec strict 검증을 통과한다.
4. 검증한 커밋을 배포하고 운영 도메인·커밋·sin1·인증된 조회·경고·응답 시간을 확인한다.
5. 문제 시 REDIS_URL을 제거하고 재배포해 DB 직접 조회를 사용한다. 이전 배포 복구가 필요하면 이전 Layerbase 설정이 포함된 배포의 캐시 장애 가능성을 함께 고려한다.

## Provisioning Result

사용자가 Upstash 설치 약관과 계정 정보 공유에 동의했다. 싱가포르(`sin1`) Free 인스턴스를 생성하고 자동 요금제 업그레이드를 끈 상태로 Vercel Production에만 연결했다. `REDIS_URL`은 sensitive 환경변수로 주입되었으며 값은 외부로 내보내지 않았다.
