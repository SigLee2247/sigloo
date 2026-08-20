# Browser Session 계약

## Persistent Session

Persistent Session은 Sigloo가 만든 전용 Browser profile을 유지하는 기능입니다. 사용자 Chrome profile을 재사용하지 않으며, Space 이름/ID로 재접속할 수 있어야 합니다.

## Existing Profile Import

기존 Chrome profile import는 위험한 동작입니다.

- 기본값은 거부
- 사용자 승인 없이는 profile/cookie DB를 읽지 않음
- 승인 시 source digest와 승인 event를 기록
- source를 read-only로 취급하고 복사본만 사용
- 테스트 종료 후 source 변경 여부를 확인
- cookie, password, token 원문은 receipt에 쓰지 않음

## Cross-origin

v1 Auth Profile은 canonical origin을 사용합니다. 여러 origin을 허용하려면 profile manifest에 명시적 origin allowlist와 각 origin별 파생 저장소가 있어야 합니다.
