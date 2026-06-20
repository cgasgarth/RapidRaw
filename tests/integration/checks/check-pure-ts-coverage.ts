#!/usr/bin/env bun

import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { formatCommandForLog, readBoundedStream, writeBoundedOutput } from '../../../scripts/compact-output.ts';

const minLinePercent = 80;
const minFunctionPercent = 70;
const coverageDir = await mkdtemp(join(tmpdir(), 'rawengine-pure-ts-coverage-'));
const command = [
  'bun',
  'test',
  '--coverage',
  '--coverage-reporter=lcov',
  `--coverage-dir=${coverageDir}`,
  '--reporter=dots',
  'tests/pure-ts',
];

try {
  const proc = Bun.spawn(command, { stderr: 'pipe', stdout: 'pipe' });
  const stdout = readBoundedStream(proc.stdout);
  const stderr = readBoundedStream(proc.stderr);
  const exitCode = await proc.exited;

  if (exitCode !== 0) {
    console.error('pure ts coverage failed');
    console.error(`$ ${formatCommandForLog(command[0], command.slice(1))}`);
    writeBoundedOutput('stdout', await stdout);
    writeBoundedOutput('stderr', await stderr);
    process.exit(exitCode);
  }

  const coverage = parseLcovTotals(await readFile(join(coverageDir, 'lcov.info'), 'utf8'));
  if (coverage.files === 0) {
    throw new Error('No pure TS coverage records found.');
  }

  const linePercent = percent(coverage.linesHit, coverage.linesFound);
  const functionPercent = percent(coverage.functionsHit, coverage.functionsFound);
  const failures: string[] = [];
  if (linePercent < minLinePercent) failures.push(`lines ${linePercent}% < ${minLinePercent}%`);
  if (functionPercent < minFunctionPercent) failures.push(`funcs ${functionPercent}% < ${minFunctionPercent}%`);

  if (failures.length > 0) {
    console.error(`pure ts coverage failed (${failures.join(', ')})`);
    process.exit(1);
  }

  console.log(`pure ts coverage ok (lines=${linePercent}% funcs=${functionPercent}% files=${coverage.files})`);
} finally {
  await rm(coverageDir, { force: true, recursive: true });
}

interface CoverageTotals {
  files: number;
  functionsFound: number;
  functionsHit: number;
  linesFound: number;
  linesHit: number;
}

function parseLcovTotals(lcov: string): CoverageTotals {
  const totals: CoverageTotals = { files: 0, functionsFound: 0, functionsHit: 0, linesFound: 0, linesHit: 0 };
  let currentFile = '';
  let current: Omit<CoverageTotals, 'files'> = { functionsFound: 0, functionsHit: 0, linesFound: 0, linesHit: 0 };

  const flush = () => {
    if (!isPureTsCoverageFile(currentFile)) return;
    totals.files += 1;
    totals.functionsFound += current.functionsFound;
    totals.functionsHit += current.functionsHit;
    totals.linesFound += current.linesFound;
    totals.linesHit += current.linesHit;
  };

  for (const line of lcov.split('\n')) {
    if (line.startsWith('SF:')) {
      currentFile = line.slice(3);
      current = { functionsFound: 0, functionsHit: 0, linesFound: 0, linesHit: 0 };
      continue;
    }
    if (line.startsWith('FNF:')) current.functionsFound = numberAfterColon(line);
    if (line.startsWith('FNH:')) current.functionsHit = numberAfterColon(line);
    if (line.startsWith('LF:')) current.linesFound = numberAfterColon(line);
    if (line.startsWith('LH:')) current.linesHit = numberAfterColon(line);
    if (line === 'end_of_record') flush();
  }

  return totals;
}

function isPureTsCoverageFile(filePath: string): boolean {
  if (!filePath.endsWith('.ts')) return false;
  return (
    filePath.startsWith('packages/rawengine-schema/src/') ||
    filePath.startsWith('src/schemas/') ||
    filePath.startsWith('src/utils/') ||
    filePath.startsWith('src/components/adjustments/') ||
    filePath.startsWith('src/components/panel/right/') ||
    filePath.includes('/packages/rawengine-schema/src/') ||
    filePath.includes('/src/schemas/') ||
    filePath.includes('/src/utils/') ||
    filePath.includes('/src/components/adjustments/') ||
    filePath.includes('/src/components/panel/right/')
  );
}

function numberAfterColon(line: string): number {
  return Number(line.slice(line.indexOf(':') + 1));
}

function percent(hit: number, found: number): number {
  if (found === 0) return 100;
  return Number(((hit / found) * 100).toFixed(2));
}
