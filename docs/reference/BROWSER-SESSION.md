# Browser Session 계약

## Persistent Session

Persistent Session은 Sigloo가 만든 전용 Browser profile을 유지하는 기능입니다. 사용자 Chrome profile을 재사용하지 않으며, Space 이름/ID로 재접속할 수 있어야 합니다.

## Existing Profile Import

기존 Chrome profile import는 위험한 동작입니다.

현재 CLI 구현은 Chrome cookie DB를 직접 읽지 않고, owner-only Sigloo Auth Profile JSON을 명시적으로 복사하는 단계까지 지원합니다:

```bash
sigloo auth import account --source ./approved-auth.json --approve --json
```

Chrome user-data 디렉터리에서 직접 추출하는 import는 별도 승인 UI와 OS별 검증이 완료되기 전까지 지원하지 않습니다.

- 기본값은 거부
- 사용자 승인 없이는 profile/cookie DB를 읽지 않음
- 승인 시 source digest와 승인 event를 기록
- source를 read-only로 취급하고 복사본만 사용
- 테스트 종료 후 source 변경 여부를 확인
- cookie, password, token 원문은 receipt에 쓰지 않음

## Cross-origin

v1 Auth Profile은 canonical origin을 사용합니다. 여러 origin을 허용하려면 profile manifest에 명시적 origin allowlist와 각 origin별 파생 저장소가 있어야 합니다.
