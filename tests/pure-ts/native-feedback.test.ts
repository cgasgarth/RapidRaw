import { describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { compareNativeFeedbackReceipts, runNativeFeedbackBenchmark } from '../../scripts/native-feedback/benchmark';
import { cargoArtifactBytes, parseCargoTimingReport, peakRssBytes } from '../../scripts/native-feedback/cargo-timing';
import {
  type NativeFeedbackProfile,
  type NativeFeedbackSample,
  nativeFeedbackProfiles,
} from '../../scripts/native-feedback/model';
import { createNativeCiPartitionPlan } from '../../scripts/native-feedback/planner';
import { writeNativeFeedbackReceipt } from '../../scripts/native-feedback/receipt-io';
import { createNativeFeedbackRunGuard } from '../../scripts/native-feedback/run-guard';
import { selectNativeFeedbackCargoArguments } from '../../scripts/native-feedback/runtime';
import { selectNativeFeedbackWorkflow } from '../../scripts/native-feedback/workflow-selection';

const baselineProfile = nativeFeedbackProfiles[0] as NativeFeedbackProfile;
const fast = nativeFeedbackProfiles[1] as NativeFeedbackProfile;
const identity = {
  gitCommit: 'a'.repeat(40),
  dirtyDigest: 'b'.repeat(64),
  cargoLockDigest: 'c'.repeat(64),
  workspaceManifestDigest: 'd'.repeat(64),
  rustc: 'rustc 1.95.0',
  cargo: 'cargo 1.95.0',
  hardwareClass: 'test-hardware',
};
const plannerIdentity = {
  cargoLockDigest: identity.cargoLockDigest,
  workspaceManifestDigest: identity.workspaceManifestDigest,
  sourceDigest: 'e'.repeat(64),
  rustc: identity.rustc,
  environment: 'darwin-arm64',
};

describe('native feedback CI partition planner', () => {
  test('skips native work for unrelated commit changes', () => {
    expect(
      createNativeCiPartitionPlan({
        mode: 'commit',
        changedPaths: ['docs/readme.md'],
        profile: fast,
        identity: plannerIdentity,
      }).nodes,
    ).toEqual([]);
  });

  test('selects a focused workspace leaf before the immutable full PR closure', () => {
    const plan = createNativeCiPartitionPlan({
      mode: 'pr',
      changedPaths: ['src-tauri/crates/rapidraw-types/src/lib.rs'],
      profile: fast,
      identity: plannerIdentity,
    });
    expect(plan.nodes.map(({ id }) => id)).toEqual(['native-leaf:rapidraw-types', 'native-full:required']);
    expect(plan.nodes[0]).toMatchObject({ cwd: 'src-tauri', required: false, cachePolicy: 'local-ci' });
    expect(plan.nodes[1]).toMatchObject({
      required: true,
      cachePolicy: 'none',
      dependencies: ['native-leaf:rapidraw-types'],
    });
    expect(plan.integrations).toEqual({
      affectedValidation: {
        schemaVersion: 1,
        kind: 'validation-nodes',
        nodeIds: ['native-leaf:rapidraw-types', 'native-full:required'],
      },
      performanceArtifacts: {
        schemaVersion: 1,
        kind: 'performance-artifact-inputs',
        producerIds: ['native-feedback:native-leaf:rapidraw-types'],
      },
    });
  });

  test('routes core and mixed changes with deterministic dependency order', () => {
    const plan = createNativeCiPartitionPlan({
      mode: 'pr',
      changedPaths: ['src-tauri/src/lib.rs', 'src-tauri/crates/rapidraw-codecs/src/lib.rs'],
      profile: fast,
      identity: plannerIdentity,
    });
    expect(plan.nodes.map(({ id }) => id)).toEqual([
      'native-leaf:rapidraw-codecs',
      'native-core:rapidraw-lib',
      'native-full:required',
    ]);
    expect(plan.nodes[1]?.dependencies).toEqual(['native-leaf:rapidraw-codecs']);
    expect(plan.nodes[2]?.dependencies).toEqual(['native-leaf:rapidraw-codecs', 'native-core:rapidraw-lib']);
  });

  test('cache identity changes with source/tool inputs while full validation remains uncached', () => {
    const input = { mode: 'push' as const, changedPaths: ['src-tauri/src/lib.rs'], profile: fast };
    const first = createNativeCiPartitionPlan({ ...input, identity: plannerIdentity });
    const second = createNativeCiPartitionPlan({
      ...input,
      identity: { ...plannerIdentity, sourceDigest: 'f'.repeat(64) },
    });
    expect(first.nodes[0]?.cacheKey).not.toBe(second.nodes[0]?.cacheKey);
    const full = createNativeCiPartitionPlan({
      mode: 'full',
      changedPaths: [],
      profile: fast,
      identity: plannerIdentity,
    });
    expect(full.nodes).toHaveLength(1);
    expect(full.nodes[0]).toMatchObject({ id: 'native-full:required', required: true, cachePolicy: 'none' });
  });
});

describe('native feedback GitHub Actions selection', () => {
  test('routes leaf-only changes to focused and full gates without core work', () => {
    expect(
      selectNativeFeedbackWorkflow([
        'src-tauri/crates/rapidraw-types/src/lib.rs',
        'src-tauri/crates/rapidraw-codecs/src/lib.rs',
      ]),
    ).toEqual({
      coreRequired: false,
      fullRequired: true,
      leafCrates: ['rapidraw-codecs', 'rapidraw-types'],
      reason: 'workspace leaf input changed',
    });
  });

  test('routes root changes to core and full gates and fails closed on missing paths', () => {
    expect(selectNativeFeedbackWorkflow(['src-tauri/src/lib.rs'])).toMatchObject({
      coreRequired: true,
      fullRequired: true,
      leafCrates: [],
    });
    expect(selectNativeFeedbackWorkflow([])).toEqual({
      coreRequired: true,
      fullRequired: true,
      leafCrates: [],
      reason: 'empty change set; fail closed',
    });
  });

  test('skips focused jobs for unrelated paths but preserves the full PR closure', () => {
    expect(selectNativeFeedbackWorkflow(['docs/development/native-feedback.md'])).toEqual({
      coreRequired: false,
      fullRequired: true,
      leafCrates: [],
      reason: 'full PR closure only',
    });
  });
});

const executor = (timeToTestMs: number, calls: string[] = []) => ({
  async run(input: { scenario: NativeFeedbackSample['scenario']; iteration: number }): Promise<NativeFeedbackSample> {
    calls.push(`${input.scenario}:${input.iteration}`);
    return {
      scenario: input.scenario,
      iteration: input.iteration,
      wallMs: timeToTestMs + 100,
      criticalPathMs: timeToTestMs - 100,
      rebuiltCrates: input.scenario === 'noop' ? 0 : 2,
      linkMs: 100,
      peakRssBytes: 512 * 1024 * 1024,
      artifactBytes: 32 * 1024 * 1024,
      timeToTestMs,
      status: 'valid',
      measurement: {
        kind: 'cargo-runtime',
        command: ['cargo', 'test'],
        timingReportDigest: '1'.repeat(64),
        exitCode: 0,
      },
    };
  },
});

describe('native feedback runtime metric extraction', () => {
  test('candidate routes clean/root and common feedback through the focused target', () => {
    const root = ['cargo', 'test', 'root'];
    const focused = ['cargo', 'test', 'leaf'];
    expect(
      ['clean', 'noop', 'leaf-edit', 'core-edit'].map((scenario) =>
        selectNativeFeedbackCargoArguments({
          scenario: scenario as 'clean' | 'noop' | 'leaf-edit' | 'core-edit',
          cargoArguments: root,
          focusedCargoArguments: focused,
        }),
      ),
    ).toEqual([root, focused, focused, root]);
  });

  test('derives critical path, dirty units, link time, artifact bytes, and RSS from runtime outputs', async () => {
    const report = `<td>Dirty units:</td><td>2</td>\n<script>\nconst UNIT_DATA = [\n{"i":0,"duration":1.5,"unblocked_units":[1],"sections":[["link",{"start":1,"end":1.4}]]},\n{"i":1,"duration":2,"unblocked_units":[],"sections":null}\n];\n</script>`;
    expect(parseCargoTimingReport(report)).toMatchObject({
      rebuiltCrates: 2,
      criticalPathMs: 3_500,
      linkMs: 400,
    });
    expect(peakRssBytes('  123456 maximum resident set size')).toBe(123_456);
    const fixture = import.meta.path;
    expect(
      await cargoArtifactBytes(JSON.stringify({ reason: 'compiler-artifact', filenames: [fixture, fixture] })),
    ).toBeGreaterThan(0);
  });

  test('restores interrupted edits and removes the incomplete target cache', async () => {
    const root = await mkdtemp(join(tmpdir(), 'rapidraw-native-feedback-'));
    const source = join(root, 'lib.rs');
    const target = join(root, 'target');
    await writeFile(source, 'pub fn stable() {}\n');
    await mkdir(target);
    await writeFile(join(target, 'partial.rmeta'), 'partial');
    const guard = await createNativeFeedbackRunGuard({ targetDir: target, sourcePaths: [source] });
    try {
      await guard.mutate(source, 'core-edit', 2);
      expect(await readFile(source, 'utf8')).toContain('native-feedback core-edit 2');
      await guard.restoreSources();
      await guard.invalidateTarget();
      expect(await readFile(source, 'utf8')).toBe('pub fn stable() {}\n');
      expect(await Bun.file(join(target, 'partial.rmeta')).exists()).toBe(false);
      expect((await readdir(root)).some((name) => name.includes('.interrupted-'))).toBe(false);
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  test('publishes receipts atomically without leaving candidate files', async () => {
    const root = await mkdtemp(join(tmpdir(), 'rapidraw-native-receipt-'));
    const output = join(root, 'receipt.json');
    try {
      await writeNativeFeedbackReceipt(output, { status: 'pass', samples: 12 });
      expect(JSON.parse(await readFile(output, 'utf8'))).toEqual({ status: 'pass', samples: 12 });
      expect(await readdir(root)).toEqual(['receipt.json']);
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  test('synchronous signal cleanup restores edits and quarantines an incomplete target', async () => {
    const root = await mkdtemp(join(tmpdir(), 'rapidraw-native-feedback-signal-'));
    const source = join(root, 'lib.rs');
    const target = join(root, 'target');
    await writeFile(source, 'pub fn stable() {}\n');
    await mkdir(target);
    const guard = await createNativeFeedbackRunGuard({ targetDir: target, sourcePaths: [source] });
    try {
      await guard.mutate(source, 'core-edit', 1);
      guard.restoreSourcesSync();
      guard.invalidateTargetSync();
      expect(await readFile(source, 'utf8')).toBe('pub fn stable() {}\n');
      expect(await Bun.file(target).exists()).toBe(false);
      expect((await readdir(root)).some((name) => name.includes('.interrupted-'))).toBe(false);
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });
});

const run = (timeToTestMs: number, calls: string[] = []) =>
  runNativeFeedbackBenchmark({
    profile: fast,
    executor: executor(timeToTestMs, calls),
    identity,
    warmupRuns: 1,
    measuredRuns: 3,
    startedAt: '2026-01-01T00:00:00.000Z',
    validationCacheKey: 'f'.repeat(64),
    rerunCommand: "'bun' 'native-feedback' 'benchmark' '--profile' 'rapid-dev-fast'",
  });

const runBaseline = (timeToTestMs: number) =>
  runNativeFeedbackBenchmark({
    profile: baselineProfile,
    executor: executor(timeToTestMs),
    identity,
    warmupRuns: 1,
    measuredRuns: 3,
    startedAt: '2026-01-01T00:00:00.000Z',
    validationCacheKey: 'e'.repeat(64),
    rerunCommand: "'bun' 'native-feedback' 'measure' '--profile' 'dev-baseline'",
  });

describe('native feedback benchmark receipts', () => {
  test('interleaves scenarios, excludes warmups, and retains all native feedback metrics', async () => {
    const calls: string[] = [];
    const receipt = await run(10_000, calls);
    expect(calls.slice(0, 8)).toEqual([
      'clean:0',
      'noop:0',
      'leaf-edit:0',
      'core-edit:0',
      'clean:1',
      'noop:1',
      'leaf-edit:1',
      'core-edit:1',
    ]);
    expect(receipt.samples).toHaveLength(12);
    expect(receipt.samples.every(({ iteration }) => iteration >= 0 && iteration < 3)).toBe(true);
    expect(receipt.summary['leaf-edit'].timeToTestMs).toEqual({ median: 10_000, p95: 10_000, samples: 3 });
    expect(receipt.integrations).toMatchObject({
      performanceArtifact: {
        kind: 'performance-run-adapter',
        scenarioId: 'native.feedback.rapid-dev-fast',
        rawSampleCount: 12,
        metricNames: expect.arrayContaining(['criticalPathMs', 'rebuiltCrates', 'timeToTestMs']),
      },
      validationNode: { kind: 'validation-node-result', nodeId: 'native-feedback:rapid-dev-fast' },
    });
  });

  test('requires material common feedback improvement and detects threshold regressions', async () => {
    const baseline = await runBaseline(10_000);
    const improved = await run(5_000);
    const improvement = compareNativeFeedbackReceipts(baseline, improved);
    expect(improvement).toMatchObject({ status: 'pass', majorCommonFeedbackReduction: true });
    expect(improvement.nextAction).toContain('meets the promotion threshold');
    expect(improvement.comparisons.find(({ scenario }) => scenario === 'leaf-edit')).toMatchObject({
      deltaMs: -5_000,
      relativeDelta: -0.5,
      majorReduction: true,
    });
    expect(improvement.comparisons.find(({ scenario }) => scenario === 'core-edit')).toMatchObject({
      deltaMs: -5_000,
      relativeDelta: -0.5,
      majorReduction: true,
    });
    const regression = compareNativeFeedbackReceipts(baseline, await run(12_000));
    expect(regression.status).toBe('regression');
    expect(regression.nextAction).toBe('Investigate native feedback regression in clean, noop, leaf-edit, core-edit.');
  });

  test('requires both common noop and affected-leaf feedback while retaining core non-regression', async () => {
    const baseline = await runBaseline(10_000);
    const candidate = await run(10_000);
    candidate.summary['leaf-edit'].timeToTestMs = { median: 5_000, p95: 5_000, samples: 3 };
    candidate.summary.noop.timeToTestMs = { median: 5_000, p95: 5_000, samples: 3 };
    const comparison = compareNativeFeedbackReceipts(baseline, candidate);
    expect(comparison).toMatchObject({ status: 'pass', majorCommonFeedbackReduction: true });
    expect(comparison.comparisons.find(({ scenario }) => scenario === 'noop')?.majorReduction).toBe(true);
    expect(comparison.comparisons.find(({ scenario }) => scenario === 'core-edit')?.majorReduction).toBe(false);
  });

  test('rejects insufficient repetitions and incompatible benchmark identities', async () => {
    await expect(
      runNativeFeedbackBenchmark({
        profile: fast,
        executor: executor(1_000),
        identity,
        warmupRuns: 0,
        measuredRuns: 2,
        startedAt: '2026-01-01T00:00:00.000Z',
        validationCacheKey: 'f'.repeat(64),
        rerunCommand: "'bun' 'native-feedback' 'benchmark' '--profile' 'rapid-dev-fast'",
      }),
    ).rejects.toThrow('at least 3');
    const baseline = await runBaseline(10_000);
    expect(() =>
      compareNativeFeedbackReceipts(baseline, {
        ...baseline,
        identity: { ...baseline.identity, hardwareClass: 'different' },
      }),
    ).toThrow('identity-compatible');
  });
});
