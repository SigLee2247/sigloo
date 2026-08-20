# ADR-SIGLOO-013 Persistent Browser Session과 승인 기반 Profile Import

- 상태: proposed
- 범위: Browser Space

## 결정

Sigloo의 persistent Browser Session과 기존 브라우저 profile import는 서로 다른 기능으로 취급한다.

1. Persistent Session은 Sigloo가 새로 만든 owner-only profile을 유지하고, Space lifecycle로 종료·회수한다.
2. 기존 브라우저 profile import는 기본 거부한다.
3. import는 별도 명령과 명시적 사용자 승인 없이는 실행하지 않는다.
4. import가 승인되어도 원본 profile을 직접 사용하지 않고, 읽기 전용 복사본에서 Space별 파생 상태를 만든다.
5. 테스트 중 변경은 imported source나 사용자의 일반 브라우저 profile로 역병합하지 않는다.
6. cross-origin 상태는 origin별 저장 경계와 명시적 허용 목록을 가진 경우에만 지원한다.

## 완료 기준

- persistent Session을 다른 CLI process에서 reconnect할 수 있다.
- 브라우저/Chrome 종료와 TTL 만료가 profile·process·artifact를 정리한다.
- import 전후 원본 digest가 동일하다.
- 승인 없는 import 요청은 실행되지 않고 audit receipt를 남긴다.
- 각 origin과 Space의 storage 상태가 분리된다.
