#!/usr/bin/env bun

import { readFileSync, writeFileSync } from 'node:fs';

import { format, resolveConfig } from 'prettier';

import { sampleRawEngineAgentReplayFixtureV1 } from '../packages/rawengine-schema/src/samplePayloads.ts';
import { rawEngineAgentReplayFixtureV1Schema } from '../packages/rawengine-schema/src/rawEngineSchemas.ts';

const OUTPUT_PATH = 'docs/validation/agent-replay-proof-gallery-2026-06-16.html';
const args = new Set(process.argv.slice(2));
const shouldUpdate = args.has('--update');

const fixture = rawEngineAgentReplayFixtureV1Schema.parse(sampleRawEngineAgentReplayFixtureV1);

const escapeHtml = (value) =>
  String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');

const collectStepOutputArtifacts = (step) =>
  ['previewArtifacts', 'outputArtifacts', 'maskArtifacts']
    .flatMap((key) => {
      const value = step.output[key];
      return Array.isArray(value) ? value.map((artifact) => ({ ...artifact, source: `output.${key}` })) : [];
    })
    .filter((artifact) => typeof artifact.artifactId === 'string');

const outputArtifactsById = new Map(
  fixture.steps.flatMap((step) => collectStepOutputArtifacts(step).map((artifact) => [artifact.artifactId, artifact])),
);

const stepRows = fixture.steps
  .map(
    (step) => `<tr>
      <td><code>${escapeHtml(step.stepId)}</code></td>
      <td>${escapeHtml(step.toolName)}</td>
      <td>${step.dryRun ? 'dry-run' : 'apply'}</td>
      <td>${step.mutates ? 'yes' : 'no'}</td>
      <td>${escapeHtml(step.auditLog.noOverwritePolicy)}</td>
      <td>${step.auditLog.parameterDiff.map((diff) => `<code>${escapeHtml(diff.path)}</code>`).join(', ')}</td>
      <td>${escapeHtml(step.auditLog.rollbackPoint?.graphRevision ?? 'n/a')}</td>
    </tr>`,
  )
  .join('\n');

const artifactRows = fixture.steps
  .flatMap((step) =>
    step.auditLog.affectedArtifactIds.map((artifactId) => {
      const outputArtifact = outputArtifactsById.get(artifactId);
      return {
        artifactId,
        contentHash: outputArtifact?.contentHash ?? 'audit-only',
        source: outputArtifact?.source ?? 'auditLog.affectedArtifactIds',
        stepId: step.stepId,
      };
    }),
  )
  .map(
    (artifact) => `<tr>
      <td><code>${escapeHtml(artifact.stepId)}</code></td>
      <td><code>${escapeHtml(artifact.artifactId)}</code></td>
      <td>${escapeHtml(artifact.source)}</td>
      <td><code>${escapeHtml(artifact.contentHash)}</code></td>
    </tr>`,
  )
  .join('\n');

if (artifactRows.length === 0) {
  throw new Error('Agent proof gallery requires at least one affected artifact row.');
}

if (![...outputArtifactsById.values()].some((artifact) => typeof artifact.contentHash === 'string')) {
  throw new Error('Agent proof gallery requires at least one output artifact content hash.');
}

