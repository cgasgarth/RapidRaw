import { afterEach, describe, expect, test } from 'bun:test';
import { generateKeyPairSync } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import {
  createPerformanceArtifactUploadManifest,
  performanceArtifactUploadManifestSchema,
  planPerformanceArtifactRetention,
} from '../../scripts/perf/artifacts';
import { ciTrendGateExitCode, createPerformanceCiTrendGate } from '../../scripts/perf/ci';
import { appendApprovedBaseline } from '../../scripts/perf/history';
import type { PerformanceIdentity, PerformanceScenario } from '../../scripts/perf/model';
import { runPerformanceScenario } from '../../scripts/perf/runner';
import { classifyHardwareCompatibility } from '../../scripts/perf/statistics';

const directories: string[] = [];
const { privateKey } = generateKeyPairSync('ed25519');
const approval = (reason: string, approvedAt: string) => ({
  actor: 'ci-performance-reviewer',
  reason,
  approvedAt,
  signingKey: privateKey,
});
afterEach(async () => {
  await Promise.all(directories.splice(0).map((path) => rm(path, { force: true, recursive: true })));
});

const identity = (hardware: string): PerformanceIdentity => ({
  git: { commit: 'a'.repeat(40), dirtyDigest: 'b'.repeat(64) },
  build: { profile: 'ci', runtime: 'bun-test' },
  hardware: {
    classId: hardware.repeat(64),
    cpuCores: 8,
    cpuModelHash: hardware.repeat(64),
    memoryGiB: 16,
  },
  environment: {
    arch: hardware === 'c' ? 'arm64' : 'x64',
    bun: 'test',
    os: hardware === 'c' ? 'darwin' : 'linux',
  },
});

const scenario = (value: number, unit: 'ms' | 'count' = 'ms'): PerformanceScenario => ({
  id: 'editor.ci-proof',
  version: 1,
  fixtureDigest: `sha256:${'d'.repeat(64)}`,
  cacheMode: 'warm',
  warmupRuns: 0,
  measuredRuns: 3,
  budgets: { measured: { absolute: 2, relative: 0.15 } },
  maxRelativeMad: 0.2,
  metricUnits: { measured: unit },
  async runSample() {
    return { assertions: 1, metrics: { measured: value } };
  },
});

const clock = (iso: string) => () => new Date(iso);

describe('performance CI trend gate', () => {
  test('gates against approved history with deterministic exit semantics', async () => {
    const baseline = await runPerformanceScenario({
      scenario: scenario(10),
      identity: identity('c'),
      now: clock('2026-01-01T00:00:00.000Z'),
    });
    const history = appendApprovedBaseline(
      undefined,
      baseline,
      approval('reviewed CI baseline', '2026-01-02T00:00:00.000Z'),
    );
    const candidate = await runPerformanceScenario({
      scenario: scenario(14),
      identity: identity('c'),
      now: clock('2026-01-03T00:00:00.000Z'),
    });
    const gate = createPerformanceCiTrendGate(history, candidate, scenario(14));
    expect(gate).toMatchObject({ status: 'regression', baselineRunId: baseline.runId });
    expect(gate.annotation.summary).toContain('measured');
    expect(ciTrendGateExitCode(gate.status)).toBe(1);
    expect(ciTrendGateExitCode('invalid')).toBe(2);
  });

  test('allows deterministic work counts cross-platform but rejects latency classes', async () => {
    const baseline = await runPerformanceScenario({
      scenario: scenario(10, 'count'),
      identity: identity('c'),
      now: clock('2026-01-01T00:00:00.000Z'),
    });
    const candidate = await runPerformanceScenario({
      scenario: scenario(10, 'count'),
      identity: identity('e'),
      now: clock('2026-01-03T00:00:00.000Z'),
    });
    expect(classifyHardwareCompatibility(baseline, candidate, ['count'])).toMatchObject({
      compatible: true,
      mode: 'portable-work-count',
    });
    expect(classifyHardwareCompatibility(baseline, candidate, ['ms'])).toMatchObject({
      compatible: false,
      mode: 'incompatible',
    });
    const history = appendApprovedBaseline(
      undefined,
      baseline,
      approval('reviewed portable baseline', '2026-01-02T00:00:00.000Z'),
    );
    expect(createPerformanceCiTrendGate(history, candidate, scenario(10, 'count')).status).toBe('pass');
  });
});

describe('performance artifact upload and retention', () => {
  test('hashes a deterministic upload manifest and de-duplicates paths', async () => {
    const directory = await mkdtemp(resolve(tmpdir(), 'rapidraw-perf-artifacts-'));
    directories.push(directory);
    const receipt = await runPerformanceScenario({
      scenario: scenario(10),
      identity: identity('c'),
      now: clock('2026-01-01T00:00:00.000Z'),
    });
    const receiptPath = resolve(directory, 'candidate.json');
    await writeFile(receiptPath, JSON.stringify(receipt));
    const manifest = await createPerformanceArtifactUploadManifest({
      receipt,
      paths: [receiptPath, receiptPath],
      generatedAt: '2026-01-02T00:00:00.000Z',
    });
    expect(performanceArtifactUploadManifestSchema.parse(manifest).files).toHaveLength(1);
    expect(manifest.files[0]).toMatchObject({ kind: 'run-receipt', path: receiptPath });
    expect(manifest.files[0]?.sha256).toHaveLength(64);
  });

  test('never proposes deleting approved history while aging unapproved artifacts by status', async () => {
    const baseline = await runPerformanceScenario({
      scenario: scenario(10),
      identity: identity('c'),
      now: clock('2026-01-01T00:00:00.000Z'),
    });
    const history = appendApprovedBaseline(
      undefined,
      baseline,
      approval('reviewed retained baseline', '2026-01-02T00:00:00.000Z'),
    );
    const plan = planPerformanceArtifactRetention({
      history,
      now: '2026-03-01T00:00:00.000Z',
      index: {
        schemaVersion: 1,
        artifacts: [
          { createdAt: '2026-01-01T00:00:00.000Z', path: '/approved.json', runId: baseline.runId, status: 'pass' },
          { createdAt: '2026-01-01T00:00:00.000Z', path: '/old-pass.json', runId: 'old-pass', status: 'pass' },
          {
            createdAt: '2026-02-15T00:00:00.000Z',
            path: '/recent-regression.json',
            runId: 'recent-regression',
            status: 'regression',
          },
        ],
      },
    });
    expect(plan.policy).toBe('plan-only-approved-history-preserved');
    expect(plan.keep).toEqual(['/approved.json', '/recent-regression.json']);
    expect(plan.pruneCandidates).toEqual(['/old-pass.json']);
  });
});
