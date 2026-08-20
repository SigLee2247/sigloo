# Sigloo 프로젝트 계약

이 저장소는 Sigloo 제품 코드, Skills, 테스트, evidence와 기술 문서를 함께 관리합니다.

## 기본 검증

```bash
npm run check
npm test
npm run release:preflight
```

## E2E 검증

Browser·Process gate:

```bash
npm run release:gate
```

Desktop gate는 `SIGLOO_DESKTOP_APP`과 `SIGLOO_ELECTRON_PATH`를 지정해 실행합니다. 전체 계약은 [CI release gate 문서](docs/CI-RELEASE-GATE.md)를 참고합니다.

## 보안 경계

- Process Space는 OS 보안 샌드박스가 아닙니다.
- Browser Auth Profile은 명시적으로 만든 owner-only 상태만 사용합니다.
- Desktop Space는 offscreen 실행과 임시 userData를 기본으로 합니다.
- 민감한 환경변수·clipboard·native dialog는 명시적 정책 없이 사용자 환경과 공유하지 않습니다.