const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Agent Replay Proof Gallery</title>
    <style>
      :root {
        color-scheme: light;
        --bg: #f5f7f8;
        --ink: #18212f;
        --muted: #596575;
        --panel: #ffffff;
        --line: #d9e0e7;
        --accent: #0f766e;
        --accent-soft: #d9f3ef;
        --blue: #1d4ed8;
        --blue-soft: #dbeafe;
      }

      * {
        box-sizing: border-box;
      }

      body {
        margin: 0;
        background: var(--bg);
        color: var(--ink);
        font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        line-height: 1.5;
      }

      main {
        max-width: 1180px;
        margin: 0 auto;
        padding: 32px 24px 56px;
      }

      h1,
      h2,
      p {
        margin: 0;
      }

      header,
      section {
        margin-bottom: 28px;
      }

      header {
        display: grid;
        gap: 10px;
      }

      h1 {
        font-size: 34px;
        line-height: 1.15;
      }

      h2 {
        font-size: 22px;
        margin-bottom: 12px;
      }

      .muted {
        color: var(--muted);
      }

      .summary {
        display: grid;
        grid-template-columns: repeat(4, minmax(0, 1fr));
        gap: 12px;
      }

      .tile,
      .frame {
        background: var(--panel);
        border: 1px solid var(--line);
        border-radius: 8px;
        padding: 14px;
      }

      .tile strong {
        display: block;
        font-size: 13px;
        color: var(--muted);
        margin-bottom: 6px;
      }

      .frames {
        display: grid;
        grid-template-columns: repeat(4, minmax(0, 1fr));
        gap: 12px;
      }

      .preview {
        aspect-ratio: 4 / 3;
        border: 1px solid var(--line);
        border-radius: 6px;
        background:
          linear-gradient(135deg, rgba(15, 118, 110, 0.18), transparent 52%),
          linear-gradient(45deg, rgba(29, 78, 216, 0.18), transparent 46%),
          #eef3f7;
        display: grid;
        place-items: center;
        margin-bottom: 10px;
      }

      .badge {
        display: inline-flex;
        align-items: center;
        min-height: 24px;
        border-radius: 999px;
        background: var(--accent-soft);
        color: var(--accent);
        padding: 2px 10px;
        font-weight: 700;
        font-size: 12px;
      }

      table {
        width: 100%;
        border-collapse: collapse;
        background: var(--panel);
        border: 1px solid var(--line);
        border-radius: 8px;
        overflow: hidden;
      }

      th,
      td {
        border-bottom: 1px solid var(--line);
        padding: 10px;
        text-align: left;
        vertical-align: top;
        font-size: 13px;
      }

      th {
        background: #edf2f6;
        color: var(--muted);
      }

      code {
        font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
        font-size: 12px;
      }

      @media (max-width: 820px) {
        .summary,
        .frames {
          grid-template-columns: 1fr;
        }
      }
    </style>
  </head>
  <body>
    <main>
      <header>
        <h1>Agent Replay Proof Gallery</h1>
        <p class="muted">Generated from <code>packages/rawengine-schema/samples/agent-replay-fixture-v1.json</code>.</p>
      </header>

      <section class="summary">
        <div class="tile"><strong>Replay</strong><code>${escapeHtml(fixture.replayId)}</code></div>
        <div class="tile"><strong>Initial revision</strong><code>${escapeHtml(fixture.initialGraphRevision)}</code></div>
        <div class="tile"><strong>Final revision</strong><code>${escapeHtml(fixture.finalGraphRevision)}</code></div>
        <div class="tile"><strong>Validation</strong>${escapeHtml(fixture.validationProfile)}</div>
      </section>

      <section>
        <h2>Rendered Fixture Evidence</h2>
        <div class="frames">
          <div class="frame"><div class="preview"><span class="badge">before</span></div><code>${escapeHtml(fixture.initialGraphRevision)}</code></div>
          <div class="frame"><div class="preview"><span class="badge">dry-run</span></div><code>${escapeHtml(fixture.steps[0].output.predictedGraphRevision)}</code></div>
          <div class="frame"><div class="preview"><span class="badge">applied</span></div><code>${escapeHtml(fixture.steps[1].output.appliedGraphRevision)}</code></div>
          <div class="frame"><div class="preview"><span class="badge">rolled back</span></div><code>${escapeHtml(fixture.steps[2].output.appliedGraphRevision)}</code></div>
        </div>
      </section>

      <section>
        <h2>Audit Log Proof</h2>
        <table>
          <thead>
            <tr>
              <th>Step</th>
              <th>Tool</th>
              <th>Mode</th>
              <th>Mutates</th>
              <th>No-overwrite</th>
              <th>Parameter diff</th>
              <th>Rollback point</th>
            </tr>
          </thead>
          <tbody>
            ${stepRows}
          </tbody>
        </table>
      </section>

      <section>
        <h2>Artifact Hash Proof</h2>
        <table>
          <thead>
            <tr>
              <th>Step</th>
              <th>Artifact</th>
              <th>Source</th>
              <th>Content hash</th>
            </tr>
          </thead>
          <tbody>
            ${artifactRows}
          </tbody>
        </table>
      </section>
    </main>
  </body>
</html>
`;

const prettierConfig = (await resolveConfig(OUTPUT_PATH)) ?? {};
const formattedHtml = await format(html, { ...prettierConfig, filepath: OUTPUT_PATH, parser: 'html' });

if (shouldUpdate) {
  writeFileSync(OUTPUT_PATH, formattedHtml);
  console.log('agent proof gallery updated');
  process.exit(0);
}

const current = readFileSync(OUTPUT_PATH, 'utf8');
if (current !== formattedHtml) {
  throw new Error(`${OUTPUT_PATH} is stale. Run bun scripts/generate-agent-proof-gallery.ts --update`);
}

console.log('agent proof gallery ok');
