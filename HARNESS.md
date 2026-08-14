# Sigloo Harness

## 목적

이 저장소는 Sigloo 제품 코드, 기술 결정, 검증 증거와 companion Skill을 함께 버전 관리한다.

## 작업 흐름

1. 시작 전 branch, HEAD, `git status --short`를 확인한다.
2. 초기 부트스트랩 이후 모든 변경은 `<repo-parent>/worktree/sigloo/<task>/sigloo` 형식의 sibling
   worktree에서 수행한다.
3. 기존 사용자 변경을 reset, clean 또는 강제 checkout으로 제거하지 않는다.
4. 구현 전에 관련 제품 계약과 ADR 상태를 확인한다.
5. focused test, 전체 회귀, 설치 검증과 적용 가능한 E2E를 순서대로 수행한다.
6. 실패·생략한 검사를 결과에서 숨기지 않는다.
7. 하나의 커밋은 하나의 목적만 가지며 커밋 메시지는 한글로 작성한다.

## 현재 허용 범위

- stock Chromium 기반 BrowserContext 격리 스파이크
- Auth Profile 시작 상태의 Space별 파생과 역병합 방지 실험
- 명시적 owner-only Auth Profile을 사용하는 same-origin Browser Space E2E
- loopback 전용 읽기 전용 Browser Viewer와 종료 cleanup receipt
- 이름·소유자·TTL을 가진 persistent Space registry와 재접속 CLI
- process lifecycle과 cleanup receipt 실험
- 외부 부작용 없는 로컬 테스트와 증거 작성

## 현재 금지 범위

- 사용자 Chrome profile 또는 cookie DB의 무단 읽기
- 실제 결제·발송·게시·삭제·계정 변경
- credential·token·password 원문 기록
- 승인되지 않은 dependency 설치
- 원격 저장소 생성, push, package publish와 release

## 검증 명령

```bash
npm test
npm run check
node bin/sigloo.mjs browser probe --json
git diff --check
```
