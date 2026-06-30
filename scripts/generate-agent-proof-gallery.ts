#!/usr/bin/env bun

import { readFileSync, writeFileSync } from 'node:fs';

import { format, resolveConfig } from 'prettier';
import {
  type RawEngineAgentReplayFixtureV1,
  rawEngineAgentReplayFixtureV1Schema,
} from '../packages/rawengine-schema/src/rawEngineSchemas.ts';
import {
  sampleAiEnhancementAgentReplayFixtureV1,
  sampleAiToolAgentReplayFixtureV1,
  sampleRawEngineAgentReplayFixtureV1,
} from '../packages/rawengine-schema/src/samplePayloads.ts';

const OUTPUT_PATH = 'docs/validation/agent-replay-proof-gallery-2026-06-16.html';
const args = new Set(process.argv.slice(2));
const shouldUpdate = args.has('--update');

const replayFixtureInputs: Array<{ fixture: RawEngineAgentReplayFixtureV1; name: string; sourcePath: string }> = [
  {
    fixture: sampleRawEngineAgentReplayFixtureV1,
    name: 'Edit graph rollback',
    sourcePath: 'packages/rawengine-schema/samples/agent-replay-fixture-v1.json',
  },
  {
    fixture: sampleAiToolAgentReplayFixtureV1,
    name: 'AI subject mask',
    sourcePath: 'packages/rawengine-schema/samples/ai-tool-agent-replay-fixture-v1.json',
  },
  {
    fixture: sampleAiEnhancementAgentReplayFixtureV1,
    name: 'AI enhancement',
    sourcePath: 'packages/rawengine-schema/samples/ai-enhancement-agent-replay-fixture-v1.json',
  },
];

const replayFixtures = replayFixtureInputs.map(({ fixture, ...metadata }) => ({
  ...metadata,
  fixture: rawEngineAgentReplayFixtureV1Schema.parse(fixture),
}));

const escapeHtml = (value) =>
  String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');

const collectStepOutputArtifacts = (step) =>
  ['previewArtifacts', 'outputArtifacts', 'maskArtifacts']
    .flatMap((key) => {
      const value = step.output[key];
      return Array.isArray(value) ? value.map((artifact) => ({ ...artifact, source: `output.${key}` })) : [];
    })
    .filter((artifact) => typeof artifact.artifactId === 'string');

const getStepGraphRevision = (step) => {
  if ('predictedGraphRevision' in step.output && typeof step.output.predictedGraphRevision === 'string') {
    return step.output.predictedGraphRevision;
  }

  if ('appliedGraphRevision' in step.output && typeof step.output.appliedGraphRevision === 'string') {
    return step.output.appliedGraphRevision;
  }

  if ('sourceGraphRevision' in step.output && typeof step.output.sourceGraphRevision === 'string') {
    return step.output.sourceGraphRevision;
  }

  return 'n/a';
};

const fixtureCards = replayFixtures
  .map(
    ({ fixture, name, sourcePath }) => `<article class="fixture-card">
      <div>
        <span class="badge">${escapeHtml(name)}</span>
        <h3>${escapeHtml(fixture.replayId)}</h3>
        <p class="muted"><code>${escapeHtml(sourcePath)}</code></p>
      </div>
      <div class="frames compact">
        <div class="frame"><div class="preview"><span class="badge">before</span></div><code>${escapeHtml(fixture.initialGraphRevision)}</code></div>
        ${fixture.steps
          .map(
            (step) =>
              `<div class="frame"><div class="preview"><span class="badge">${escapeHtml(step.dryRun ? 'dry-run' : step.toolKind)}</span></div><code>${escapeHtml(getStepGraphRevision(step))}</code></div>`,
          )
          .join('\n')}
        <div class="frame"><div class="preview"><span class="badge">final</span></div><code>${escapeHtml(fixture.finalGraphRevision)}</code></div>
      </div>
    </article>`,
  )
  .join('\n');

