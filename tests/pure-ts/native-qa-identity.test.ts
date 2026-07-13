import { describe, expect, test } from 'bun:test';
import type { NativeQaIdentity } from '../../scripts/qa/native-identity';
import { planNativeQaDeployment } from '../../scripts/qa/native-identity';

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
});
