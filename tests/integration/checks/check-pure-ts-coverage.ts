#!/usr/bin/env bun

import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, join, relative } from 'node:path';
import process from 'node:process';

import { formatCommandForLog, readBoundedStream, writeBoundedOutput } from '../../../scripts/lib/compact-output.ts';

type CoverageMetric = {
  found: number;
  hit: number;
};

type FileCoverage = {
  filePath: string;
  functions: CoverageMetric;
  lines: CoverageMetric;
};

type CoverageContract = {
  behaviorArea: string;
  id: string;
  minFunctionPercent: number;
  minLinePercent: number;
  owner: string;
  sourceFiles: readonly string[];
  testFiles: readonly string[];
};

type DomainCoverage = {
  contract: CoverageContract;
  functions: CoverageMetric;
  lines: CoverageMetric;
  sourceCount: number;
};

const coverageContracts = [
  {
    id: 'edit-command-bus',
    owner: 'packages/rawengine-schema edit command bus',
    behaviorArea: 'typed edit command envelopes and command-bus schema dispatch',
    sourceFiles: ['packages/rawengine-schema/src/editCommandBus.ts'],
    testFiles: ['tests/pure-ts/infrastructure/edit-command-bus.test.ts'],
    minLinePercent: 95,
    minFunctionPercent: 50,
  },
  {
    id: 'levels-runtime',
    owner: 'levels schemas/runtime',
    behaviorArea: 'levels payload validation and channel remapping runtime behavior',
    sourceFiles: ['src/schemas/levelsSchemas.ts', 'src/utils/levelsRuntime.ts'],
    testFiles: ['tests/pure-ts/adjustments/levels-runtime.test.ts'],
    minLinePercent: 95,
    minFunctionPercent: 95,
  },
  {
    id: 'library-relink-identity',
    owner: 'library relink schemas/identity',
    behaviorArea: 'library relink identity normalization and schema contracts',
    sourceFiles: ['src/schemas/libraryRelinkSchemas.ts', 'src/utils/libraryRelinkIdentity.ts'],
    testFiles: ['tests/pure-ts/library/library-relink-identity.test.ts'],
    minLinePercent: 95,
    minFunctionPercent: 95,
  },
  {
    id: 'library-auto-stacks',
    owner: 'library auto-stack and HDR bracket preflight',
    behaviorArea: 'auto-stack grouping and HDR bracket detection behavior',
    sourceFiles: [
      'packages/rawengine-schema/src/hdrBracketDetection.ts',
      'src/utils/hdrBracketPreflight.ts',
      'src/utils/libraryAutoStacks.ts',
    ],
    testFiles: ['tests/pure-ts/library/library-auto-stacks.test.ts'],
    minLinePercent: 90,
    minFunctionPercent: 90,
  },
  {
    id: 'negative-lab-scan-metrics',
    owner: 'Negative Lab scan metrics schemas/runtime',
    behaviorArea: 'scan metric parsing, ranges, and warning derivation',
    sourceFiles: ['src/schemas/negativeLabScanMetricsSchemas.ts', 'src/utils/negativeLabScanMetrics.ts'],
    testFiles: ['tests/pure-ts/negative-lab/negative-lab-scan-metrics.test.ts'],
    minLinePercent: 90,
    minFunctionPercent: 80,
  },
  {
    id: 'negative-lab-crosstalk-profile',
    owner: 'Negative Lab crosstalk profile schemas/runtime',
    behaviorArea: 'crosstalk profile validation and coefficient normalization',
    sourceFiles: ['src/schemas/negativeLabCrosstalkProfileSchemas.ts', 'src/utils/negativeLabCrosstalkProfile.ts'],
    testFiles: ['tests/pure-ts/negative-lab/negative-lab-crosstalk-profile.test.ts'],
    minLinePercent: 90,
    minFunctionPercent: 90,
  },
  {
    id: 'negative-lab-auto-density',
    owner: 'Negative Lab auto-density suggestions',
    behaviorArea: 'auto-density suggestion ranking and schema validation',
    sourceFiles: [
      'src/schemas/negativeLabAutoDensitySuggestionSchemas.ts',
      'src/utils/negativeLabAutoDensitySuggestions.ts',
    ],
    testFiles: ['tests/pure-ts/negative-lab/negative-lab-auto-density-suggestions.test.ts'],
    minLinePercent: 85,
    minFunctionPercent: 90,
  },
  {
    id: 'negative-lab-patch-picker',
    owner: 'Negative Lab patch picker',
    behaviorArea: 'neutral patch candidate scoring and picker state transitions',
    sourceFiles: ['src/utils/negativeLabPatchPicker.ts'],
    testFiles: ['tests/pure-ts/negative-lab/negative-lab-patch-picker.test.ts'],
    minLinePercent: 95,
    minFunctionPercent: 95,
  },
  {
    id: 'raw-processing-modes',
    owner: 'raw processing mode utilities',
    behaviorArea: 'raw processing mode labels, defaults, and compatibility mapping',
    sourceFiles: ['src/utils/rawProcessingModes.ts'],
    testFiles: ['tests/pure-ts/adjustments/raw-processing-modes.test.ts'],
    minLinePercent: 95,
    minFunctionPercent: 95,
  },
  {
    id: 'editor-geometry',
    owner: 'editor gesture and preview geometry utilities',
    behaviorArea: 'canvas gesture math, submask geometry, and preview dimensions',
    sourceFiles: [
      'src/utils/editorGestureMath.ts',
      'src/utils/editorPreviewDimensions.ts',
      'src/utils/editorSubMaskFactory.ts',
    ],
    testFiles: [
      'tests/pure-ts/editor/editor-gesture-math.test.ts',
      'tests/pure-ts/editor/editor-preview-dimensions.test.ts',
      'tests/pure-ts/editor/editor-submask-factory.test.ts',
    ],
    minLinePercent: 95,
    minFunctionPercent: 95,
  },
  {
    id: 'library-file-helpers',
    owner: 'library file helper utilities',
    behaviorArea: 'virtual image paths, folder trees, LRU cache behavior, and WGPU payloads',
    sourceFiles: [
      'src/utils/folderTreeUtils.ts',
      'src/utils/ImageLRUCache.ts',
      'src/utils/virtualImagePath.ts',
      'src/utils/wgpuTransformPayload.ts',
    ],
    testFiles: [
      'tests/pure-ts/library/folder-tree-utils.test.ts',
      'tests/pure-ts/library/image-lru-cache.test.ts',
      'tests/pure-ts/library/virtual-image-path.test.ts',
      'tests/pure-ts/editor/wgpu-transform-payload.test.ts',
    ],
    minLinePercent: 95,
    minFunctionPercent: 90,
  },
  {
    id: 'smart-preview-readiness',
    owner: 'smart preview readiness utilities',
    behaviorArea: 'smart-preview export/readiness decisions',
    sourceFiles: ['src/utils/exportSmartPreviewReadiness.ts'],
    testFiles: ['tests/pure-ts/export/export-smart-preview-readiness.test.ts'],
    minLinePercent: 95,
    minFunctionPercent: 95,
  },
  {
    id: 'xmp-metadata-conflicts',
    owner: 'XMP metadata conflict schemas',
    behaviorArea: 'XMP conflict payload schema validation',
    sourceFiles: ['src/schemas/xmpMetadataConflictSchemas.ts'],
    testFiles: ['tests/pure-ts/metadata/xmp-metadata-conflict-schemas.test.ts'],
    minLinePercent: 95,
    minFunctionPercent: 95,
  },
] satisfies readonly CoverageContract[];

