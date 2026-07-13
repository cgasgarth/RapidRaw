import { describe, expect, test } from 'bun:test';
import { selectImpactedScenarioIds } from '../../scripts/qa/impacted';
import type { QaScenario } from '../../scripts/qa/model';
import { selectScenarios, shardScenarios, validateRegistry } from '../../scripts/qa/planner';

const scenario = (id: string, dependencies: string[] = [], tags: string[] = []): QaScenario => ({
  id,
  dependencies,
  tags,
  fixture: { id: 'empty' },
  isolation: 'fresh-context',
  timeoutMs: 1,
  async run() {},
});

describe('QA harness planner', () => {
  test('selects tags and explicit dependencies in registry order', () => {
    const registry = [
      scenario('fixture'),
      scenario('compare', ['fixture'], ['compare']),
      scenario('crop', [], ['crop']),
    ];
    expect(selectScenarios(registry, { tags: ['compare'] }).map(({ id }) => id)).toEqual(['fixture', 'compare']);
  });

  test('shards deterministically independent of input order', () => {
    const left = [scenario('c'), scenario('a'), scenario('d'), scenario('b')];
    const right = [...left].reverse();
    expect(shardScenarios(left, 0, 2).map(({ id }) => id)).toEqual(shardScenarios(right, 0, 2).map(({ id }) => id));
    expect(shardScenarios(left, 0, 2).map(({ id }) => id)).toEqual(['a', 'c']);
    expect(shardScenarios(left, 1, 2).map(({ id }) => id)).toEqual(['b', 'd']);
  });

  test('rejects duplicate and missing dependency identities', () => {
    expect(() => validateRegistry([scenario('same'), scenario('same')])).toThrow('unique');
    expect(() => validateRegistry([scenario('child', ['missing'])])).toThrow('unknown dependency');
  });

  test('maps affected sources narrowly and unknown sources conservatively', () => {
    const registry = [
      scenario('compare', [], ['compare']),
      scenario('crop', [], ['crop']),
      scenario('all', [], ['browser']),
    ];
    expect(selectImpactedScenarioIds(['src/components/editor/CompareControls.tsx'], registry)).toEqual(['compare']);
    expect(selectImpactedScenarioIds(['src-tauri/src/main.rs'], registry)).toEqual(['all']);
    expect(selectImpactedScenarioIds(['unowned/new.file'], registry)).toEqual(['compare', 'crop', 'all']);
  });
});
