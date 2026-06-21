#!/usr/bin/env bun

import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';

import { format, resolveConfig } from 'prettier';
import { z } from 'zod';

const JSON_REPORT_PATH = 'docs/validation/goal-progress-report-2026-06-20.json';
const HTML_REPORT_PATH = 'docs/validation/goal-progress-report-2026-06-20.html';
const GENERATED_AT = '2026-06-20T00:00:00.000Z';
const UPDATE = process.argv.includes('--update');

const artifactSchema = z
  .object({
    exists: z.boolean(),
    label: z.string().trim().min(1),
    path: z.string().trim().min(1),
    status: z.enum(['runtime', 'private-gated', 'synthetic', 'review', 'gap']),
  })
  .strict();

const reportSchema = z
  .object({
    artifacts: z.array(artifactSchema).min(8),
    generatedAt: z.iso.datetime({ offset: true }),
    issue: z.literal(2365),
    openRuntimeIssues: z.array(z.number().int().positive()).min(1),
    schemaVersion: z.literal(1),
    validationCommands: z.array(z.string().trim().min(1)).min(4),
  })
  .strict();

const artifacts = [
  artifact('Goal review page', 'docs/validation/goal-review-2026-06-11.html', 'review'),
  artifact('Goal review screenshot', 'docs/validation/goal-review-screenshot-2026-06-18.png', 'review'),
  artifact(
    'RAW open/edit/export runtime status',
    'docs/validation/raw-open-edit-export-runtime-status-2026-06-18.json',
    'runtime',
  ),
  artifact('Layer mask real RAW proof', 'docs/validation/layer-mask-real-raw-proof-2026-06-18.json', 'private-gated'),
  artifact(
    'Negative Lab real render proof',
    'docs/validation/negative-lab-real-render-proof-2026-06-17.json',
    'runtime',
  ),
  artifact(
    'Negative Lab public export UI proof',
    'docs/validation/negative-lab-public-export-ui-proof-2026-06-20.json',
    'runtime',
  ),
  artifact(
    'Selective color command proof',
    'docs/validation/selective-color-command-proof-2026-06-20.json',
    'synthetic',
  ),
  artifact(
    'Selective color independent proof',
    'docs/validation/selective-color-independent-proof-2026-06-20.json',
    'synthetic',
  ),
  artifact(
    'Selective color private RAW UI proof',
    'docs/validation/selective-color-private-ui-proof-2026-06-20.json',
    'private-gated',
  ),
  artifact('Public fixture manifest', 'docs/validation/public-fixture-manifest.json', 'review'),
] satisfies Array<z.infer<typeof artifactSchema>>;

const report = reportSchema.parse({
  artifacts,
  generatedAt: GENERATED_AT,
  issue: 2365,
  openRuntimeIssues: [1508, 2148, 2308, 2309, 2310, 2311, 2312, 2313, 2314, 2315, 2476],
  schemaVersion: 1,
  validationCommands: [
    'bun run check:goal-progress-report',
    'bun run check:goal-review-data',
    'bun run check:goal-review-page',
    'bun run check:goal-review-screenshot',
  ],
});

const prettierConfig = (await resolveConfig('package.json')) ?? {};
const jsonText = await format(JSON.stringify(report), { ...prettierConfig, parser: 'json' });
const htmlText = await format(renderHtml(report), { ...prettierConfig, parser: 'html' });

if (UPDATE) {
  await writeFile(JSON_REPORT_PATH, jsonText);
  await writeFile(HTML_REPORT_PATH, htmlText);
} else {
  await assertFresh(JSON_REPORT_PATH, jsonText);
  await assertFresh(HTML_REPORT_PATH, htmlText);
}

console.log(`goal progress report ok (${report.artifacts.length} artifacts)`);

function artifact(
  label: string,
  path: string,
  status: z.infer<typeof artifactSchema>['status'],
): z.infer<typeof artifactSchema> {
  return { exists: existsSync(path), label, path, status };
}

async function assertFresh(path: string, expected: string): Promise<void> {
  const actual = await readFile(path, 'utf8');
  if (actual !== expected) {
    throw new Error(`${path} is stale; run bun run check:goal-progress-report:update.`);
  }
}

function renderHtml(data: z.infer<typeof reportSchema>): string {
  const artifactRows = data.artifacts
    .map(
      (entry) => `<tr>
        <td>${escapeHtml(entry.label)}</td>
        <td>${escapeHtml(entry.status)}</td>
        <td>${entry.exists ? 'present' : 'missing'}</td>
        <td><code>${escapeHtml(entry.path)}</code></td>
      </tr>`,
    )
    .join('\n');
  const commands = data.validationCommands.map((command) => `<li><code>${escapeHtml(command)}</code></li>`).join('\n');
  const gaps = data.openRuntimeIssues
    .map((issue) => `<li><a href="https://github.com/cgasgarth/RapidRaw/issues/${issue}">#${issue}</a></li>`)
    .join('\n');

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>RawEngine Goal Progress Report</title>
    <style>
      body { margin: 0; font: 15px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: #18212f; background: #f5f7fa; }
      main { max-width: 1080px; margin: 0 auto; padding: 32px 24px 48px; }
      h1 { margin: 0 0 8px; font-size: 32px; }
      h2 { margin: 28px 0 12px; font-size: 21px; }
      .summary { display: grid; grid-template-columns: repeat(1, minmax(0, 1fr)); gap: 12px; margin-top: 20px; }
      .metric, table { border: 1px solid #d8dee8; background: #fff; border-radius: 8px; }
      .metric { padding: 14px; }
      .metric strong { display: block; font-size: 24px; }
      table { width: 100%; border-collapse: collapse; overflow: hidden; }
      th, td { padding: 10px 12px; border-bottom: 1px solid #e6eaf0; text-align: left; vertical-align: top; }
      th { background: #edf2f7; }
      code { font-size: 13px; }
      a { color: #0f766e; }
    </style>
  </head>
  <body>
    <main>
      <h1>RawEngine Goal Progress Report</h1>
      <p>Generated ${escapeHtml(data.generatedAt)}. This report is a local review index, not runtime feature completion proof.</p>
      <section class="summary">
        <div class="metric"><span>Tracked artifacts</span><strong>${data.artifacts.length}</strong></div>
      </section>
      <h2>Artifacts</h2>
      <table>
        <thead><tr><th>Artifact</th><th>Status</th><th>File</th><th>Path</th></tr></thead>
        <tbody>${artifactRows}</tbody>
      </table>
      <h2>Open Runtime Gaps</h2>
      <ul>${gaps}</ul>
      <h2>Validation</h2>
      <ul>${commands}</ul>
    </main>
  </body>
</html>
`;
}

function escapeHtml(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
}
