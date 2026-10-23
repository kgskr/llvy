<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# OpenSpec 작업 절차

요구사항을 구현하거나 변경할 때는 OpenSpec으로 제안·명세·작업 목록을 관리하고, 완료된 변경은 아카이브까지 진행한다. 저장소의 `openspec-propose`, `openspec-apply-change`, `openspec-archive-change` 스킬과 현재 OpenSpec 스키마를 따른다.

1. 작업 전에 `openspec list --json`으로 활성 변경을 확인하고 관련 `openspec/specs/` 명세를 읽는다. 같은 범위의 변경이 있으면 이어서 진행하고, 없으면 새 change를 만든다.
2. 구현 전에 해당 스키마가 요구하는 proposal, specs, design, tasks 등 산출물을 준비한다. `openspec status --change <change-name> --json`과 `openspec instructions apply --change <change-name> --json`으로 구현 가능 상태와 작업 범위를 확인한다.
3. 구현은 해당 change의 명세와 작업 목록을 기준으로 진행한다. 요구사항이나 설계가 바뀌면 관련 산출물도 갱신하고, 실제로 완료한 항목만 `tasks.md`에서 완료 처리한다.
4. 변경 범위에 맞는 테스트와 문서 검증을 수행하고, 코드 변경 시 `npm run check`를 실행한다. `openspec validate --all --strict`도 통과해야 하며, 구조 검증뿐 아니라 명세와 실제 구현의 일치 여부를 확인한다.
5. 산출물과 모든 작업 및 필수 검증이 완료되면, 작업한 change를 별도 아카이브 요청을 기다리지 않고 닫는다. 델타 명세와 정식 명세의 차이를 검토한 뒤 `openspec archive <change-name> --yes`로 `openspec/specs/`에 변경을 반영하고 `openspec/changes/archive/YYYY-MM-DD-<change-name>/`에 이력을 보존한다.
6. 아카이브 후 `openspec validate --all --strict`를 다시 실행하고, 해당 change가 활성 목록에서 빠졌으며 정식 명세가 최종 구현과 일치하는지 확인한다. 최종 보고에는 검증 결과와 아카이브 위치를 포함한다.

미완료 작업이나 필수 검증의 차단 사유가 남으면 change를 열린 상태로 유지하고 남은 항목을 보고한다. 로컬 테스트 성공을 브라우저·외부 서비스·운영 환경 검증 완료로 간주하지 않으며, 아카이브를 위해 미검증 작업을 완료 처리하거나 필요한 명세 동기화·검증을 생략하지 않는다.

# 문서 갱신

- 변경 전 [문서 유지관리](docs/documentation.md)의 갱신 표로 영향을 받는 문서를 정한다. API·권한, 환경변수·설정, 실행·배포 명령, 구조·상태, 문서 이동별 원본과 안내를 함께 확인한다.
- 구현과 활성 OpenSpec을 먼저 맞추고 관련 README·개발·배포 안내를 갱신한다. 정식 명세 동기화는 위 완료 조건을 따른다. 부가 서비스에 영향을 주는 변경만 해당 위키 요약에 반영한다.
- 문서 추가·이동·삭제·제목 변경 시 색인과 들어오는 링크·앵커를 확인한다. 문장만 수정했다면 근거 확인일을 올리지 않는다.
- 공개 문서에는 기술 사실·결정 이유·재현 가능한 검증 범위를 쓴다. 개인 홈 경로·계정 예시·개인 도구 정책·전역 에이전트 지침·대화 및 요청 경위·권한 승인 과정은 기록하지 않는다. 공통 개발 요건과 필요한 런타임 버전은 명시한다.
- 형제 저장소가 없으면 LLVY의 로컬 문서를 갱신하고 남은 대상 저장소·문서·수정 내용을 기록한다. 이를 문서 동기화 완료로 보고하거나 형제 체크아웃을 빌드 조건으로 추가하지 않는다.
