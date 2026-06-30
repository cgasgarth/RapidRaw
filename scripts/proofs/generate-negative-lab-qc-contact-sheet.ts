#!/usr/bin/env bun

import { readFileSync, writeFileSync } from 'node:fs';

import { format, resolveConfig } from 'prettier';

import { negativeLabQcProofArtifactV1Schema } from '../../packages/rawengine-schema/src/rawEngineSchemas.ts';
import { sampleNegativeLabQcProofArtifactV1 } from '../../packages/rawengine-schema/src/samplePayloads.ts';

const OUTPUT_HTML_PATH = 'docs/validation/negative-lab-qc-contact-sheet-proof-2026-06-16.html';
const OUTPUT_SVG_PATH = 'docs/validation/negative-lab-qc-contact-sheet-proof-2026-06-16.svg';
const args = new Set(process.argv.slice(2));
const shouldUpdate = args.has('--update');
const proof = negativeLabQcProofArtifactV1Schema.parse(sampleNegativeLabQcProofArtifactV1);
const { height, width } = proof.contactSheet.artifact.dimensions;
const frameWidth = Math.floor(width / proof.contactSheet.columns);
const frameHeight = Math.floor(height / proof.contactSheet.rows);

const escapeXml = (value) =>
  String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');

const overlayColor = (severity) => (severity === 'warning' ? '#b45309' : severity === 'error' ? '#b91c1c' : '#0f766e');

const frameTiles = proof.frameIds
  .map((frameId, index) => {
    const column = index % proof.contactSheet.columns;
    const row = Math.floor(index / proof.contactSheet.columns);
    const x = column * frameWidth;
    const y = row * frameHeight;
    const overlays = proof.overlays.filter((overlay) => overlay.frameId === frameId);
    const positiveVariant = proof.positiveVariants.find((variant) => variant.frameId === frameId);
    const outputHash = positiveVariant?.outputArtifact.contentHash ?? 'missing-output-hash';
    const sourceHash = positiveVariant?.sourceContentHash ?? 'missing-source-hash';

    return `<g data-frame-id="${escapeXml(frameId)}">
      <rect x="${x}" y="${y}" width="${frameWidth}" height="${frameHeight}" rx="18" fill="#101820" />
      <rect x="${x + 26}" y="${y + 26}" width="${frameWidth - 52}" height="${frameHeight - 52}" rx="10" fill="#22313d" />
      <text x="${x + 42}" y="${y + 62}" fill="#f8fafc" font-family="ui-monospace, SFMono-Regular, Menlo, monospace" font-size="30">${escapeXml(frameId)}</text>
      <text x="${x + 42}" y="${y + 104}" fill="#93c5fd" font-family="ui-monospace, SFMono-Regular, Menlo, monospace" font-size="18">source ${escapeXml(sourceHash)}</text>
      <text x="${x + 42}" y="${y + 136}" fill="#86efac" font-family="ui-monospace, SFMono-Regular, Menlo, monospace" font-size="18">positive ${escapeXml(outputHash)}</text>
      ${overlays
        .map((overlay, overlayIndex) => {
          const color = overlayColor(overlay.severity);
          const labelY = y + frameHeight - 118 + overlayIndex * 42;
          return `<rect x="${x + 42}" y="${labelY - 27}" width="${frameWidth - 84}" height="36" rx="8" fill="${color}" opacity="0.16" stroke="${color}" />
      <text x="${x + 58}" y="${labelY}" fill="${color}" font-family="ui-sans-serif, system-ui, sans-serif" font-size="24">${escapeXml(overlay.label)}</text>`;
        })
        .join('\n')}
    </g>`;
  })
  .join('\n');

const warningText =
  proof.warnings.length === 0
    ? 'No warnings'
    : proof.warnings.map((warning) => `${warning.code}: ${warning.evidence}`).join(' | ');

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="title desc">
  <title id="title">Negative Lab QC contact sheet proof</title>
  <desc id="desc">Deterministic contact-sheet proof generated from the Negative Lab QC proof artifact sample.</desc>
  <rect width="${width}" height="${height}" fill="#f8fafc" />
  <text x="36" y="54" fill="#0f172a" font-family="ui-sans-serif, system-ui, sans-serif" font-size="34" font-weight="700">${escapeXml(proof.proofId)}</text>
  <text x="36" y="92" fill="#475569" font-family="ui-monospace, SFMono-Regular, Menlo, monospace" font-size="20">${escapeXml(proof.contactSheet.artifact.contentHash)}</text>
  <g transform="translate(0 130)">
    ${frameTiles}
  </g>
  <text x="36" y="${height - 42}" fill="#475569" font-family="ui-sans-serif, system-ui, sans-serif" font-size="22">${escapeXml(warningText)}</text>
