# 기여 안내

## 시작하기

```bash
npm run check
npm test
npm run release:preflight
```

기능 변경은 관련 unit test와 실제 driver smoke를 함께 추가합니다. Browser·Desktop 테스트에서는 사용자 profile, cookie, token, password를 사용하거나 기록하지 않습니다.

## Pull Request 기준

- 변경 목적이 하나의 커밋/PR에 명확해야 합니다.
- 테스트 결과와 남은 제한을 설명합니다.
- 공개 저장소에 포함해도 되는 코드·문서·asset인지 확인합니다.
- 제3자 코드와 asset의 license를 확인합니다.
- package publish, release, 외부 서비스 변경은 별도 승인을 받습니다.
