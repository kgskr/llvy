# 요구사항과 변경 기록

- [specs](specs): 현재 구현을 기준으로 정리한 기능·권한·데이터 계약.
- [changes](changes): 아직 완료되지 않은 변경. `tasks.md`의 미완료 항목을 확인한다.
- [changes/archive](changes/archive): 완료된 변경의 당시 제안·설계·검증 이력. 과거 인증 방식, 제공자와 배포 리전은 현재 설정 지침이 아니다.

업로더 권한을 일반 사용자와 관리자 사이로 분리하는 [계획](changes/add-uploader-role/proposal.md), [권한표·설계](changes/add-uploader-role/design.md), [구현 작업 목록](changes/add-uploader-role/tasks.md)이 있다. 로컬 구현과 검증을 진행했으며 계약 원격 공개·실제 브라우저/Windows·Discord/Blob·운영 검증이 남아 있다. 서비스 오너·관리자의 업로더 부여/회수와 웹·Windows 공통 권한을 다룬다.

현재 활성 변경에는 모임원 화면의 실제 브라우저 검증과 업로드 정리·공유 예산의 운영 검증이 남아 있다. 로컬 테스트 완료를 운영 확인으로 간주하지 않는다. 삭제된 날짜별 검증 보고서는 Git 이력에서 확인할 수 있다.

배포·개발 방법은 [사용 문서](../docs/README.md)를 참고한다. 명세 정합성은 `openspec validate --all --strict`로 확인한다.
