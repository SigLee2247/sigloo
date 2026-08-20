# Sigloo 개발 안내

Sigloo는 CLI-first E2E Space Runtime입니다.

## 변경 전 확인

- `README.md`
- `docs/product/PRODUCT-CONTRACT.md`
- 관련 ADR과 테스트

## 개발 원칙

- `sigloo` CLI를 canonical interface로 유지합니다.
- Browser·Process·Desktop lifecycle과 cleanup을 evidence로 검증합니다.
- 사용자 브라우저 프로필·cookie DB·credential 원문을 무단으로 읽지 않습니다.
- 입력값·token·password를 로그나 artifact에 기록하지 않습니다.
- 변경은 focused test와 전체 회귀 테스트를 함께 실행합니다.
- 커밋은 하나의 목적만 담고, 원격 release는 별도 판단으로 진행합니다.
