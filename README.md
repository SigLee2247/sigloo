# Sigloo

Sigloo는 AI Agent와 개발자가 브라우저·프로세스·Electron 앱을 사용자 환경과 분리해 E2E 테스트할 수 있도록 하는 로컬 우선 CLI Space Runtime입니다.

핵심 원칙은 간단합니다.

- 테스트마다 독립된 Space를 만든다.
- 기존 테스트 명령은 가능한 그대로 실행한다.
- 브라우저·앱·프로세스의 lifecycle을 Sigloo가 관리한다.
- 로그·스크린샷·trace·assertion·cleanup 결과를 evidence로 남긴다.
- 테스트가 끝나면 남은 리소스가 없는지 확인한다.

현재 버전은 `0.1.0` 로컬 베타입니다. 공개 package publish는 아직 하지 않았습니다.

소스 코드는 [MIT License](LICENSE)로 배포합니다. 포함된 제3자 dependency와 asset은 각자의 license를 따릅니다.

## 현재 지원 범위

| Driver | 용도 | 상태 |
| --- | --- | --- |
| Browser Space | BrowserContext, Auth Profile, 웹 E2E | experimental |
| Process Space | npm, shell, Node, Playwright 등 기존 명령 | prototype |
| Desktop Space | offscreen Electron, renderer, IPC, terminal | experimental |

Sigloo는 Playwright나 다른 테스트 프레임워크를 대체하지 않습니다. 기존 명령을 그대로 실행할 수 있고, 필요할 때 Sigloo 전용 Browser/Desktop API를 사용할 수 있습니다.

## 설치

현재는 로컬 checkout에서 content-addressed release를 설치합니다.

```bash
node scripts/install-local.mjs install
sigloo setup --json
sigloo agent install codex --json
```

설치 기본 경로:

- release/runtime: `~/.local/share/sigloo`
- CLI launcher: `~/.local/bin/sigloo`
- Codex Skill: `~/.codex/skills/`

설치 후 새 터미널과 새 Codex 세션을 시작하면 Skill 탐색이 갱신됩니다.

설치본은 immutable digest로 보관되며, 반복 설치는 atomic/idempotent update로 동작합니다. launcher를 제거하되 release와 사용자 데이터를 보존하려면:

```bash
node scripts/install-local.mjs uninstall
```

이전 release로 되돌리려면:

```bash
node scripts/install-local.mjs rollback \
  --digest <64-character-release-sha256> \
  --install-root ~/.local/share/sigloo \
  --bin-dir ~/.local/bin
```

## 기본 점검

```bash
sigloo --version
sigloo doctor --json
sigloo setup --json
```

`setup`은 이전에 중단된 Sigloo Browser 임시 프로필을 검사하고, 안전하게 회수할 수 있는 항목을 복구합니다.

## 1. Process Space — 기존 명령 그대로 실행

기존 npm, shell, Node, Playwright 명령을 바꾸지 않고 격리된 Space에서 실행합니다.

```bash
sigloo run \
  --name checkout-e2e \
  --evidence-dir .sigloo/evidence \
  -- npm test
```

Playwright도 기존 명령 그대로 실행할 수 있습니다.

```bash
sigloo run \
  --name playwright-e2e \
  -- npx playwright test
```

Playwright 전용 어댑터를 사용하면 명령과 인자를 그대로 유지하면서 Process Space
evidence를 남길 수 있습니다.

```bash
sigloo playwright run --name playwright-e2e -- npx playwright test
```

`--` 뒤의 명령을 생략하면 기본값으로 `npx playwright test`를 실행합니다. 어댑터는
Playwright 설정·reporter·browser lifecycle을 변경하지 않으며, 기존 테스트가 쓰는
`SIGLOO_*` artifact 경로와 종료 코드를 그대로 전달합니다.

자식 프로세스에는 다음 경로가 전달됩니다.

