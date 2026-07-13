import { describe, expect, test } from 'bun:test';
import { selectImpactedScenarioIds } from '../../scripts/qa/impacted';
import type { QaScenario } from '../../scripts/qa/model';
import {
  selectScenarios,
  shardScenarios,
  validateRegistry,
  validateScenarioArtifacts,
  validateScenarioCapabilities,
} from '../../scripts/qa/planner';

const scenario = (id: string, dependencies: string[] = [], tags: string[] = []): QaScenario => ({
  id,
  dependencies,
  tags,
  artifactContracts: [],
  fixture: { id: 'empty' },
  isolation: 'fresh-context',
  requiredCapabilities: [],
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
    expect(() => selectScenarios(registry, { ids: ['compare', 'typo'] })).toThrow('Unknown QA scenario IDs: typo');
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
    expect(() => validateRegistry([scenario('left', ['right']), scenario('right', ['left'])])).toThrow('cycle');
  });

  test('keeps dependency-connected scenarios serial within one deterministic shard', () => {
    const registry = [
      scenario('editor'),
      scenario('compare', ['editor']),
      scenario('compare-export', ['compare']),
      scenario('crop'),
    ];
    const shards = [shardScenarios(registry, 0, 2), shardScenarios(registry, 1, 2)].map((items) =>
      items.map(({ id }) => id),
    );
    const chainShard = shards.find((ids) => ids.includes('compare'));
    expect(chainShard).toEqual(expect.arrayContaining(['compare', 'compare-export', 'editor']));
    expect(chainShard).toEqual(['editor', 'compare', 'compare-export']);
    expect(shards.flat().sort()).toEqual(['compare', 'compare-export', 'crop', 'editor']);
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
    expect(
      selectImpactedScenarioIds(['src/components/editor/CompareControls.tsx', 'unowned/new.file'], registry),
    ).toEqual(['compare', 'crop', 'all']);
    expect(selectImpactedScenarioIds(['src\\components\\editor\\CompareControls.tsx'], registry)).toEqual(['compare']);
  });

  test('maps harness infrastructure and navigation ownership explicitly', () => {
    const registry = [
      scenario('navigation', [], ['navigation']),
      scenario('compare', [], ['compare']),
      scenario('browser', [], ['browser']),
    ];
    expect(selectImpactedScenarioIds(['src/hooks/app/useAppNavigation.ts'], registry)).toEqual(['navigation']);
    expect(selectImpactedScenarioIds(['scripts/qa/browser-session.ts'], registry)).toEqual(['browser']);
  });

  test('selects copy/paste settings without broadening to unrelated browser scenarios', () => {
    const registry = [
      scenario('copy-paste', [], ['copy-paste']),
      scenario('compare', [], ['compare']),
      scenario('all', [], ['browser']),
    ];
    expect(selectImpactedScenarioIds(['src/components/editor/CopyPasteSettingsDialog.tsx'], registry)).toEqual([
      'copy-paste',
    ]);
  });

  test('requires exact artifact identity and kind while allowing optional contracts', () => {
    const required = {
      ...scenario('proof'),
      artifactContracts: [
        { id: 'receipt', kind: 'json-report' as const, required: true },
        { id: 'screen', kind: 'screenshot' as const, required: false },
      ],
    };
    expect(() => validateScenarioArtifacts(required, [])).toThrow('receipt (json-report)');
    expect(() => validateScenarioArtifacts(required, [{ id: 'receipt', kind: 'terminal-assertion' }])).toThrow(
      'undeclared artifact receipt (terminal-assertion)',
    );
    expect(() => validateScenarioArtifacts(required, [{ id: 'receipt', kind: 'json-report' }])).toThrow('output path');
    expect(() =>
      validateScenarioArtifacts(required, [{ id: 'receipt', kind: 'json-report', path: '/tmp/receipt.json' }]),
    ).not.toThrow();
    expect(() =>
      validateScenarioArtifacts(required, [
        { id: 'receipt', kind: 'json-report', path: '/tmp/receipt.json' },
        { id: 'receipt', kind: 'json-report', path: '/tmp/receipt-copy.json' },
      ]),
    ).toThrow('duplicate artifact');
    expect(() =>
      validateScenarioArtifacts(required, [
        { id: 'receipt', kind: 'json-report', path: '/tmp/receipt.json' },
        { id: 'undeclared', kind: 'terminal-assertion' },
      ]),
    ).toThrow('undeclared artifact');
    expect(() => validateScenarioArtifacts(required, [{ id: 'receipt', kind: 'json-report', path: '  ' }])).toThrow(
      'output path',
    );
  });

  test('rejects duplicate artifact contracts in the registry', () => {
    const duplicate = {
      ...scenario('duplicate'),
      artifactContracts: [
        { id: 'proof', kind: 'terminal-assertion' as const, required: true },
        { id: 'proof', kind: 'terminal-assertion' as const, required: false },
      ],
    };
    expect(() => validateRegistry([duplicate])).toThrow('duplicate artifact contracts');
  });

  test('rejects a scenario when its declared runtime capability is unavailable', () => {
    const browser = { ...scenario('browser'), requiredCapabilities: ['browser-tauri-harness', 'agent-audit'] };
    expect(() => validateScenarioCapabilities(browser, new Set(['browser-tauri-harness']))).toThrow('agent-audit');
    expect(() =>
      validateScenarioCapabilities(browser, new Set(['browser-tauri-harness', 'agent-audit'])),
    ).not.toThrow();
  });
});
