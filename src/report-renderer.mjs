import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export async function writeRunReports(report, evidenceRoot, evidencePath = join(evidenceRoot, `${report.space_id}.json`)) {
  await mkdir(evidenceRoot, { recursive: true });
  await writeFile(evidencePath, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  const markdownPath = join(evidenceRoot, `${report.space_id}.md`);
  const cleanup = report.cleanup ?? {};
  const artifacts = report.artifacts?.items ?? report.artifacts ?? [];
  const artifactLines = Array.isArray(artifacts) && artifacts.length ? artifacts.map((item) => `- ${item.path ?? item.name ?? String(item)}`).join('\n') : '- 없음';
  const markdown = [`# ${report.name ?? report.space_id} 실행 리포트`, '', `- 상태: **${report.status === 'passed' ? '통과' : '실패'}**`, `- 실행 공간: \`${report.space_id}\``, `- 드라이버: ${report.driver ?? 'unknown'}`, `- 시작: ${report.started_at ?? '-'}`, `- 종료: ${report.finished_at ?? '-'}`, '', '## 실행 요약', '', report.test?.purpose ?? '실행 결과와 격리 상태를 기록합니다.', '', '## 정리 상태', '', `- 남은 리소스: **${cleanup.resources_remaining ? '있음' : '없음'}**`, '', '## 산출물', '', artifactLines, '', report.failure ? `## 실패 정보\n\n- 단계: ${report.failure.step ?? '-'}\n- 유형: ${report.failure.category ?? report.failure.type ?? '-'}` : '## 실패 정보\n\n- 없음', '', `원본 evidence: [${report.space_id}.json](./${report.space_id}.json)`, ''].join('\n');
  await writeFile(markdownPath, markdown, { mode: 0o600 });
  return { evidencePath, markdownPath };
}
