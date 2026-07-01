#!/usr/bin/env bun

import { join } from 'node:path';

import {
  findForbiddenProductBundlePath,
  findProductBundleGuardViolation,
  formatProductBundleGuardFailure,
} from '../../../scripts/lib/ci/vite-product-bundle-guard.ts';

const root = '/repo';
const cleanProductPaths = [
  'src/App.tsx',
  'src/schemas/privateRawFormatSchemas.ts',
  'src/utils/agent/session/agentChatTranscriptFixture.ts',
  'packages/rawengine-schema/src/rawEngineSchemas.ts',
];
const forbiddenProductPaths = [
  ['src/validation/browserTauriHarness.mts', 'validation-only frontend module'],
  ['tests/integration/checks/check-vite-bundle-budget.ts', 'test-only module'],
  ['src/components/Button.test.tsx', 'test-only module'],
  ['scripts/proofs/capture-visual-smoke.ts', 'proof-only script module'],
  ['scripts/private-raw/proofs/raw-workflow/run-hdr-real-raw-private-proof.ts', 'private raw proof module'],
  ['scripts/lib/private-raw/root-source.ts', 'private raw proof helper'],
  ['scripts/lib/proofs/visual-smoke/browser-proofs.ts', 'proof-only helper'],
  ['docs/validation/proofs/hdr/hdr-real-raw-private-proof-2026-06-20.json', 'validation evidence artifact'],
  ['fixtures/validation/sample.json', 'validation fixture artifact'],
] as const;

for (const path of cleanProductPaths) {
  const failure = findForbiddenProductBundlePath(join(root, path), root);
  if (failure !== undefined) throw new Error(`Expected ${path} to be allowed, got ${failure.reason}.`);
}

for (const [path, reason] of forbiddenProductPaths) {
  const failure = findForbiddenProductBundlePath(join(root, path), root);
  if (failure?.reason !== reason) throw new Error(`Expected ${path} to fail as ${reason}, got ${failure?.reason}.`);
}

const violation = findProductBundleGuardViolation({
  id: join(root, 'src/validation/browserTauriHarness.mts'),
  importer: join(root, 'src/main.tsx'),
  root,
  source: './validation/browserTauriHarness.mts',
});
const formattedFailure = violation === undefined ? '' : formatProductBundleGuardFailure(violation);
if (!formattedFailure.includes('src/validation/browserTauriHarness.mts')) {
  throw new Error('Guard fixture did not report the forbidden validation import path.');
}
if (!formattedFailure.includes('imported by src/main.tsx')) {
  throw new Error('Guard fixture did not report the importing product module.');
}
if (!formattedFailure.includes('import source "./validation/browserTauriHarness.mts"')) {
  throw new Error('Guard fixture did not report the import source.');
}

console.log('vite product bundle guard ok');