- `SIGLOO_SPACE_ID`
- `SIGLOO_SPACE_DIR`
- `SIGLOO_ARTIFACT_DIR`
- `SIGLOO_LOG_DIR`
- `SIGLOO_TRACE_DIR`
- `SIGLOO_REPORT_DIR`
- `SIGLOO_SCREENSHOT_DIR`

Process Space는 프로젝트 작업 디렉터리를 유지합니다. 따라서 기존 명령은 그대로 실행되지만 프로젝트 파일을 수정할 수 있습니다. VM·container·OS 보안 샌드박스가 아닙니다.

환경변수 정책은 기본 `inherit`입니다. 민감값을 제거하려면 `redact`, 허용 목록만 전달하려면 `allowlist`를 사용합니다.

```bash
SIGLOO_PROCESS_ENV_MODE=redact sigloo run --name safe-check -- npm test
SIGLOO_PROCESS_ENV_MODE=allowlist \
SIGLOO_PROCESS_ENV_ALLOWLIST=PATH,NODE_ENV \
sigloo run --name minimal-check -- npm test
```

## 2. Browser Space — 웹 E2E

### Auth Profile 만들기

로그인 상태는 일반 브라우저 프로필과 섞지 않고 명시적인 Auth Profile로 관리합니다.

```bash
sigloo auth create account --origin https://app.example.test
sigloo auth select account
sigloo auth login account --url https://app.example.test/login
```

`auth login`은 임시 Viewer를 엽니다. 사용자가 `Take control`을 선택해 로그인하고 `Save login`을 눌러야만 상태가 저장됩니다. 비밀번호·cookie·token 원문은 CLI 결과나 evidence에 기록하지 않습니다.

기존 브라우저 user-data 디렉터리를 가져오려면 반드시 경로와 승인을 명시합니다. Sigloo는 원본을 직접 사용하지 않고 관리 디렉터리로 복사합니다.

```bash
sigloo browser session import work \
  --source-dir "$HOME/Library/Application Support/Google/Chrome" \
  --approve --json
```

원본 profile의 동시 사용·OS credential 암호화 상태에 따라 일부 로그인 상태는 재현되지 않을 수 있습니다. 원본을 삭제하거나 역병합하지 않습니다.

### Browser script 실행

```js
export default async function (page) {
  const snapshot = await page.snapshot()

  page.assert(
    'login-page-visible',
    snapshot.elements.some((element) => element.name === '로그인')
  )

  await page.screenshot('login-page')
}
```

```bash
sigloo browser run \
  --name login-smoke \
  --url https://app.example.test \
  --script ./e2e/smoke.mjs \
  --auth-profile ~/.local/share/sigloo/auth/account.json
```

Browser API:

- `snapshot()` — 제한된 Space-local element reference 조회
- `click(ref)` — snapshot reference 클릭
- `fill(ref, value)` — 입력값 기록 없이 입력
- `key(ref, key)` — 키 입력값 기록 없이 전송
- `screenshot(name)` — private artifact 생성
- `assert(name, condition)` — named assertion 기록

Viewer가 필요하면 `--viewer`를 사용합니다. Viewer는 기본 read-only이고 사용자가 명시적으로 takeover해야 입력이 허용됩니다.

## 3. Desktop Space — Electron E2E

Desktop Space는 Electron 앱을 임시 `userData`와 offscreen renderer로 실행합니다. 테스트 창이 사용자의 화면·포커스·clipboard를 방해하지 않도록 하는 것이 기본입니다.

```bash
sigloo desktop run \
  --name sigterm-smoke \
  --app /path/to/sigterm/app \
  --electron-path /path/to/Electron \
  --script ./e2e/sigterm-smoke.mjs
```

예시:

```js
export default async function (desktop) {
  const window = desktop
    .windows()
    .find((item) => item.url.endsWith('index.html'))

  desktop.useWindow(window.id)

  const ready = await desktop.evaluate(
    'document.readyState === "complete"'
  )
  desktop.assert('renderer-ready', ready)

  await desktop.screenshot('main-window')
  desktop.close()
}
```

지원 API:

