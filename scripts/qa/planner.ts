import type { QaScenario } from './model';

export function validateRegistry(scenarios: readonly QaScenario[]): void {
  const ids = new Set(scenarios.map(({ id }) => id));
  if (ids.size !== scenarios.length) throw new Error('QA scenario IDs must be unique.');
  for (const scenario of scenarios) {
    for (const dependency of scenario.dependencies) {
      if (!ids.has(dependency)) throw new Error(`${scenario.id} has unknown dependency ${dependency}.`);
      if (dependency === scenario.id) throw new Error(`${scenario.id} cannot depend on itself.`);
    }
  }
}

export function selectScenarios(
  scenarios: readonly QaScenario[],
  options: { ids?: readonly string[]; tags?: readonly string[] },
): QaScenario[] {
  validateRegistry(scenarios);
  const requested = new Set(options.ids ?? []);
  const tags = new Set(options.tags ?? []);
  const matches = scenarios.filter(
    (scenario) =>
      (requested.size === 0 && tags.size === 0) ||
      requested.has(scenario.id) ||
      scenario.tags.some((tag) => tags.has(tag)),
  );
  if (matches.length === 0) throw new Error('No QA scenarios matched the selection.');
  const selected = new Map(matches.map((scenario) => [scenario.id, scenario]));
  const byId = new Map(scenarios.map((scenario) => [scenario.id, scenario]));
  const includeDependencies = (scenario: QaScenario) => {
    for (const id of scenario.dependencies) {
      const dependency = byId.get(id);
      if (dependency === undefined) continue;
      if (!selected.has(id)) selected.set(id, dependency);
      includeDependencies(dependency);
    }
  };
  for (const scenario of matches) includeDependencies(scenario);
  return scenarios.filter(({ id }) => selected.has(id));
}

export function shardScenarios(scenarios: readonly QaScenario[], index: number, total: number): QaScenario[] {
  if (!Number.isInteger(index) || !Number.isInteger(total) || total < 1 || index < 0 || index >= total) {
    throw new Error(`Invalid shard ${index}/${total}.`);
  }
  return [...scenarios]
    .sort((left, right) => left.id.localeCompare(right.id))
    .filter((_, position) => position % total === index);
}