</svg>
`;

const htmlRows = proof.positiveVariants
  .map((variant) => {
    const warnings =
      variant.warnings.length === 0
        ? 'None'
        : variant.warnings.map((warning) => `${warning.code}: ${warning.evidence}`).join('; ');

    return `<tr>
      <td>${escapeXml(variant.frameId)}</td>
      <td>${escapeXml(variant.outputIntent)}</td>
      <td><code>${escapeXml(variant.sourcePath)}</code></td>
      <td><code>${escapeXml(variant.sourceContentHash)}</code></td>
      <td><code>${escapeXml(variant.outputArtifact.contentHash)}</code></td>
      <td>${escapeXml(warnings)}</td>
    </tr>`;
  })
  .join('\n');

const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Negative Lab QC Contact Sheet Proof</title>
    <style>
      body {
        margin: 0;
        background: #f8fafc;
        color: #0f172a;
        font-family:
          Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }
      main {
        margin: 0 auto;
        max-width: 1180px;
        padding: 32px;
      }
      img {
        display: block;
        max-width: 100%;
        border: 1px solid #cbd5e1;
      }
      table {
        width: 100%;
        margin-top: 24px;
        border-collapse: collapse;
        font-size: 14px;
      }
      th,
      td {
        padding: 10px 12px;
        border: 1px solid #cbd5e1;
        text-align: left;
        vertical-align: top;
      }
      th {
        background: #e2e8f0;
      }
      code {
        overflow-wrap: anywhere;
        font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
        font-size: 12px;
      }
      .meta {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
        gap: 12px;
        margin: 20px 0;
      }
      .meta div {
        padding: 12px;
        background: #e2e8f0;
      }
    </style>
  </head>
  <body>
    <main>
      <h1>Negative Lab QC Contact Sheet Proof</h1>
      <div class="meta">
        <div><strong>Proof</strong><br />${escapeXml(proof.proofId)}</div>
        <div><strong>Session</strong><br />${escapeXml(proof.sessionId)}</div>
        <div><strong>Generated</strong><br />${escapeXml(proof.generatedAt)}</div>
        <div><strong>Roll tolerance</strong><br />density ${proof.rollConsistency.densityDeltaTolerance}, exposure ${proof.rollConsistency.exposureDeltaToleranceEv} EV</div>
      </div>
      <img src="./negative-lab-qc-contact-sheet-proof-2026-06-16.svg" alt="Negative Lab QC contact sheet proof" />
      <table>
        <thead>
          <tr>
            <th>Frame</th>
            <th>Intent</th>
            <th>Source</th>
            <th>Source Hash</th>
            <th>Output Hash</th>
            <th>Warnings</th>
          </tr>
        </thead>
        <tbody>
          ${htmlRows}
        </tbody>
      </table>
    </main>
  </body>
</html>
`;

const svgPrettierConfig = (await resolveConfig(OUTPUT_SVG_PATH)) ?? {};
const htmlPrettierConfig = (await resolveConfig(OUTPUT_HTML_PATH)) ?? {};
const formattedSvg = await format(svg, { ...svgPrettierConfig, filepath: OUTPUT_SVG_PATH, parser: 'html' });
const formattedHtml = await format(html, { ...htmlPrettierConfig, filepath: OUTPUT_HTML_PATH, parser: 'html' });

if (shouldUpdate) {
  writeFileSync(OUTPUT_SVG_PATH, formattedSvg);
  writeFileSync(OUTPUT_HTML_PATH, formattedHtml);
  console.log('negative lab qc contact sheet artifacts updated');
  process.exit(0);
}

const currentSvg = readFileSync(OUTPUT_SVG_PATH, 'utf8');
const currentHtml = readFileSync(OUTPUT_HTML_PATH, 'utf8');
if (currentSvg !== formattedSvg || currentHtml !== formattedHtml) {
  throw new Error(
    `Negative Lab QC artifacts are stale. Run bun scripts/proofs/generate-negative-lab-qc-contact-sheet.ts --update`,
  );
}

console.log('negative lab qc contact sheet artifacts ok');
