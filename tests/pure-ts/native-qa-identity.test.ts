import { describe, expect, test } from 'bun:test';
import type { NativeQaIdentity } from '../../scripts/qa/native-identity';
import {
  assertNativeQaBuildAvailability,
  createNativeQaDeploymentReport,
  planNativeQaDeployment,
} from '../../scripts/qa/native-identity';

const identity = (overrides: Partial<NativeQaIdentity> = {}): NativeQaIdentity => ({
  native: 'n',
  frontend: 'f',
  bundle: 'b',
  scenario: 's',
  worktree: '/work/a',
  ...overrides,
});

describe('native QA deployment plan', () => {
  test('scenario-only changes avoid build, copy, and sign', () => {
    expect(
      planNativeQaDeployment(identity(), identity({ scenario: 's2' }), { clean: false, devServer: false }),
    ).toEqual({ build: false, copy: false, sign: false, reason: 'scenario-only' });
  });
  test('dev-server frontend changes avoid native deployment', () => {
    expect(
      planNativeQaDeployment(identity(), identity({ frontend: 'f2' }), { clean: false, devServer: true }).build,
    ).toBeFalse();
    expect(
      planNativeQaDeployment(identity(), identity({ frontend: 'f2' }), { clean: false, devServer: false }).build,
    ).toBeTrue();
  });
  test.each(['native', 'bundle', 'worktree'] as const)('%s identity changes force isolated deployment', (field) => {
    const changed = field === 'worktree' ? identity({ worktree: '/work/b' }) : identity({ [field]: 'changed' });
    expect(planNativeQaDeployment(identity(), changed, { clean: false, devServer: false })).toMatchObject({
      build: true,
      copy: true,
      sign: true,
    });
  });
  test('clean and first runs force all stages', () => {
    expect(planNativeQaDeployment(identity(), identity(), { clean: true, devServer: false }).reason).toBe('clean');
    expect(planNativeQaDeployment(undefined, identity(), { clean: false, devServer: false }).reason).toBe('uncached');
  });

  test('reports executed and identity-avoided native deployment stages', () => {
    const hashed = identity({
      native: 'a'.repeat(64),
      frontend: 'b'.repeat(64),
      bundle: 'c'.repeat(64),
      scenario: 'd'.repeat(64),
    });
    const report = createNativeQaDeploymentReport(
      hashed,
      planNativeQaDeployment(hashed, hashed, { clean: false, devServer: false }),
      { shouldBuild: true, durationMs: 12, completedAt: '2026-07-13T12:00:00.000Z' },
    );
    expect(report.stages).toEqual({
      build: { requested: true, executed: false, avoidedByIdentity: true },
      copy: { requested: true, executed: false, avoidedByIdentity: true },
      sign: { requested: true, executed: false, avoidedByIdentity: true },
    });
    expect(
      createNativeQaDeploymentReport(
        hashed,
        planNativeQaDeployment(undefined, hashed, { clean: false, devServer: false }),
        { shouldBuild: false, durationMs: 1, completedAt: '2026-07-13T12:00:00.000Z' },
      ).stages.build,
    ).toEqual({ requested: false, executed: false, avoidedByIdentity: false });
  });

  test('refuses to copy or launch stale artifacts when a requested build is disabled', () => {
    const changed = planNativeQaDeployment(identity(), identity({ native: 'changed' }), {
      clean: false,
      devServer: false,
    });
    expect(() => assertNativeQaBuildAvailability(changed, false)).toThrow(
      '--no-build cannot satisfy native QA deployment reason native-changed',
    );
    expect(() => assertNativeQaBuildAvailability(changed, true)).not.toThrow();
    expect(() =>
      assertNativeQaBuildAvailability(
        planNativeQaDeployment(identity(), identity(), { clean: false, devServer: false }),
        false,
      ),
    ).not.toThrow();
  });
});
