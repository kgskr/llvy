## Why

Windows 업로더가 기존 웹 업로드를 보존하면서 LLVY 권한으로 파일을 등록하려면 별도 기기 인증과 버전 API가 필요하다. 기존 혼합 계획에서 서버 책임을 이 변경으로 분리한다.

## What Changes

- 기존 Discord 브라우저 승인과 PKCE를 이용한 제한된 기기 세션을 추가한다.
- 승인·기기 해제의 동일 출처 검증은 OAuth 콜백 주소가 아닌 실제 요청 Host와 Origin을 대조하고 세션·동작별 CSRF 토큰을 함께 확인한다.
- 승인 요청 ID를 모듈 수준 Server Action에 명시적으로 전달하고 production 빌드된 폼의 제출을 전체 검사에서 실행한다.
- `/api/desktop/v1/`의 인증·예약·전송 승인·처리·조회와 기존 저장 계층 재사용을 구현한다.
- 서버가 계약·fixture 원본을 소유하고 별도 업로더 저장소가 고정 버전을 소비한다.
- 기존 웹 URL·쿠키·DTO·계정 한도와 권한 잠금을 유지한다. `DESKTOP_UPLOADER_ENABLED` 기본 false로 독립 활성화하며 Worker 연결은 요구하지 않는다.
- 공유 한도 소진 응답의 대기 시간을 거부한 카운터의 실제 초기화 시각으로 계산한다.
- 전체 기기 회수용 운영 CLI를 제공하고 기본 dry-run, 명시적 대상 DB 확인 및 모든 serving 배포 차단·발급 drain 확인을 실행 조건으로 둔다.
- 앱 구현·Windows 빌드·exe 릴리스는 `llvy-uploader`의 별도 변경이 담당한다.

## Capabilities

### New Capabilities

- `desktop-device-authorization`: 브라우저 승인, PKCE, 기기 세션·토큰·회수와 권한 경계.
- `desktop-replay-upload-api`: 데스크톱 v1 공개 계약, Blob 전송 승인, 멱등 예약과 서버 처리.

### Modified Capabilities

- `replay-upload`: 기존 웹 계약을 보존하는 데스크톱 입력 경로.
- `discord-session-authorization`: 브라우저와 기기 세션의 분리·회수.
- `account-audit-upload-binding`: 기기 감사·예약 바인딩과 공유 예산.
- `blob-processing-ownership`: 웹·데스크톱 예약별 처리 권한과 소비된 바인딩의 재처리 금지, 데스크톱 결과 재조회 경계.

## Impact

LLVY의 인증 저장소·Route Handlers·승인 화면·DB 마이그레이션·공유 업로드 서비스·서버 검증에 영향을 주는 활성 구현 계획이다. 서버 코드를 로컬 구현하고 검증했으며 운영 배포와 실제 외부 연동은 남아 있다. [분리 안내](../../../docs/desktop-uploader.md)와 [앱 계획](../../../../llvy-uploader/openspec/changes/add-go-windows-replay-uploader/proposal.md)을 함께 읽는다.
