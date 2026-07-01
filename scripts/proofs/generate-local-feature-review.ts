#!/usr/bin/env bun

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, relative } from 'node:path';

import { format, resolveConfig } from 'prettier';

const OUTPUT_PATH = 'docs/validation/reports/local-feature-review-2026-07-01.html';
const REVIEW_DATE = '2026-07-01';
const ISSUE = '#4566';
const args = new Set(process.argv.slice(2));
const shouldUpdate = args.has('--update');

type JsonRecord = Record<string, unknown>;

type FeatureReview = {
  area: string;
  artifacts: string[];
  decision: string;
  evidence: string;
  proofPaths: string[];
  status: 'private-runtime-contract' | 'runtime-proof' | 'ui-proof';
};

const appPackage = JSON.parse(readFileSync('package.json', 'utf8')) as JsonRecord;
const tauriConfig = JSON.parse(readFileSync('src-tauri/tauri.conf.json', 'utf8')) as JsonRecord;

const features: FeatureReview[] = [
  {
    area: 'Selected-image agent preview loop',
    artifacts: [],
    decision:
      'Review the agent flow as a selected-image private RAW contract: dry-run approval, mutating apply turns, preview envelopes, rollback, and no private pixel publication.',
    evidence:
      'The public proof records the acceptance criteria and exact private validation command while withholding Alaska RAW pixels, hashes, and per-file metadata.',
    proofPaths: ['docs/validation/proofs/agent/agent-selected-image-preview-loop-private-raw-2026-06-30.json'],
    status: 'private-runtime-contract',
  },
  {
    area: 'Expert agent handoff',
    artifacts: ['docs/validation/proofs/agent/agent-expert-edit-demo-workflow-2026-06-21.html'],
    decision:
      'Keep the review focused on approved dry-run/apply handoff, audit rows, rollback targets, and before/after proof data instead of a broad agent capability matrix.',
    evidence:
      'Committed HTML and JSON proof artifacts show the expert edit workflow and link it to replay/audit evidence.',
    proofPaths: [
      'docs/validation/proofs/agent/agent-expert-edit-demo-workflow-2026-06-21.json',
      'docs/validation/proofs/agent/agent-app-server-raw-edit-proof-2026-06-20.json',
    ],
    status: 'runtime-proof',
  },
  {
    area: 'Negative Lab workspace',
    artifacts: [
      'docs/validation/proofs/negative-lab/negative-lab-qc-contact-sheet-proof-2026-06-16.svg',
      'docs/validation/proofs/negative-lab/negative-lab-qc-contact-sheet-proof-2026-06-16.html',
      'docs/validation/proofs/negative-lab/negative-lab-agent-workflow-proof-2026-06-16.html',
    ],
    decision:
      'Use deterministic public QC/contact-sheet artifacts and command proof rows for review; do not require private scans to open this page.',
    evidence:
      'The linked SVG renders a committed contact-sheet proof, and the live-preview JSON records a typed command boundary with changed preview hashes.',
    proofPaths: [
      'docs/validation/proofs/negative-lab/negative-lab-live-preview-sample-2026-06-21.json',
      'docs/validation/proofs/negative-lab/negative-lab-public-export-ui-proof-2026-06-20.json',
      'docs/validation/proofs/negative-lab/negative-lab-real-raw-private-proof-2026-06-22.json',
    ],
    status: 'ui-proof',
  },
  {
    area: 'Color and gamut mapping',
    artifacts: [],
    decision:
      'Summarize the public comparison metrics and private artifact boundaries without committing heatmaps or RAW-derived output images.',
    evidence:
      'The gamut-mapping proof records perceptual-vs-relative comparison metrics, caveats, validation commands, and a private heatmap path flagged as not repo-allowed.',
    proofPaths: [
      'docs/validation/proofs/color/gamut-mapping-real-raw-comparison-2026-06-26.json',
      'docs/validation/proofs/color/colorchecker-render-gate-2026-06-20.json',
      'docs/validation/proofs/color/camera-profile-input-transform-proof-2026-06-18.json',
    ],
    status: 'private-runtime-contract',
  },
  {
    area: 'Layers and masks',
    artifacts: [],
    decision:
      'Review visible layer/mask behavior through bounded UI/runtime proofs: stack operations, visibility/opacity, brush capture, and real RAW mask summaries.',
    evidence:
      'The proof set covers stack UI, brush mask canvas output, visibility/opacity behavior, gradient apply slices, and private RAW mask metrics.',
    proofPaths: [
      'docs/validation/proofs/layers-masks/layer-stack-ui-proof-2026-06-20.json',
      'docs/validation/proofs/layers-masks/layer-visibility-opacity-proof-2026-06-21.json',
      'docs/validation/proofs/layers-masks/brush-mask-canvas-ui-proof-2026-06-22.json',
      'docs/validation/proofs/layers-masks/whole-person-mask-runtime-proof-2026-06-27.json',
    ],
    status: 'runtime-proof',
  },
  {
    area: 'Computational workflows',
    artifacts: [],
    decision:
      'Keep HDR, panorama, focus stack, and super-resolution as separate proof links while reviewing them together as current app merge workflows.',
    evidence:
      'The selected proofs cover synthetic output artifacts, app-server/runtime handoff, private RAW contracts, and sidecar provenance where available.',
    proofPaths: [
      'docs/validation/proofs/hdr/hdr-synthetic-output-artifact-proof-2026-06-20.json',
      'docs/validation/proofs/panorama/panorama-real-raw-private-proof-2026-06-20.json',
      'docs/validation/proofs/focus/focus-synthetic-output-artifact-proof-2026-06-20.json',
      'docs/validation/proofs/super-resolution/sr-synthetic-output-artifact-proof-2026-06-20.json',
      'docs/validation/proofs/super-resolution/super-resolution-sidecar-provenance-2026-06-20.json',
    ],
    status: 'runtime-proof',
  },
];