- `windows()` / `useWindow(id)` — 다중 renderer 선택
- `refreshWindows()` / `waitForWindow({ urlIncludes, timeoutMs })` — popup/modal renderer 대기
- `evaluate(expression)` — renderer DOM/IPC 평가
- `click(selector)` / `clickAt(x, y)` — DOM 또는 좌표 클릭
- `fill(selector, value)` / `type(selector, value)` — 입력
- `key(selector, key)` / `keyChord(keys)` — 키 입력·단축키
- `drag(from, to)` — 좌표 drag
- `setInputFiles(selector, paths)` — native picker 없이 file input 주입
- `handleDialog({ accept, promptText })` — JavaScript dialog 처리
- `menu(id)` — 앱이 제공하는 offscreen native menu bridge 호출
- `reload()` — persistence/restart 검사
- `screenshot(name)` — 화면 artifact
- `close()` — 정상 종료 요청
- `crashRenderer()` — crash cleanup 테스트

Desktop child는 민감 환경변수를 기본 redaction합니다. 명시적 opt-in 없이는 token/password/secret/API key 계열 환경변수를 전달하지 않습니다.

## 4. 테스트 리포트

모든 Space는 JSON evidence와 bounded receipt를 남깁니다. 사람이 읽는 한글 Markdown 리포트로 변환하려면:

```bash
npm run report:render -- \
  --input .sigloo/evidence/SPACE.json \
  --output .sigloo/evidence/SPACE.md
```

리포트에는 다음이 포함됩니다.

- 테스트 제목·목적·대상
- 사전 조건
- 실제 진행 단계
- 성공 기준
- assertion 결과
- 수행 action/event
- 실패 원인
- screenshot·log·trace 경로
- cleanup invariant

입력값·cookie·storage·token·password·credential 원문은 리포트에 기록하지 않습니다.

## 전체 검증

변경 후 기본 검증:

```bash
npm run check
npm test
npm run release:preflight
```

Browser/Process 전체 gate:

```bash
npm run release:gate
```

SigTerm Desktop gate:

```bash
SIGLOO_DESKTOP_APP=/path/to/sigterm/app \
SIGLOO_ELECTRON_PATH=/path/to/Electron \
SIGLOO_DESKTOP_TERMINAL=1 \
SIGLOO_DESKTOP_IPC=1 \
npm run release:gate:desktop
```

통합 gate:

```bash
SIGLOO_DESKTOP_APP=/path/to/sigterm/app \
SIGLOO_ELECTRON_PATH=/path/to/Electron \
SIGLOO_DESKTOP_TERMINAL=1 \
SIGLOO_DESKTOP_IPC=1 \
npm run release:gate:all
```

통합 gate는 Browser 100회 반복, concurrent Space, crash recovery, install lifecycle, Desktop 반복 실행과 cleanup을 확인합니다.

## 내장 Skills

```bash
sigloo agent install codex --json
```

설치되는 Skills:

- `$sigloo` — 공통 Space lifecycle
- `$sigloo-browser` — 웹 Browser E2E
- `$sigloo-desktop` — Electron offscreen E2E
- `$sigloo-process` — 기존 명령 격리 실행
- `$sigloo-release` — gate·리포트·rollback

Skill은 다음과 같은 자연어 요청에도 매핑됩니다.

- “웹사이트 E2E 테스트해줘”
- “Electron 앱을 화면에 띄우지 말고 검사해줘”
- “기존 npm test를 격리 실행해줘”
- “배포 전 전체 gate와 리포트를 만들어줘”

## 프로젝트 경계

Sigloo는 현재 macOS·CLI 중심의 private local beta입니다.

- Desktop driver는 experimental입니다.
- Process Space는 OS 보안 샌드박스가 아닙니다.
- 공개 package publish와 원격 release는 별도 승인 후 진행합니다.
- MCP는 canonical interface가 아니며 CLI가 기본 인터페이스입니다.

브랜딩 자산은 [`docs/branding`](docs/branding)에 있습니다.
