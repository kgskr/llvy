# 데스크톱 API 계약 관리

상태: desktop-v1 후보 계약과 서버 구현이 있다. 실제 Blob PUT·Discord·Windows 검증 전이며 릴리스 계약으로 확정하지 않았다.

- [프로토콜·경로·헤더 정책](protocol.json)
- [JSON 스키마](schema.json)
- [비밀 없는 fixture](fixtures.json)

전송 헤더는 설치된 `@vercel/blob` 2.5.0 소스와 타입에 맞춘 후보이다. public/private 실제 PUT, 변조·만료·overwrite 검증 후 확정한다. 제품 앱은 빌드의 필수 `LLVY_SERVER_ORIGIN`으로 HTTPS origin을 고정한다. `protocol.json`의 `productOrigin`은 고정 시점의 계약 메타데이터로 유지하며 앱 런타임의 주소 기본값으로 사용하지 않는다.
정의 중인 인증·전송 계약은 [서버 OpenSpec](../../openspec/changes/add-desktop-replay-upload-api/specs/)이 기준이다.
완료 후에는 LLVY의 정식 명세와 함께 관리한다.

## 원본과 소비자

LLVY는 `/api/desktop/v1/`의 요청·응답·오류·버전·허용 헤더와 비밀 없는 fixture의 원본을 이 디렉토리에서 관리한다.
업로더는 검토된 원본 revision의 사본을 자신의 `contracts/desktop-v1/`에 포함한다.
사본을 추가할 때 원본 저장소 식별자, 전체 commit SHA, 파일별 SHA-256, 지원 API 버전을 함께 기록한다.
현재 원본 원격은 LLVY의 origin으로 확인하며 업로더 원격 주소나 아직 없는 계약 commit을 만들어 적지 않는다.

일반 빌드·단위 검사는 각 저장소의 고정 파일만 사용한다.
형제 체크아웃 경로·submodule·빌드 중 최신 원본 다운로드를 필수로 만들지 않는다.
변경이 필요하면 서버 원본을 먼저 수정·검증하고 앱 사본 갱신을 별도 검토한다.
앱 사본에 계약을 독자적으로 추가하지 않는다.

## 호환성과 배포

LLVY는 지원 중인 v1 exe의 응답 의미·필수 헤더를 깨지 않게 변경한다.
서버가 새로 필요한 앱은 서버 호환 배포와 검증 후 발행한다.
릴리스 기록은 서버 commit·계약 revision·앱 commit과 각각의 검사 결과를 연결한다.
실제 Windows·Blob·Discord 스테이징 검증은 계약 fixture 검사와 별도 완료 조건이다.

`DESKTOP_UPLOADER_ENABLED` 기본 false를 구현했다. 기존 웹 URL·DTO는 유지한다.
업로더는 LLVY와 승인된 Blob 주소에 직접 연결한다. Worker와 QStash를 필요로 하지 않는다.
서버 구현 작업과 실환경 검증이 끝나기 전에는 이 정책을 구현 완료로 해석하지 않는다.

## 업로더 역할 확장

`schema.json`의 session role은 `uploader`, `admin`, `owner`를 허용한다. `fixtures.json`은 기존 admin `session`을 보존하고 `uploaderSession`을 추가한다. viewer는 desktop 승인을 받을 수 없다. 엄격한 구버전 앱은 uploader 응답을 거부할 수 있으므로 이를 admin으로 위장하지 않는다.

새 계약 commit 확정 → 앱 고정 사본/source.json/hash 갱신과 Go 검사 → 호환 서버/앱 배포 → 실제 Windows·Discord·Blob 수용 검증 → uploader 권한 활성화 순서다. 현재 앱 고정 revision은 `fe32e8a93a426b0446338d24c201c5b778dab682`이며 LLVY의 별도 `uploader-role-contract` ref와 사본/hash를 대조했다. 이 ref는 2026-10-23 원격에 게시했다. 서버 배포와 실제 앱 릴리스의 확인 범위는 [운영 검증 기록](../../docs/validation/2026-10-23-uploader-deployment.md)을 따른다. 로컬 파서 호환 수정만으로 릴리스 준비 완료로 판단하지 않는다.
