#!/usr/bin/env bun

export const MAIN_FRONTEND_LANES = [
  'frontend-static',
  'frontend-contracts',
  'frontend-unit',
  'frontend-browser',
  'frontend-bundle',
] as const;

export function mainFrontendClosureFailures(value: unknown): string[] {
  return MAIN_FRONTEND_LANES.flatMap((lane) => {
    const laneValue = typeof value === 'object' && value !== null ? Reflect.get(value, lane) : undefined;
    const result =
      typeof laneValue === 'object' && laneValue !== null && typeof Reflect.get(laneValue, 'result') === 'string'
        ? String(Reflect.get(laneValue, 'result'))
        : 'missing';
    return result === 'success' ? [] : [`${lane}=${result}`];
  });
}

if (import.meta.main) {
  const failures = mainFrontendClosureFailures(JSON.parse(process.env.NEEDS_CONTEXT ?? '{}'));
  if (failures.length > 0) {
    console.error(`Main frontend closure failed: ${failures.join(', ')}`);
    process.exit(1);
  }
  console.log(`main frontend closure ok (${MAIN_FRONTEND_LANES.length} parallel lanes)`);
}
