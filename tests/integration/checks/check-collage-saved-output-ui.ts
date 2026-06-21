#!/usr/bin/env bun

import { readFileSync } from 'node:fs';

import { getDisplayFileName } from '../../../src/utils/displayFilePath.ts';

const source = readFileSync('src/components/modals/CollageModal.tsx', 'utf8');
const packageJson = readFileSync('package.json', 'utf8');
const locale = JSON.parse(readFileSync('src/i18n/locales/en.json', 'utf8'));

const failures: string[] = [];

for (const [path, expected] of [
  ['/Users/example/Exports/collage-output.png', 'collage-output.png'],
  ['C:\\Users\\example\\Exports\\collage-output.png', 'collage-output.png'],
] as const) {
  const actual = getDisplayFileName(path);
  if (actual !== expected) failures.push(`basename ${path}: expected ${expected}, got ${actual}`);
}

for (const marker of [
  'const path = await onSave(base64Data, firstSourceImage.path)',
  'setSavedPath(path)',
  'const savedOutputName = savedPath ? getDisplayFileName(savedPath) :',
  'if (savedPath)',
  'data-testid="collage-saved-output-detail"',
  'data-saved-output-name={savedOutputName}',
  'title={savedPath}',
  'modals.collage.saved',
  'modals.common.savedOutputLabel',
  'modals.common.savedOutputFullPath',
  'className="sr-only"',
  'aria-hidden="true"',
]) {
  if (!source.includes(marker)) failures.push(`missing CollageModal marker: ${marker}`);
}

for (const key of ['savedOutputFullPath', 'savedOutputLabel']) {
  if (typeof locale.modals?.common?.[key] !== 'string') failures.push(`missing common locale key: ${key}`);
}

if (typeof locale.modals?.collage?.saved !== 'string') failures.push('missing collage saved locale key');

if (!packageJson.includes('"check:collage-saved-output-ui"')) {
  failures.push('missing package script: check:collage-saved-output-ui');
}

if (failures.length > 0) {
  console.error(`collage saved output UI failed: ${failures.join('; ')}`);
  process.exit(1);
}

console.log('collage saved output UI ok');
