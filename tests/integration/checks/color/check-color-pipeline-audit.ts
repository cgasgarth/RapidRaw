#!/usr/bin/env bun

import { access, readFile } from 'node:fs/promises';

const DOC_PATH = 'docs/color/architecture/current-color-pipeline-audit-2026-06-15.md';

const REQUIRED_SOURCE_PATHS = [
  'src-tauri/src/raw_processing.rs',
  'src-tauri/src/image_loader.rs',
  'src-tauri/src/image_processing.rs',
  'src-tauri/src/gpu_processing.rs',
  'src-tauri/src/export_processing.rs',
  'src-tauri/src/shaders/shader.wgsl',
  'src/utils/adjustments.ts',
  'src/components/adjustments/Color.tsx',
];

const REQUIRED_PHRASES = [
  'Runtime status: audit-only.',
  'does not change preview pixels',
  'Gamut mapping is not runtime-applied',
  'Preview and export share',
  'Required Follow-Up Order',
];

const failures = [];

const doc = await readFile(DOC_PATH, 'utf8');

for (const sourcePath of REQUIRED_SOURCE_PATHS) {
  try {
    await access(sourcePath);
  } catch {
    failures.push(`Missing audited source path: ${sourcePath}`);
  }

  if (!doc.includes(sourcePath)) {
    failures.push(`Audit doc does not cite ${sourcePath}`);
  }
}

for (const phrase of REQUIRED_PHRASES) {
  if (!doc.includes(phrase)) failures.push(`Audit doc missing phrase: ${phrase}`);
}

if (failures.length > 0) {
  console.error('Color pipeline audit check failed:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log('Color pipeline audit doc ok.');
