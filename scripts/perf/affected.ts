import type { PerformanceScenario } from './model';

const ownership: readonly { pattern: RegExp; scenarioIds: readonly string[] }[] = [
  {
    pattern: /(?:src\/utils\/(?:adjustmentSnapshots|adjustments)|editor-preview-scheduling)/u,
    scenarioIds: ['editor.preview-scheduling'],
  },
  {
    pattern: /(?:src\/components\/panel\/editor\/Compare|src\/utils\/editorCompare)/u,
    scenarioIds: ['browser.editor-compare'],
  },
  {
    pattern: /(?:src\/components\/panel\/MainLibrary|src\/components\/library|src\/store\/library)/u,
    scenarioIds: ['browser.library-open'],
  },
  { pattern: /(?:scripts\/perf\/|package\.json|bun\.lock)/u, scenarioIds: ['*'] },
];

export interface AffectedPerformanceContract {
  schemaVersion: 1;
  kind: 'performance-scenarios';
  scenarioIds: string[];
  nodes: Array<{ id: string; scenarioId: string; scenarioVersion: number }>;
  conservativeFallback: boolean;
}

export function selectAffectedPerformanceScenarios(
  paths: readonly string[],
  scenarios: readonly PerformanceScenario[],
): AffectedPerformanceContract {
  if (paths.length === 0)
    return {
      schemaVersion: 1,
      kind: 'performance-scenarios',
      scenarioIds: [],
      nodes: [],
      conservativeFallback: false,
    };
  const knownIds = new Set(scenarios.map(({ id }) => id));
  const matched = paths.map((path) => ownership.filter(({ pattern }) => pattern.test(path.replaceAll('\\', '/'))));
  const fallback = matched.some(
    (rules) => rules.length === 0 || rules.some(({ scenarioIds }) => scenarioIds.includes('*')),
  );
  const scenarioIds = fallback
    ? [...knownIds]
    : [...new Set(matched.flatMap((rules) => rules.flatMap(({ scenarioIds }) => scenarioIds)))].filter((id) =>
        knownIds.has(id),
      );
  scenarioIds.sort();
  const versions = new Map(scenarios.map(({ id, version }) => [id, version]));
  return {
    schemaVersion: 1,
    kind: 'performance-scenarios',
    scenarioIds,
    nodes: scenarioIds.map((scenarioId) => ({
      id: `perf:${scenarioId}:v${versions.get(scenarioId) ?? 0}`,
      scenarioId,
      scenarioVersion: versions.get(scenarioId) ?? 0,
    })),
    conservativeFallback: fallback,
  };
}