const args = process.argv.slice(2);

if (args.includes('--self-test')) {
  runSelfTest();
  process.exit(0);
}

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

  const coverageByFile = parseLcovFileCoverage(await readFile(join(coverageDir, 'lcov.info'), 'utf8'));
  const result = evaluateCoverageContracts(coverageByFile, coverageContracts, collectExistingFiles(coverageContracts));

  if (result.failures.length > 0) {
    console.error('pure ts coverage contracts failed');
    for (const failure of result.failures) console.error(`- ${failure}`);
    process.exit(1);
  }

  const coveredFiles = result.domains.reduce((total, domain) => total + domain.sourceCount, 0);
  console.log(`pure ts coverage contracts ok (${result.domains.length} domains, ${coveredFiles} files)`);
} finally {
  await rm(coverageDir, { force: true, recursive: true });
}

function parseLcovFileCoverage(lcov: string): Map<string, FileCoverage> {
  const coverageByFile = new Map<string, FileCoverage>();
  let current: FileCoverage | null = null;

  const flush = () => {
    if (current === null) return;
    coverageByFile.set(current.filePath, current);
    current = null;
  };

  for (const line of lcov.split('\n')) {
    if (line.startsWith('SF:')) {
      flush();
      current = {
        filePath: normalizeCoveragePath(line.slice(3)),
        functions: { found: 0, hit: 0 },
        lines: { found: 0, hit: 0 },
      };
      continue;
    }
    if (current === null) continue;
    if (line.startsWith('FNF:')) current.functions.found = numberAfterColon(line);
    if (line.startsWith('FNH:')) current.functions.hit = numberAfterColon(line);
    if (line.startsWith('LF:')) current.lines.found = numberAfterColon(line);
    if (line.startsWith('LH:')) current.lines.hit = numberAfterColon(line);
    if (line === 'end_of_record') flush();
  }

  flush();
  return coverageByFile;
}

