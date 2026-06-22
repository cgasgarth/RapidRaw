#!/usr/bin/env bun

import { validateAgentLocalScope } from '../../../src/utils/agentScopeGuardrails.ts';

const selectedRoot = '/Users/cgas/Pictures/Capture One/Alaska';
const sourceRawPath = `${selectedRoot}/DSC_3163.ARW`;

const safe = validateAgentLocalScope({
  outputPath: `${selectedRoot}/RawEngine/DSC_3163-edit.tif`,
  selectedRoot,
  sourceRawPath,
});
if (!safe.ok || !safe.normalizedOutputPath.endsWith('/RawEngine/DSC_3163-edit.tif')) {
  throw new Error('Agent guardrail rejected safe in-scope output.');
}

expectRejects(
  () =>
    validateAgentLocalScope({
      outputPath: sourceRawPath,
      selectedRoot,
      sourceRawPath,
    }),
  'overwrite original',
);

expectRejects(
  () =>
    validateAgentLocalScope({
      outputPath: '/Users/cgas/Pictures/Capture One/Other/export.tif',
      selectedRoot,
      sourceRawPath,
    }),
  'outside selected scope',
);

expectRejects(
  () =>
    validateAgentLocalScope({
      outputPath: `${selectedRoot}/RawEngine/export.tif`,
      overwriteOriginal: true,
      selectedRoot,
      sourceRawPath,
    }),
  'explicit overwrite flag',
);

console.log('agent scope guardrails ok (overwrite+scope fail closed)');

function expectRejects(fn: () => unknown, label: string) {
  try {
    fn();
  } catch {
    return;
  }
  throw new Error(`Expected guardrail rejection for ${label}.`);
}