const escapeHtml = (value: unknown) =>
  String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');

const asRecord = (value: unknown): JsonRecord =>
  value !== null && typeof value === 'object' ? (value as JsonRecord) : {};

const readJson = (path: string): JsonRecord => JSON.parse(readFileSync(path, 'utf8')) as JsonRecord;

const outputDir = dirname(OUTPUT_PATH);
const toReportHref = (path: string) => relative(outputDir, path);

const requireExistingPaths = [
  ...features.flatMap((feature) => feature.proofPaths),
  ...features.flatMap((feature) => feature.artifacts),
];

const missingPaths = requireExistingPaths.filter((path) => !existsSync(path));
if (missingPaths.length > 0) {
  throw new Error(`Local feature review references missing artifacts:\n${missingPaths.join('\n')}`);
}

const proofData = new Map(features.flatMap((feature) => feature.proofPaths.map((path) => [path, readJson(path)])));

const getStringArray = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((item) => typeof item === 'string') : [];

const getValidationCommands = (proof: JsonRecord): string[] => {
  const commands = getStringArray(proof.validationCommands);
  if (commands.length > 0) return commands;
  return typeof proof.validationCommand === 'string' ? [proof.validationCommand] : [];
};

const summarizeProof = (path: string) => {
  const proof = proofData.get(path) ?? {};
  const artifacts = asRecord(proof.artifacts);
  const artifactEntries = Object.entries(artifacts)
    .map(([name, artifact]) => {
      const artifactRecord = asRecord(artifact);
      const artifactPath = typeof artifactRecord.path === 'string' ? artifactRecord.path : 'not recorded';
      const publicRepoAllowed =
        typeof artifactRecord.publicRepoAllowed === 'boolean'
          ? String(artifactRecord.publicRepoAllowed)
          : 'not specified';
      return `${name}: ${artifactPath} (publicRepoAllowed: ${publicRepoAllowed})`;
    })
    .slice(0, 3);

  return {
    artifactEntries,
    caveats: getStringArray(proof.caveats ?? proof.doesNotProve).slice(0, 3),
    issue: typeof proof.issue === 'number' ? `#${proof.issue}` : '',
    mode: typeof proof.validationMode === 'string' ? proof.validationMode : '',
    proofStatus: typeof proof.proofStatus === 'string' ? proof.proofStatus : '',
    schemaVersion: typeof proof.schemaVersion === 'number' ? String(proof.schemaVersion) : 'n/a',
    validationCommands: getValidationCommands(proof).slice(0, 2),
  };
};

const statusLabel = {
  'private-runtime-contract': 'Private runtime contract',
  'runtime-proof': 'Runtime proof',
  'ui-proof': 'UI proof',
} satisfies Record<FeatureReview['status'], string>;

const build = asRecord(tauriConfig.build);
const bundle = asRecord(tauriConfig.bundle);
const appMetadata = [
  { label: 'Package manager', value: appPackage.packageManager },
  { label: 'Build command', value: asRecord(appPackage.scripts).build },
  { label: 'Tauri version', value: tauriConfig.version },
  { label: 'Tauri identifier', value: tauriConfig.identifier },
  { label: 'Frontend dist', value: build.frontendDist },
  { label: 'Bundle category', value: bundle.category },
];

const metrics = [
  { label: 'Reviewed feature areas', value: features.length },
  { label: 'Bounded proof files', value: features.reduce((count, feature) => count + feature.proofPaths.length, 0) },
  {
    label: 'Committed visual artifacts',
    value: features.reduce((count, feature) => count + feature.artifacts.length, 0),
  },
];

