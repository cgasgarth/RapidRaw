import type { QaArtifactRecord, QaScenario } from './model';

export function validateScenarioArtifacts(scenario: QaScenario, artifacts: readonly QaArtifactRecord[]): void {
  const contracts = new Map(
    scenario.artifactContracts.map((contract) => [`${contract.id}:${contract.kind}`, contract]),
  );
  if (contracts.size !== scenario.artifactContracts.length)
    throw new Error(`${scenario.id} has duplicate artifact contracts.`);
  const records = new Set<string>();
  for (const artifact of artifacts) {
    const key = `${artifact.id}:${artifact.kind}`;
    if (!contracts.has(key))
      throw new Error(`Scenario recorded undeclared artifact ${artifact.id} (${artifact.kind}).`);
    if (records.has(key)) throw new Error(`Scenario recorded duplicate artifact ${artifact.id} (${artifact.kind}).`);
    records.add(key);
    if (artifact.kind !== 'terminal-assertion' && (artifact.path === undefined || artifact.path.trim() === ''))
      throw new Error(`Scenario artifact ${artifact.id} (${artifact.kind}) is missing its output path.`);
  }
  for (const contract of scenario.artifactContracts) {
    const artifact = artifacts.find(({ id, kind }) => id === contract.id && kind === contract.kind);
    if (contract.required && artifact === undefined)
      throw new Error(`Scenario did not satisfy required artifact contract ${contract.id} (${contract.kind}).`);
  }
}

export function validateScenarioCapabilities(scenario: QaScenario, available: ReadonlySet<string>): void {
  const missing = scenario.requiredCapabilities.filter((capability) => !available.has(capability));
  if (missing.length > 0) throw new Error(`Scenario requires unavailable capabilities: ${missing.join(', ')}`);
}

export function validateRegistry(scenarios: readonly QaScenario[]): void {
  const ids = new Set(scenarios.map(({ id }) => id));
  if (ids.size !== scenarios.length) throw new Error('QA scenario IDs must be unique.');
  for (const scenario of scenarios) {
    const contracts = new Set(scenario.artifactContracts.map(({ id, kind }) => `${id}:${kind}`));
    if (contracts.size !== scenario.artifactContracts.length)
      throw new Error(`${scenario.id} has duplicate artifact contracts.`);
    for (const dependency of scenario.dependencies) {
      if (!ids.has(dependency)) throw new Error(`${scenario.id} has unknown dependency ${dependency}.`);
      if (dependency === scenario.id) throw new Error(`${scenario.id} cannot depend on itself.`);
    }
  }
  const byId = new Map(scenarios.map((scenario) => [scenario.id, scenario]));
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (id: string): void => {
    if (visiting.has(id)) throw new Error(`QA scenario dependency cycle includes ${id}.`);
    if (visited.has(id)) return;
    visiting.add(id);
    for (const dependency of byId.get(id)?.dependencies ?? []) visit(dependency);
    visiting.delete(id);
    visited.add(id);
  };
  for (const { id } of scenarios) visit(id);
}

export function selectScenarios(
  scenarios: readonly QaScenario[],
  options: { ids?: readonly string[]; tags?: readonly string[] },
): QaScenario[] {
  validateRegistry(scenarios);
  const requested = new Set(options.ids ?? []);
  const tags = new Set(options.tags ?? []);
  const knownIds = new Set(scenarios.map(({ id }) => id));
  const unknownIds = [...requested].filter((id) => !knownIds.has(id));
  if (unknownIds.length > 0) throw new Error(`Unknown QA scenario IDs: ${unknownIds.sort().join(', ')}`);
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
  validateRegistry(scenarios);
  const sorted = [...scenarios].sort((left, right) => left.id.localeCompare(right.id));
  const parent = new Map(sorted.map(({ id }) => [id, id]));
  const root = (id: string): string => {
    const next = parent.get(id);
    if (next === undefined || next === id) return id;
    const resolved = root(next);
    parent.set(id, resolved);
    return resolved;
  };
  const union = (left: string, right: string): void => {
    const leftRoot = root(left);
    const rightRoot = root(right);
    if (leftRoot === rightRoot) return;
    if (leftRoot.localeCompare(rightRoot) < 0) parent.set(rightRoot, leftRoot);
    else parent.set(leftRoot, rightRoot);
  };
  for (const scenario of sorted) for (const dependency of scenario.dependencies) union(scenario.id, dependency);
  const components = [...new Set(sorted.map(({ id }) => root(id)))].sort((left, right) => left.localeCompare(right));
  const shardByComponent = new Map(components.map((component, position) => [component, position % total]));
  const byId = new Map(sorted.map((scenario) => [scenario.id, scenario]));
  const emitted = new Set<string>();
  const ordered: QaScenario[] = [];
  const emit = (scenario: QaScenario): void => {
    if (emitted.has(scenario.id)) return;
    for (const dependencyId of [...scenario.dependencies].sort()) {
      const dependency = byId.get(dependencyId);
      if (dependency !== undefined) emit(dependency);
    }
    emitted.add(scenario.id);
    ordered.push(scenario);
  };
  for (const scenario of sorted) emit(scenario);
  return ordered.filter(({ id }) => shardByComponent.get(root(id)) === index);
}
