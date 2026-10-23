## Why

LLVY는 독립 웹 애플리케이션으로 유지하고 부가 서비스와 클라이언트를 별도 저장소에서 관리한다. 기존 Windows 업로더 계획은 웹과 Go 앱을 같은 저장소에 두므로, 구현 전에 저장소별 책임과 계약 관리 경계를 분리한다.

## What Changes

- 형제 `llvy-uploader` Git 저장소에 앱 계획, OpenSpec 설정과 작업 지침을 마련한다. 실제 Go 코드나 exe는 추가하지 않는다.
- 기존 혼합 계획을 LLVY의 `add-desktop-replay-upload-api`와 업로더의 `add-go-windows-replay-uploader`로 나눈다. 모든 기능 구현과 외부 검증 작업은 미완료로 유지한다.
- 기존 61개 작업과 리뷰의 이력을 보존하고 새 담당 저장소를 추적할 수 있게 한다.
- 데스크톱 API 계약 원본은 LLVY가 소유하고 업로더는 고정 버전의 계약을 소비하도록 계획한다. 두 저장소가 서로의 로컬 체크아웃에 빌드 의존성을 갖지 않게 한다.
- 위키의 범위를 Worker와 업로더 등 부가 프로젝트 중심으로 정리하고, LLVY는 연동 맥락과 원본 링크로 설명한다.

## Capabilities

### New Capabilities

- `uploader-repository-boundaries`: 앱·서버 계획의 독립 관리, 계약 소유권, 원본 이력과 위키 탐색.

### Modified Capabilities

없음. 기존 웹 동작과 런타임 요구사항은 변경하지 않는다.

## Impact

LLVY의 계획 문서와 계약 안내, 새 `llvy-uploader`, 기존 `llvy-wiki`만 변경한다. 서버 API·DB·환경변수·Worker 코드·Go 앱 구현, 원격 저장소 생성·푸시·배포는 범위에 포함하지 않는다. 저장소 분리 완료와 기능 구현 완료를 별도로 기록한다.
