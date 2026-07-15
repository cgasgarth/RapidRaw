import { describe, expect, test } from 'bun:test';
import {
  DEFAULT_FALLOW_HEALTH_THRESHOLD,
  evaluateFallowHealthOutput,
  evaluateFallowHealthReport,
  parseFallowHealthThreshold,
} from '../../../scripts/lib/ci/fallow-health-gate';

const report = (score: number) => ({
  health_score: {
    grade: score >= 85 ? 'A' : 'B',
    penalties: {
      circular_deps: 1.1,
      coupling: 2.4,
      dead_exports: 0.1,
      duplication: 0,
      unit_size: 10,
    },
    score,
  },
});

describe('Fallow health gate', () => {
  test('accepts a score at the default threshold', () => {
    expect(evaluateFallowHealthReport(report(85), DEFAULT_FALLOW_HEALTH_THRESHOLD)).toEqual({
      exitCode: 0,
      message: 'fallow health ok (score=85.0 threshold=85.0 grade=A)',
    });
  });

  test('fails a forced 100 threshold with bounded top regressions', () => {
    expect(evaluateFallowHealthOutput(JSON.stringify(report(85.3)), '100')).toEqual({
      exitCode: 1,
      message: 'fallow health failed (score=85.3 threshold=100.0 top=unit_size:10.0,coupling:2.4,circular_deps:1.1)',
    });
  });

  test('rejects malformed reports and invalid threshold configuration', () => {
    expect(() => evaluateFallowHealthOutput('{"health_score":{"score":"85"}}')).toThrow();
    expect(() => parseFallowHealthThreshold('101')).toThrow();
  });
});
