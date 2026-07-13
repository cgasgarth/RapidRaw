import { describe, expect, test } from 'bun:test';
import {
  assertQaReproductionIdentity,
  buildQaRerunArgs,
  buildQaRerunCommand,
  qaRunReceiptSchema,
} from '../../scripts/qa/receipt';

const metrics = {
  browserStarts: 1,
  configurationRestarts: 0,
  contextsClosed: 2,
  contextsCreated: 2,
  jobs: 1,
  leakedContexts: 0,
  serverStarts: 1,
  sourceReuses: 0,
};

const receipt = {
  browserVersion: 'Chromium 1',
  buildIdentity: 'build-1',
  dirtyDigest: 'b'.repeat(64),
  endedAt: '2026-07-13T12:00:01.000Z',
  gitSha: 'a'.repeat(40),
  metrics,
  persistent: true,
  platform: 'darwin-arm64',
  rerunCommand: 'placeholder',
  runId: 'run-1',
  scenarios: [
    { durationMs: 10, id: 'browser.pass', status: 'passed' as const },
    {
      durationMs: 12,
      error: 'failure',
      id: 'browser.fail',
      log: 'vite log',
      screenshot: '/tmp/failure.png',
      status: 'failed' as const,
      trace: '/tmp/failure.zip',
      video: '/tmp/failure.webm',
    },
  ],
  schemaVersion: 1 as const,
  seed: 42,
  shard: { index: 0, total: 2 },
  startedAt: '2026-07-13T12:00:00.000Z',
  worktree: '/repo',
};

describe('QA harness reproduction receipt', () => {
  test('validates bounded identity, execution, shard, and scenario fields', () => {
    expect(qaRunReceiptSchema.parse(receipt).seed).toBe(42);
    expect(qaRunReceiptSchema.parse(receipt).scenarios[1]).toMatchObject({
      log: 'vite log',
      screenshot: '/tmp/failure.png',
      trace: '/tmp/failure.zip',
      video: '/tmp/failure.webm',
    });
    expect(() => qaRunReceiptSchema.parse({ ...receipt, seed: -1 })).toThrow();
    expect(() => qaRunReceiptSchema.parse({ ...receipt, shard: { index: 2, total: 2 } })).toThrow(
      'index must be less than total',
    );
    expect(() => qaRunReceiptSchema.parse({ ...receipt, scenarios: [] })).toThrow();
  });

  test('reproduces only failures with the recorded seed and execution mode', () => {
    expect(buildQaRerunArgs(receipt)).toEqual(['run', '--seed', '42', '--persistent', '--scenario', 'browser.fail']);
    expect(buildQaRerunCommand(receipt)).toBe(
      "'bun' 'qa' 'run' '--seed' '42' '--persistent' '--scenario' 'browser.fail'",
    );
  });

  test('reproduces each recorded scenario once when the run passed', () => {
    const passed = {
      ...receipt,
      persistent: false,
      scenarios: [
        { durationMs: 1, id: 'browser.editor', status: 'passed' as const },
        { durationMs: 2, id: 'browser.editor', status: 'passed' as const },
        { durationMs: 3, id: "browser.quote'proof", status: 'passed' as const },
      ],
    };
    expect(buildQaRerunArgs(passed)).toEqual([
      'run',
      '--seed',
      '42',
      '--scenario',
      'browser.editor',
      '--scenario',
      "browser.quote'proof",
    ]);
    expect(buildQaRerunCommand(passed)).toContain("'browser.quote'\\''proof'");
  });

  test('fails closed when the current worktree, source, build, or platform differs', () => {
    const identity = {
      buildIdentity: receipt.buildIdentity,
      dirtyDigest: receipt.dirtyDigest,
      gitSha: receipt.gitSha,
      platform: receipt.platform,
      worktree: receipt.worktree,
    };
    expect(() => assertQaReproductionIdentity(receipt, identity)).not.toThrow();
    expect(() =>
      assertQaReproductionIdentity(receipt, {
        ...identity,
        dirtyDigest: 'c'.repeat(64),
        gitSha: 'd'.repeat(40),
      }),
    ).toThrow('dirtyDigest=');
    expect(() =>
      assertQaReproductionIdentity(receipt, { ...identity, buildIdentity: 'other-build', platform: 'linux-x64' }),
    ).toThrow('buildIdentity=other-build');
  });
});