const stepRows = replayFixtures
  .flatMap(({ fixture, name }) =>
    fixture.steps.map(
      (step) => `<tr>
      <td>${escapeHtml(name)}</td>
      <td><code>${escapeHtml(step.stepId)}</code></td>
      <td>${escapeHtml(step.toolName)}</td>
      <td>${step.dryRun ? 'dry-run' : 'apply'}</td>
      <td>${step.mutates ? 'yes' : 'no'}</td>
      <td>${escapeHtml(step.auditLog.noOverwritePolicy)}</td>
      <td>${step.auditLog.parameterDiff.map((diff) => `<code>${escapeHtml(diff.path)}</code>`).join(', ')}</td>
      <td>${escapeHtml(step.auditLog.rollbackPoint?.graphRevision ?? 'n/a')}</td>
    </tr>`,
    ),
  )
  .join('\n');

const artifactRowData = replayFixtures.flatMap(({ fixture, name }) => {
  const outputArtifactsById = new Map(
    fixture.steps.flatMap((step) =>
      collectStepOutputArtifacts(step).map((artifact) => [artifact.artifactId, artifact]),
    ),
  );

  return fixture.steps.flatMap((step) =>
    step.auditLog.affectedArtifactIds.map((artifactId) => {
      const outputArtifact = outputArtifactsById.get(artifactId);
      return {
        artifactId,
        contentHash: outputArtifact?.contentHash ?? 'audit-only',
        fixtureName: name,
        source: outputArtifact?.source ?? 'auditLog.affectedArtifactIds',
        stepId: step.stepId,
      };
    }),
  );
});

const artifactRows = artifactRowData
  .map(
    (artifact) => `<tr>
      <td>${escapeHtml(artifact.fixtureName)}</td>
      <td><code>${escapeHtml(artifact.stepId)}</code></td>
      <td><code>${escapeHtml(artifact.artifactId)}</code></td>
      <td>${escapeHtml(artifact.source)}</td>
      <td><code>${escapeHtml(artifact.contentHash)}</code></td>
    </tr>`,
  )
  .join('\n');

const missingDryRunOrApplyFixture = replayFixtures.find(
  ({ fixture }) => !fixture.steps.some((step) => step.dryRun) || !fixture.steps.some((step) => step.mutates),
);

if (missingDryRunOrApplyFixture !== undefined) {
  throw new Error(`${missingDryRunOrApplyFixture.name} replay fixture must contain dry-run and apply steps.`);
}

if (artifactRowData.length === 0) {
  throw new Error('Agent proof gallery requires at least one affected artifact row.');
}

if (!artifactRowData.some((artifact) => artifact.contentHash.startsWith('sha256:'))) {
  throw new Error('Agent proof gallery requires at least one output artifact content hash.');
}

const totalSteps = replayFixtures.reduce((count, { fixture }) => count + fixture.steps.length, 0);
const totalDryRuns = replayFixtures.reduce(
  (count, { fixture }) => count + fixture.steps.filter((step) => step.dryRun).length,
  0,
);
const totalApplySteps = replayFixtures.reduce(
  (count, { fixture }) => count + fixture.steps.filter((step) => step.mutates).length,
  0,
);
const validationProfiles = [...new Set(replayFixtures.map(({ fixture }) => fixture.validationProfile))].join(', ');

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

      .fixture-card {
        display: grid;
        gap: 14px;
        background: var(--panel);
        border: 1px solid var(--line);
        border-radius: 8px;
        padding: 14px;
      }

      .fixture-card + .fixture-card {
        margin-top: 14px;
      }

      .fixture-card h3 {
        margin: 8px 0 4px;
        font-size: 18px;
      }

      .frames.compact {
        grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
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
        <p class="muted">Generated from all committed agent replay fixtures.</p>
      </header>

      <section class="summary">
        <div class="tile"><strong>Fixtures</strong>${replayFixtures.length}</div>
        <div class="tile"><strong>Replay steps</strong>${totalSteps}</div>
        <div class="tile"><strong>Dry-run/apply</strong>${totalDryRuns} / ${totalApplySteps}</div>
        <div class="tile"><strong>Validation</strong>${escapeHtml(validationProfiles)}</div>
      </section>

      <section>
        <h2>Rendered Fixture Evidence</h2>
        ${fixtureCards}
      </section>

      <section>
        <h2>Audit Log Proof</h2>
        <table>
          <thead>
            <tr>
              <th>Fixture</th>
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
              <th>Fixture</th>
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
