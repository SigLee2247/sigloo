#!/usr/bin/env node

import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

function option(args, name) { const index = args.indexOf(name); return index < 0 ? null : args[index + 1]; }
function bulletRows(values) { return values?.length ? values.map((value) => `- ${value}`).join('\n') : '- none'; }
function render(report) {
  const assertions = report.test?.checks ?? report.test?.assertions ?? [];
  const actions = report.test?.actions ?? report.timeline ?? [];
  const artifacts = report.artifacts?.items ?? report.artifacts ?? [];
  const failure = report.failure ? `- category: ${report.failure.category ?? report.failure.type ?? 'unknown'}\n- step: ${report.failure.step ?? 'unknown'}\n- message: ${report.failure.message ?? report.failure.message_digest ?? 'recorded failure'}` : '- none';
  const summary = `- Assertions: ${assertions.filter((item) => item.passed !== false && item.status !== 'failed').length}/${assertions.length}\n- Actions/events: ${actions.length}\n- Artifacts: ${artifacts.length}`;
  return `# Sigloo E2E Report\n\n## Run\n\n- Status: \`${report.status ?? 'unknown'}\`\n- Driver: \`${report.driver ?? 'unknown'}\`\n- Space: \`${report.space_id ?? 'unknown'}\`\n- Name: \`${report.name ?? 'unknown'}\`\n- Started: \`${report.started_at ?? 'unknown'}\`\n- Finished: \`${report.finished_at ?? 'unknown'}\`\n- Isolation: \`${report.isolation_level ?? 'unknown'}\`\n\n## Summary\n\n${summary}\n\n## Assertions\n\n${bulletRows(assertions.map((item) => `${item.passed === false ? '❌' : '✅'} ${item.name ?? 'unnamed'}`))}\n\n## Actions\n\n${bulletRows(actions.map((item) => `${item.action ?? item.event ?? item.kind ?? 'event'}${item.status ? ` — ${item.status}` : ''}`))}\n\n## Failure\n\n${failure}\n\n## Artifacts\n\n${bulletRows(artifacts.map((item) => `${item.kind ?? item.media_type ?? 'artifact'}: ${item.path ?? item.name ?? 'recorded'}`))}\n\n## Cleanup\n\n- resources_remaining: \`${report.cleanup?.resources_remaining ?? 'unknown'}\`\n- details: \`${JSON.stringify(report.cleanup ?? {})}\`\n\n## Safety\n\nInput values, cookies, storage values, tokens and credentials are intentionally omitted from this report.\n`;
}
const args = process.argv.slice(2); const input = option(args, '--input'); const output = option(args, '--output') ?? `${input}.md`;
if (!input) throw new Error('Usage: render-e2e-report.mjs --input REPORT.json [--output REPORT.md]');
const report = JSON.parse(await readFile(resolve(input), 'utf8'));
await writeFile(resolve(output), render(report), { mode: 0o600 });
process.stdout.write(`${JSON.stringify({ status: 'rendered', input: resolve(input), output: resolve(output) }, null, 2)}\n`);
