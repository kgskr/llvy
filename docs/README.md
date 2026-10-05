# 문서 안내

처음 설치하는 경우 [프로젝트 README](../README.md)부터 읽으세요.

## 사용·운영·개발 안내

| 문서                          | 내용                                                           |
| ----------------------------- | -------------------------------------------------------------- |
| [배포·운영](deployment.md)    | 본인 Vercel·Neon·Blob 연결, 환경변수, 마이그레이션과 정리 작업 |
| [개발·테스트](development.md) | 개발 명령과 스키마 변경, 로컬·실파일 테스트의 범위             |
| [내부 구조](architecture.md)  | 데이터 모델, 업로드 바인딩, 계정 연결과 인증·처리 한도         |
| [Layerbase Valkey](valkey.md) | Vercel URL 연결, 조회 캐시·닉네임 자동완성과 Podman 검증       |

## 설계와 작업 내역

- [리플레이 수집 MVP](../openspec/changes/replay-ingestion-mvp/): 기능 요구사항과 초기 설계
- [보안 하드닝](../openspec/changes/harden-security-scan-findings/): 업로드 소유권과 처리 예산의 설계 배경
- [경기 관리·모임원 전적](../openspec/changes/add-match-management-and-member-history/): 기능 요구사항과 구현 작업
- [세 역할·오너의 관리자 지정](../openspec/changes/introduce-owner-managed-admin-access/): 개인별 관리자 키, 조회 개인정보 제한과 오너 전용 감사로그
- [모임원·경기 관리 개선](../openspec/changes/refine-member-and-game-management/): 보호된 실제 삭제, 활성 경기의 미연결 계정, 날짜·코멘트와 관리 표 페이징
- [Layerbase Valkey 캐시](../openspec/changes/add-layerbase-valkey-cache/): 권한별 조회 캐시, 무효화와 닉네임 자동완성·검색
- [이전 업로더·관리자 권한 분리](../openspec/changes/add-uploader-admin-roles/): 역할별 권한·세션·키 교체와 전환 정책

OpenSpec 문서는 요구사항·설계·작업 이력을 보관합니다. 실행 방법은 위 안내 문서를 참고하세요.

## 날짜별 검증 기록

이 문서들은 해당 날짜의 코드·리소스·테스트 결과를 기록한 자료입니다. 당시의 배포 ID,
적용된 마이그레이션 수, 남은 작업은 현재 상태와 다를 수 있습니다.

- [2026-10-03 실제 솔랭 리플레이](validation/2026-10-03-real-replay.md): 실파일 파싱과 로컬 저장·조회
- [2026-10-04 경기 관리·모임원 전적](validation/2026-10-04-mvp-features.md): 통합 테스트와 로컬 브라우저 검증
- [2026-10-04 운영 배포](validation/2026-10-04-production-deployment.md): 특정 Vercel·Neon·private Blob 배포의 실제 업로드 검증
- [2026-10-05 업로더·관리자 권한](validation/2026-10-05-role-access.md): 역할별 인가·세션·키 교체와 로컬 브라우저 검증
- [2026-10-05 세 역할·오너의 관리자 지정](validation/2026-10-05-owner-managed-access.md): 개인별 키·오너 전용 감사로그·조회 마스킹과 518개 테스트 검증
- [2026-10-05 모임원·경기 관리 개선](validation/2026-10-05-management-refinements.md): 보호된 실제 삭제·활성 계정 큐·날짜·코멘트·페이징과 594개 테스트 검증
- [2026-10-05 Valkey 캐시](validation/2026-10-05-valkey-cache.md): Podman Valkey 9 실제 명령·무효화·검색 기반과 629개 테스트 검증
- [2026-10-05 닉네임 검색·자동완성](validation/2026-10-05-valkey-autocomplete.md): 연결된 모임원 검색·없는 사용자 페이지·Valkey 인덱스·브라우저와 663개 테스트 검증
