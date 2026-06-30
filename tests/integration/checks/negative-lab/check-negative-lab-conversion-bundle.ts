#!/usr/bin/env bun

import { readFile } from 'node:fs/promises';

import { parseNegativeLabConversionBundle } from '../../../../src/schemas/negative-lab/negativeLabConversionBundleSchemas.ts';
import { validateNegativeLabConversionBundleReplay } from '../../../../src/utils/negativeLabConversionBundle.ts';

const bundlePath =
  'src-tauri/target/negative-lab-public-export-proof/110-format-ericht-negative-cc0-320-Positive.jpg.conversion-bundle.json';

const result = Bun.spawnSync(['bun', 'run', 'check:negative-lab-public-export-proof'], {
  stderr: 'pipe',
  stdout: 'pipe',
});

if (!result.success) {
  const output = [new TextDecoder().decode(result.stdout), new TextDecoder().decode(result.stderr)]
    .join('\n')
    .split('\n')
    .filter(Boolean)
    .slice(-30)
    .join('\n');
  throw new Error(`Negative Lab public export proof failed before bundle validation:\n${output}`);
}

const bundle = parseNegativeLabConversionBundle(JSON.parse(await readFile(bundlePath, 'utf8')));
const replay = validateNegativeLabConversionBundleReplay(bundle);

if (bundle.outputs[0]?.sidecarFilename !== '110-format-ericht-negative-cc0-320-Positive.jpg.rrdata') {
  throw new Error('Negative Lab conversion bundle did not reference the generated sidecar.');
}

console.log(`negative lab conversion bundle ok (${replay.outputCount} ${replay.outputFormat})`);
