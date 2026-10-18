# 데스크톱 API 계약 관리

상태: desktop-v1 후보 계약과 서버 구현이 있다. 실제 Blob PUT·Discord·Windows 검증 전이며 릴리스 계약으로 확정하지 않았다.

- [프로토콜·경로·헤더 정책](protocol.json)
- [JSON 스키마](schema.json)
- [비밀 없는 fixture](fixtures.json)

전송 헤더는 설치된 `@vercel/blob` 2.5.0 소스와 타입에 맞춘 후보이다. public/private 실제 PUT, 변조·만료·overwrite 검증 후 확정한다. 제품 origin은 `https://llvy.my`다.
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