function evaluateCoverageContracts(
  coverageByFile: ReadonlyMap<string, FileCoverage>,
  contracts: readonly CoverageContract[],
  existingFiles: ReadonlySet<string>,
): { domains: DomainCoverage[]; failures: string[] } {
  const domains: DomainCoverage[] = [];
  const failures: string[] = [];

  for (const contract of contracts) {
    const missingTests = contract.testFiles.filter((filePath) => !existingFiles.has(filePath));
    for (const testFile of missingTests) {
      failures.push(formatContractPrefix(contract) + `missing pure TS behavior test ${testFile}`);
    }

    const missingSources = contract.sourceFiles.filter((filePath) => !existingFiles.has(filePath));
    for (const sourceFile of missingSources) {
      failures.push(formatContractPrefix(contract) + `missing owned source file ${sourceFile}`);
    }

    const missingCoverage = contract.sourceFiles.filter((filePath) => !coverageByFile.has(filePath));
    for (const sourceFile of missingCoverage) {
      failures.push(formatContractPrefix(contract) + `missing LCOV record for owned source file ${sourceFile}`);
    }

    const domain = contract.sourceFiles
      .map((filePath) => coverageByFile.get(filePath))
      .filter((coverage): coverage is FileCoverage => coverage !== undefined)
      .reduce<DomainCoverage>(
        (acc, coverage) => ({
          ...acc,
          functions: addMetric(acc.functions, coverage.functions),
          lines: addMetric(acc.lines, coverage.lines),
          sourceCount: acc.sourceCount + 1,
        }),
        {
          contract,
          functions: { found: 0, hit: 0 },
          lines: { found: 0, hit: 0 },
          sourceCount: 0,
        },
      );

    domains.push(domain);
    if (domain.sourceCount === 0) continue;

    const linePercent = percent(domain.lines);
    const functionPercent = percent(domain.functions);
    if (linePercent < contract.minLinePercent) {
      failures.push(
        formatContractPrefix(contract) +
          `lines ${linePercent}% < ${contract.minLinePercent}% across ${contract.sourceFiles.join(', ')}`,
      );
    }
    if (functionPercent < contract.minFunctionPercent) {
      failures.push(
        formatContractPrefix(contract) +
          `funcs ${functionPercent}% < ${contract.minFunctionPercent}% across ${contract.sourceFiles.join(', ')}`,
      );
    }
  }

  return { domains, failures };
}

