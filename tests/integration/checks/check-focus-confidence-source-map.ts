#!/usr/bin/env bun

import { existsSync } from 'node:fs';

import { buildFocusConfidenceSourceMapReport } from '../../../src/utils/focusConfidenceSourceMap.ts';
import { parseFocusSharpnessMapReport } from '../../../src/schemas/focusSharpnessMapSchemas.ts';
import { parseFocusConfidenceSourceMapReport } from '../../../src/schemas/focusConfidenceSourceMapSchemas.ts';

const REPORT_PATH = 'docs/validation/focus-confidence-source-map-2026-06-20.json';
const SHARPNESS_REPORT_PATH = 'artifacts/focus-sharpness-map/focus-sharpness-map-report.json';
const update = process.argv.includes('--update');

run(['bun', 'tests/integration/checks/check-focus-sharpness-map-smoke.ts']);

const sharpnessReport = parseFocusSharpnessMapReport(await Bun.file(SHARPNESS_REPORT_PATH).json());
const report = buildFocusConfidenceSourceMapReport(sharpnessReport);
const reportJson = `${JSON.stringify(report, null, 2)}\n`;

if (update) {
  await Bun.write(REPORT_PATH, reportJson);
  console.log('focus confidence source map updated');
  process.exit(0);
}

if (!existsSync(REPORT_PATH)) {
  throw new Error(`Missing ${REPORT_PATH}; run bun run check:focus-confidence-source-map:update.`);
}

const existingReport = parseFocusConfidenceSourceMapReport(await Bun.file(REPORT_PATH).json());
if (JSON.stringify(existingReport) !== JSON.stringify(report)) {
  throw new Error(`${REPORT_PATH} is stale; run bun run check:focus-confidence-source-map:update.`);
}

console.log(`focus confidence source map ok (${report.fixtures.length} fixtures)`);

function run(command: string[]): void {
  const result = Bun.spawnSync(command, { stderr: 'pipe', stdout: 'pipe' });
  if (result.exitCode !== 0) {
    console.error(`${command.join(' ')} failed`);
    console.error(
      [new TextDecoder().decode(result.stdout), new TextDecoder().decode(result.stderr)]
        .join('\n')
        .split('\n')
        .slice(-20)
        .join('\n'),
    );
    process.exit(result.exitCode);
  }
}
