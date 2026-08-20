# 보안 취약점 신고

Sigloo는 Browser·Process·Desktop 테스트를 격리하는 도구이지만, 현재 Process Space는 OS 보안 샌드박스가 아닙니다. 사용자의 프로젝트 파일과 환경을 변경할 수 있는 범위를 이해하고 사용해 주세요.

취약점을 공개 이슈로 등록하지 말고, 저장소 소유자에게 비공개 채널로 재현 절차·영향·완화 방법을 보내 주세요. 공개 신고 채널이 확정되기 전에는 credential·cookie·token·개인정보를 포함하지 마세요.

신고 시 포함할 정보:

- Sigloo 버전과 commit
- macOS/Node/Electron/Chrome 버전
- 실행한 driver와 명령
- 민감값을 제거한 evidence 또는 최소 재현
- 기대 결과와 실제 결과