function collectExistingFiles(contracts: readonly CoverageContract[]): Set<string> {
  return new Set(
    contracts
      .flatMap((contract) => [...contract.sourceFiles, ...contract.testFiles])
      .filter((filePath) => existsSync(filePath)),
  );
}

function formatContractPrefix(contract: CoverageContract): string {
  return `${contract.id} (${contract.owner}; ${contract.behaviorArea}): `;
}

function normalizeCoveragePath(filePath: string): string {
  const normalized = filePath.replaceAll('\\', '/');
  if (!isAbsolute(normalized)) return normalized;

  const relativePath = relative(process.cwd(), normalized).replaceAll('\\', '/');
  if (!relativePath.startsWith('../')) return relativePath;

  for (const marker of ['/packages/', '/src/']) {
    const markerIndex = normalized.lastIndexOf(marker);
    if (markerIndex !== -1) return normalized.slice(markerIndex + 1);
  }

  return normalized;
}

function addMetric(left: CoverageMetric, right: CoverageMetric): CoverageMetric {
  return {
    found: left.found + right.found,
    hit: left.hit + right.hit,
  };
}

function numberAfterColon(line: string): number {
  return Number(line.slice(line.indexOf(':') + 1));
}

function percent(metric: CoverageMetric): number {
  if (metric.found === 0) return 100;
  return Number(((metric.hit / metric.found) * 100).toFixed(2));
}

function runSelfTest(): void {
  const sampleLcov = [
    'TN:',
    'SF:/repo/src/domain/a.ts',
    'FNF:2',
    'FNH:1',
    'LF:10',
    'LH:8',
    'end_of_record',
    'SF:src/components/panel/right/Incidental.ts',
    'FNF:100',
    'FNH:100',
    'LF:100',
    'LH:100',
    'end_of_record',
  ].join('\n');
  const coverage = parseLcovFileCoverage(sampleLcov);
  const contracts = [
    {
      id: 'sample-domain',
      owner: 'sample owner',
      behaviorArea: 'sample behavior',
      sourceFiles: ['src/domain/a.ts'],
      testFiles: ['tests/pure-ts/sample-domain.test.ts'],
      minLinePercent: 90,
      minFunctionPercent: 75,
    },
  ] satisfies readonly CoverageContract[];

  const failing = evaluateCoverageContracts(
    coverage,
    contracts,
    new Set(['src/domain/a.ts', 'tests/pure-ts/sample-domain.test.ts']),
  );
  if (failing.failures.length !== 2) {
    throw new Error(`pure ts coverage self-test expected two domain failures, got ${failing.failures.length}`);
  }
  if (!failing.failures.every((failure) => failure.includes('sample-domain') && failure.includes('sample behavior'))) {
    throw new Error('pure ts coverage self-test did not preserve domain owner/behavior failure context');
  }

  const passingCoverage = parseLcovFileCoverage(sampleLcov.replace('FNH:1', 'FNH:2').replace('LH:8', 'LH:10'));
  const passing = evaluateCoverageContracts(
    passingCoverage,
    contracts,
    new Set(['src/domain/a.ts', 'tests/pure-ts/sample-domain.test.ts']),
  );
  if (passing.failures.length !== 0 || passing.domains[0]?.sourceCount !== 1) {
    throw new Error('pure ts coverage self-test failed to ignore incidental non-owned LCOV records');
  }

  const missingTest = evaluateCoverageContracts(passingCoverage, contracts, new Set(['src/domain/a.ts']));
  if (!missingTest.failures[0]?.includes('missing pure TS behavior test')) {
    throw new Error('pure ts coverage self-test did not report missing behavior tests');
  }

  console.log('pure ts coverage self-test ok');
}
