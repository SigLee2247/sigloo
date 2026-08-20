#!/usr/bin/env node

import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

function option(args, name) { const index = args.indexOf(name); return index < 0 ? null : args[index + 1]; }
function bullets(values) { return values?.length ? values.map((value) => `- ${value}`).join('\n') : '- 없음'; }
function driverName(driver) { return ({ browser: '브라우저', process: '프로세스', desktop: '데스크톱(Electron)' }[driver] ?? driver ?? '알 수 없음'); }
function purpose(report) {
  if (report.driver === 'browser') return `격리된 BrowserContext에서 ${report.name ?? '브라우저 E2E'}를 실행하고, Auth Profile과 브라우저 상태가 원본과 분리되는지 확인합니다.`;
  if (report.driver === 'process') return `기존 명령 '${report.command?.executable ?? '프로세스'}'를 프로젝트 작업 디렉터리에서 실행하고 로그·artifact·정리를 확인합니다.`;
  if (report.driver === 'desktop') return `화면에 창을 띄우지 않는 offscreen Electron Space에서 앱 renderer, UI 상호작용, IPC 및 종료 정리를 확인합니다.`;
  return 'Sigloo Space 실행 결과를 확인합니다.';
}
function render(report) {
  const assertions = report.test?.checks ?? report.test?.assertions ?? [];
  const actions = report.test?.actions ?? report.timeline ?? [];
  const artifacts = report.artifacts?.items ?? report.artifacts ?? [];
  const passedAssertions = assertions.filter((item) => item.passed !== false && item.status !== 'failed').length;
  const failure = report.failure ? `- 분류: ${report.failure.category ?? report.failure.type ?? '알 수 없음'}\n- 단계: ${report.failure.step ?? '알 수 없음'}\n- 내용: ${report.failure.message ?? report.failure.message_digest ?? '실패 정보가 기록되었습니다.'}` : '- 없음';
  const target = report.driver === 'desktop' ? `- 앱: \`${report.desktop?.app ?? '알 수 없음'}\`\n- renderer: ${report.desktop?.renderer?.targets?.length ?? 0}개` : report.driver === 'browser' ? `- Auth Profile 출처: \`${report.auth_profile?.origin ?? '알 수 없음'}\`` : `- 실행 명령: \`${report.command?.executable ?? '알 수 없음'}\``;
  return `# Sigloo E2E 실행 리포트\n\n## 실행 요약\n\n- 결과: **${report.status === 'passed' ? '통과' : '실패'}** (\`${report.status ?? 'unknown'}\`)\n- 테스트 유형: **${driverName(report.driver)}**\n- Space: \`${report.space_id ?? '알 수 없음'}\`\n- 테스트 이름: \`${report.name ?? '알 수 없음'}\`\n- 시작: \`${report.started_at ?? '알 수 없음'}\`\n- 종료: \`${report.finished_at ?? '알 수 없음'}\`\n- 격리 방식: \`${report.isolation_level ?? '알 수 없음'}\`\n\n## 이 테스트는 무엇을 확인했나\n\n${purpose(report)}\n\n${target}\n\n## 검증 시나리오\n\n${bullets(assertions.map((item) => `${item.passed === false ? '❌ 실패' : '✅ 통과'} — ${item.name ?? '이름 없는 검증'}`))}\n\n## 수행한 동작\n\n${bullets(actions.map((item) => `${item.action ?? item.event ?? item.kind ?? '이벤트'}${item.target ? ` (대상: ${item.target})` : ''}${item.status ? ` — ${item.status}` : ''}`))}\n\n## 결과 수치\n\n- 검증 통과: **${passedAssertions}/${assertions.length}**\n- 동작/이벤트: **${actions.length}개**\n- 첨부 artifact: **${artifacts.length}개**\n\n## 실패 원인\n\n${failure}\n\n## 첨부 artifact\n\n${bullets(artifacts.map((item) => `${item.kind ?? item.media_type ?? 'artifact'}: \`${item.path ?? item.name ?? '기록됨'}\``))}\n\n## 정리 상태\n\n- 남은 리소스: \`${report.cleanup?.resources_remaining ?? '확인 불가'}\`\n- 상세: \`${JSON.stringify(report.cleanup ?? {})}\`\n\n## 보안 메모\n\n입력값, 쿠키, storage 값, 토큰, 비밀번호와 credential 원문은 리포트에 기록하지 않습니다.\n`;
}

const args = process.argv.slice(2); const input = option(args, '--input'); const output = option(args, '--output') ?? `${input}.md`;
if (!input) throw new Error('Usage: render-e2e-report.mjs --input REPORT.json [--output REPORT.md]');
const report = JSON.parse(await readFile(resolve(input), 'utf8'));
await writeFile(resolve(output), render(report), { mode: 0o600 });
process.stdout.write(`${JSON.stringify({ status: 'rendered', input: resolve(input), output: resolve(output) }, null, 2)}\n`);
