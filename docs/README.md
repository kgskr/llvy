# 문서 안내

처음 사용하는 경우 [프로젝트 README](../README.md)부터 읽으세요.

| 하고 싶은 일                          | 문서                              |
| ------------------------------------- | --------------------------------- |
| Vercel에 처음 배포하기                | [배포 안내](deployment.md)        |
| Discord 로그인과 사용자 권한 설정하기 | [Discord 안내](discord-auth.md)   |
| Redis 캐시 연결하기                   | [Redis 안내](redis.md)            |
| 개발 서버와 테스트 실행하기           | [개발·테스트](development.md)     |
| 코드를 읽고 수정할 위치 찾기          | [내부 구조](architecture.md)      |
| 현재 요구사항과 변경 이력 확인하기    | [OpenSpec](../openspec/README.md) |
| 변경에 맞춰 문서를 갱신하기           | [문서 유지관리](documentation.md) |

구현 중인 별도 클라이언트는 [Windows 업로더와 서버 경계](desktop-uploader.md)에서 확인할 수 있습니다.

최근 서버 한도 수정 근거는 [desktop 재시도 안내 검증](validation/2026-10-19-desktop-quota-retry.md)에서 확인한다.

[업로더 역할 구현·검증](validation/2026-10-19-uploader-role.md)에는 로컬 권한·파일 감사 검증과 남은 계약/실환경 조건을 기록한다.

[저장 제한·refresh 복구 검증](validation/2026-10-22-review-fixes.md)에는 정규화된 메타데이터 상한, 업로더의 제한 응답 복구와 위키 계약 revision 정합성을 기록한다.

[업로더 운영 마이그레이션·배포 검증](validation/2026-10-23-uploader-deployment.md)에는 운영 스키마 적용과 서버 배포의 확인 범위를 기록한다.