const artifactCards = features
  .flatMap((feature) =>
    feature.artifacts.map((artifactPath) => {
      const href = toReportHref(artifactPath);
      const image = artifactPath.endsWith('.svg')
        ? `<img src="${escapeHtml(href)}" alt="${escapeHtml(feature.area)} artifact" />`
        : '';
      return `<article class="artifact">
        <h3>${escapeHtml(feature.area)}</h3>
        ${image}
        <a href="${escapeHtml(href)}">${escapeHtml(artifactPath)}</a>
      </article>`;
    }),
  )
  .join('\n');

const featureRows = features
  .map((feature) => {
    const proofRows = feature.proofPaths
      .map((path) => {
        const proof = summarizeProof(path);
        const details = [
          proof.mode && `mode: ${proof.mode}`,
          proof.proofStatus && `status: ${proof.proofStatus}`,
          proof.issue && `issue: ${proof.issue}`,
          `schema: ${proof.schemaVersion}`,
        ].filter(Boolean);
        const privateArtifacts =
          proof.artifactEntries.length > 0
            ? `<ul>${proof.artifactEntries.map((entry) => `<li>${escapeHtml(entry)}</li>`).join('')}</ul>`
            : '<span class="muted">No artifact path list in proof JSON.</span>';
        const caveats =
          proof.caveats.length > 0
            ? `<ul>${proof.caveats.map((caveat) => `<li>${escapeHtml(caveat)}</li>`).join('')}</ul>`
            : '<span class="muted">No caveats recorded.</span>';
        const commands =
          proof.validationCommands.length > 0
            ? `<ul>${proof.validationCommands.map((command) => `<li><code>${escapeHtml(command)}</code></li>`).join('')}</ul>`
            : '<span class="muted">No validation command recorded in this proof.</span>';

        return `<details>
          <summary><a href="${escapeHtml(toReportHref(path))}">${escapeHtml(path)}</a> ${details.length > 0 ? `<span>${escapeHtml(details.join(' | '))}</span>` : ''}</summary>
          <div class="proof-detail">
            <strong>Validation</strong>
            ${commands}
            <strong>Caveats</strong>
            ${caveats}
            <strong>Artifacts</strong>
            ${privateArtifacts}
          </div>
        </details>`;
      })
      .join('\n');

    return `<tr>
      <td>
        <strong>${escapeHtml(feature.area)}</strong>
        <p>${escapeHtml(feature.evidence)}</p>
      </td>
      <td><span class="status ${escapeHtml(feature.status)}">${escapeHtml(statusLabel[feature.status])}</span></td>
      <td>${escapeHtml(feature.decision)}</td>
      <td>${proofRows}</td>
    </tr>`;
  })
  .join('\n');

