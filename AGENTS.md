# Sigloo

Sigloo는 AI Agent의 E2E 실행을 사용자 환경과 분리하는 CLI-first Space Runtime이다.

## 작업 전 필수 확인

1. `HARNESS.md`
2. `docs/product/PRODUCT-CONTRACT.md`
3. `docs/adr/INDEX.md`

## 저장소 원칙

- `sigloo` CLI가 canonical 인터페이스다.
- 핵심 Space lifecycle을 특정 외부 제품에 위임하지 않는다.
- 사용자의 기존 브라우저·앱·포커스·입력 상태를 기본적으로 변경하지 않는다.
- credential 원문을 Agent 출력, log와 artifact에 남기지 않는다.
- 기능 구현은 별도 sibling worktree에서 수행한다.
- 기술 선택은 검증 증거와 ADR을 동반한다.
- push, publish, release와 외부 공개는 별도 사용자 승인 전 수행하지 않는다.
