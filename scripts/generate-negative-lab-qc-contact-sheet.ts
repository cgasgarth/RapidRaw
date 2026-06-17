#!/usr/bin/env bun

import { readFileSync, writeFileSync } from 'node:fs';

import { format, resolveConfig } from 'prettier';

import { negativeLabQcProofArtifactV1Schema } from '../packages/rawengine-schema/src/rawEngineSchemas.ts';
import { sampleNegativeLabQcProofArtifactV1 } from '../packages/rawengine-schema/src/samplePayloads.ts';

const OUTPUT_PATH = 'docs/validation/negative-lab-qc-contact-sheet-proof-2026-06-16.svg';
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

    return `<g data-frame-id="${escapeXml(frameId)}">
      <rect x="${x}" y="${y}" width="${frameWidth}" height="${frameHeight}" rx="18" fill="#101820" />
      <rect x="${x + 26}" y="${y + 26}" width="${frameWidth - 52}" height="${frameHeight - 52}" rx="10" fill="#22313d" />
      <text x="${x + 42}" y="${y + 62}" fill="#f8fafc" font-family="ui-monospace, SFMono-Regular, Menlo, monospace" font-size="30">${escapeXml(frameId)}</text>
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
    : proof.warnings.map((warning) => `${warning.code}: ${warning.message}`).join(' | ');

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

const prettierConfig = (await resolveConfig(OUTPUT_PATH)) ?? {};
const formattedSvg = await format(svg, { ...prettierConfig, filepath: OUTPUT_PATH, parser: 'html' });

if (shouldUpdate) {
  writeFileSync(OUTPUT_PATH, formattedSvg);
  console.log('negative lab qc contact sheet updated');
  process.exit(0);
}

const current = readFileSync(OUTPUT_PATH, 'utf8');
if (current !== formattedSvg) {
  throw new Error(`${OUTPUT_PATH} is stale. Run bun scripts/generate-negative-lab-qc-contact-sheet.ts --update`);
}

console.log('negative lab qc contact sheet ok');