const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>RapidRAW Local Feature Review</title>
    <style>
      :root {
        color-scheme: light;
        --bg: #f6f7f8;
        --ink: #17202a;
        --muted: #5f6b7a;
        --panel: #ffffff;
        --line: #d8dee6;
        --green: #11695f;
        --green-soft: #dff3ef;
        --blue: #2457a6;
        --blue-soft: #dfeafe;
        --amber: #92540b;
        --amber-soft: #fff1d6;
      }

      * {
        box-sizing: border-box;
      }

      body {
        margin: 0;
        background: var(--bg);
        color: var(--ink);
        font-family:
          Inter,
          ui-sans-serif,
          system-ui,
          -apple-system,
          BlinkMacSystemFont,
          "Segoe UI",
          sans-serif;
        line-height: 1.55;
      }

      main {
        max-width: 1180px;
        margin: 0 auto;
        padding: 32px 24px 56px;
      }

      h1,
      h2,
      h3,
      p {
        margin: 0;
      }

      h1 {
        font-size: 36px;
        line-height: 1.12;
      }

      h2 {
        margin-bottom: 12px;
        font-size: 22px;
      }

      h3 {
        font-size: 16px;
      }

      a {
        color: var(--green);
      }

      header,
      section {
        margin-bottom: 22px;
      }

      header {
        display: grid;
        gap: 12px;
      }

      section,
      .tile,
      .artifact {
        border: 1px solid var(--line);
        border-radius: 8px;
        background: var(--panel);
      }

      section {
        padding: 18px;
      }

      .summary {
        max-width: 860px;
        color: var(--muted);
        font-size: 17px;
      }

      .pills,
      .tiles,
      .artifacts {
        display: grid;
        gap: 12px;
      }

      .pills {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
      }

      .pill {
        border: 1px solid var(--line);
        border-radius: 999px;
        background: var(--panel);
        padding: 5px 10px;
        color: var(--muted);
        font-size: 13px;
      }

      .tiles {
        grid-template-columns: repeat(3, minmax(0, 1fr));
      }

      .tile,
      .artifact {
        padding: 14px;
      }

      .tile span {
        display: block;
        color: var(--muted);
        font-size: 13px;
      }

      .tile strong {
        display: block;
        overflow-wrap: anywhere;
        font-size: 22px;
      }

      table {
        width: 100%;
        border-collapse: collapse;
        font-size: 14px;
      }

      th,
      td {
        border-bottom: 1px solid var(--line);
        padding: 12px 8px;
        text-align: left;
        vertical-align: top;
      }

      th {
        color: var(--muted);
        font-size: 12px;
        text-transform: uppercase;
      }

      tr:last-child td {
        border-bottom: 0;
      }

      td p {
        margin-top: 6px;
        color: var(--muted);
      }

      details {
        margin-bottom: 8px;
      }

      summary {
        cursor: pointer;
      }

      summary span,
      .muted {
        color: var(--muted);
      }

      .proof-detail {
        display: grid;
        gap: 8px;
        margin: 8px 0 12px;
        padding: 10px 12px;
        border-left: 3px solid var(--line);
      }

      .status {
        display: inline-flex;
        border-radius: 999px;
        padding: 4px 8px;
        font-size: 12px;
        font-weight: 700;
        white-space: nowrap;
      }

      .runtime-proof {
        background: var(--green-soft);
        color: var(--green);
      }

      .ui-proof {
        background: var(--blue-soft);
        color: var(--blue);
      }

      .private-runtime-contract {
        background: var(--amber-soft);
        color: var(--amber);
      }

      .artifacts {
        grid-template-columns: repeat(3, minmax(0, 1fr));
      }

      .artifact {
        display: grid;
        gap: 10px;
      }

      .artifact img {
        width: 100%;
        max-height: 300px;
        object-fit: contain;
        border: 1px solid var(--line);
        border-radius: 6px;
        background: #f8fafc;
      }

      code {
        border-radius: 4px;
        background: #eef2f6;
        padding: 1px 5px;
        overflow-wrap: anywhere;
      }

      ul {
        margin: 0;
        padding-left: 20px;
      }

      @media (max-width: 860px) {
        .tiles,
        .artifacts {
          grid-template-columns: 1fr;
        }

        h1 {
          font-size: 30px;
        }
      }
    </style>
  </head>
  <body>
    <main>
      <header>
        <div class="pills">
          <span class="pill">Review date: ${escapeHtml(REVIEW_DATE)}</span>
          <span class="pill">Issue: ${escapeHtml(ISSUE)}</span>
          <span class="pill">Local HTML artifact</span>
          <span class="pill">Private images excluded</span>
        </div>
        <h1>RapidRAW Local Feature Review</h1>
        <p class="summary">
          This page is a bounded human review artifact for recent/current app features. It links known proof files,
          committed visual artifacts, validation commands, app build metadata, and explicit design decisions without
          expanding into a full repository inventory.
        </p>
      </header>

      <section>
        <h2>Current App Build Metadata</h2>
        <div class="tiles">
          ${appMetadata
            .map(
              (item) => `<div class="tile">
                <span>${escapeHtml(item.label)}</span>
                <strong>${escapeHtml(item.value ?? 'n/a')}</strong>
              </div>`,
            )
            .join('\n')}
        </div>
      </section>

      <section>
        <h2>Review Bounds</h2>
        <div class="tiles">
          ${metrics
            .map(
              (item) => `<div class="tile">
                <span>${escapeHtml(item.label)}</span>
                <strong>${escapeHtml(item.value)}</strong>
              </div>`,
            )
            .join('\n')}
        </div>
      </section>

      <section>
        <h2>Feature Evidence</h2>
        <table>
          <thead>
            <tr>
              <th>Feature</th>
              <th>Status</th>
              <th>Review Decision</th>
              <th>Proofs And Validation</th>
            </tr>
          </thead>
          <tbody>
            ${featureRows}
          </tbody>
        </table>
      </section>

      <section>
        <h2>Screenshots And HTML Artifacts</h2>
        <div class="artifacts">
          ${artifactCards}
        </div>
      </section>
    </main>
  </body>
</html>
`;

const prettierConfig = (await resolveConfig(OUTPUT_PATH)) ?? {};
const formattedHtml = await format(html, { ...prettierConfig, filepath: OUTPUT_PATH, parser: 'html' });

if (shouldUpdate) {
  writeFileSync(OUTPUT_PATH, formattedHtml);
  console.log(`local feature review updated: ${OUTPUT_PATH}`);
  process.exit(0);
}

const currentHtml = readFileSync(OUTPUT_PATH, 'utf8');
if (currentHtml !== formattedHtml) {
  throw new Error(`Local feature review is stale. Run bun scripts/proofs/generate-local-feature-review.ts --update`);
}

console.log(`local feature review ok (${features.length} feature areas)`);
