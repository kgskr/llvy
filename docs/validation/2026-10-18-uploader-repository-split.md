# Windows 업로더 저장소 분리 검증

검증일: 2026-10-18. 대상은 저장소·계획·문서 분리이며 앱과 서버 기능 구현은 포함하지 않는다.

## 결과

- [앱 저장소](../../../llvy-uploader/README.md)를 독립 Git 저장소로 초기화했다. 원격 연결·커밋·푸시는 수행하지 않았다.
- [서버 계획](../../openspec/changes/add-desktop-replay-upload-api/proposal.md)은 LLVY에, [앱 계획](../../../llvy-uploader/openspec/changes/add-go-windows-replay-uploader/proposal.md)은 업로더에 배치했다.
- 서버 36개와 앱 34개 구현 작업은 모두 미완료다. 공동 작업 9개는 저장소별 책임으로 나눴으며 [이동표](../../../llvy-uploader/docs/repository-split.md)에서 기존 61개 번호를 모두 확인했다.
- 분리 당시 파일 12개를 [비활성 이력](../../../llvy-uploader/docs/history/2026-10-18-monorepo-plan/README.md)에 보존하고 원본 SHA-256과 일치함을 확인했다. 이후 설명 문구 편집 사항은 해당 이력 안내에 구분해 기록했다.
- 기존 명세 시나리오 103개의 이름과 본문이 분리된 명세에 보존됨을 확인했다. 기존 웹의 세 델타 명세는 원본 파일과 동일하다.
- 서버 API 계약은 기존 내용을 유지하고 Worker와 독립적인 데스크톱 활성화 요구사항을 추가했다. Windows 로컬 자격 증명 요구사항은 앱으로 옮겼다.
- LLVY의 `openspec validate --all --strict`: 29개 통과, 실패 0개. 업로더: 1개 통과, 실패 0개.
- 새 문서·변경 문서의 Prettier, 상대 링크와 경로·비밀값 형태 검사, 후행 공백 검사를 통과했다. 원본 이력은 다시 포맷하지 않았다.

## 확인 범위

변경은 Markdown·OpenSpec YAML·Git 제외 설정뿐이며 LLVY의 애플리케이션 소스·의존성·DB·환경변수와 Worker 코드는 수정하지 않았다.
코드 변경이 없어 `npm run check`, Go·Windows 실행·Blob·Discord·운영 배포 검증은 수행하지 않았다.
이 검증을 두 기능 계획의 구현 완료나 실제 독립 빌드·외부 서비스 검증으로 간주하지 않는다.

저장소 분리 관리 변경만 완료 처리하며 두 기능 변경은 열린 상태로 유지한다.

## 아카이브 확인

[저장소 분리 변경](../../openspec/changes/archive/2026-10-18-separate-windows-uploader-repository/)의 8개 작업을 완료하고 아카이브했다.
[정식 경계 명세](../../openspec/specs/uploader-repository-boundaries/spec.md)에 요구사항 3개를 반영했고, 아카이브 후 LLVY 엄격 검증 29개가 통과했다.
분리 변경과 기존 혼합 변경은 LLVY 활성 목록에서 빠졌으며, 서버 0/36과 앱 0/34 기능 작업은 열린 상태로 남았다.
