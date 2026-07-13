import { describe, expect, test } from 'bun:test';
import {
  assertColdWarmInteractiveRegression,
  assertResponseDistribution,
  resolveStartupHardwarePolicy,
} from '../../../scripts/benchmarks/startup-hardware-class';

describe('startup hardware class policy', () => {
  test('keeps the representative Apple-silicon defaults unchanged', () => {
    expect(resolveStartupHardwarePolicy(undefined)).toEqual({
      appControlledInteractiveMs: 750,
      appControlledVisibleMs: 250,
      firstPaintMs: 750,
      hardwareClass: 'default-macos-arm64',
      interactionResponseMs: 100,
      maxColdToWarmInteractiveRatio: null,
      maxColdToWarmInteractiveSlackMs: 0,
    });
  });

  test('accepts only the explicit bounded GitHub-hosted class', () => {
    const policy = resolveStartupHardwarePolicy('github-hosted-macos-arm64');
    expect(policy.appControlledInteractiveMs).toBe(2_000);
    expect(policy.appControlledVisibleMs).toBe(250);
    expect(policy.firstPaintMs).toBe(750);
    expect(policy.interactionResponseMs).toBe(100);
    expect(() => resolveStartupHardwarePolicy('generic-ci')).toThrow();
    expect(() => resolveStartupHardwarePolicy('')).toThrow();
  });

  test('tolerates one 108ms response outlier but rejects a repeated p95 regression', () => {
    expect(assertResponseDistribution([...Array<number>(29).fill(3), 108], 100)).toBe(3);
    expect(() => assertResponseDistribution([...Array<number>(27).fill(3), 108, 109, 110], 100)).toThrow(
      'response p95',
    );
  });

  test('enforces the hosted cold-to-warm relative bound and class receipt', () => {
    const policy = resolveStartupHardwarePolicy('github-hosted-macos-arm64');
    expect(policy.hardwareClass).toBe('github-hosted-macos-arm64');
    expect(() => assertColdWarmInteractiveRegression(1_700, 1_300, policy)).not.toThrow();
    expect(() => assertColdWarmInteractiveRegression(1_800, 1_300, policy)).toThrow('warm-relative limit');
  });
});
