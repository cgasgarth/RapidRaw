export type ValidationMode = 'commit' | 'push' | 'pr' | 'full' | 'release';
export type ResourceClass = 'light' | 'cpu-heavy' | 'native-heavy' | 'browser' | 'network';
export type InputClass = 'docs' | 'frontend' | 'schema' | 'rust' | 'workflows' | 'dependencies' | 'scripts';

export interface ValidationNode {
  id: string;
  command: readonly string[];
  dependencies: readonly string[];
  inputs: readonly InputClass[];
  resourceClass: ResourceClass;
  cachePolicy: 'none' | 'local' | 'local-ci';
  modes: readonly ValidationMode[];
  timeoutMs: number;
  outputs?: readonly string[];
}

const all: ValidationMode[] = ['commit', 'push', 'pr', 'full', 'release'];
const broad: ValidationMode[] = ['push', 'pr', 'full', 'release'];
const ci: ValidationMode[] = ['pr', 'full', 'release'];
const node = (
  id: string,
  command: readonly string[],
  inputs: readonly InputClass[],
  resourceClass: ResourceClass = 'light',
  modes: readonly ValidationMode[] = all,
  dependencies: readonly string[] = [],
  cachePolicy: ValidationNode['cachePolicy'] = 'local-ci',
  timeoutMs = 10 * 60_000,
  outputs?: readonly string[],
): ValidationNode => ({ id, command, inputs, resourceClass, modes, dependencies, cachePolicy, timeoutMs, outputs });

export const validationManifest: readonly ValidationNode[] = [
  node('lint', ['bun', 'run', 'lint'], ['frontend', 'schema', 'scripts']),
  node('format', ['bun', 'run', 'format:check'], ['docs', 'frontend', 'schema', 'scripts', 'workflows', 'rust']),
  node('typecheck', ['bun', 'run', 'typecheck'], ['frontend', 'schema'], 'cpu-heavy'),
  node('unit', ['bun', 'run', 'test:unit'], ['frontend', 'schema', 'scripts'], 'cpu-heavy'),
  node('unsafe-casts', ['bun', 'tests/integration/checks/check-unsafe-casts.ts'], ['frontend']),
  node('rustfmt', ['bun', 'run', 'check:rust:fmt'], ['rust']),
  node('rust-clippy', ['bun', 'run', 'check:rust:clippy'], ['rust', 'dependencies'], 'native-heavy'),
  node('schema', ['bun', 'run', 'check:schema'], ['schema', 'frontend'], 'cpu-heavy'),
  node(
    'bundle-build',
    ['bun', 'run', 'build'],
    ['frontend', 'schema', 'dependencies'],
    'cpu-heavy',
    broad,
    [],
    'local-ci',
    10 * 60_000,
    ['dist'],
  ),
  node(
    'bundle-proof',
    ['bun', 'tests/integration/checks/check-vite-product-bundle-guard.ts'],
    ['frontend', 'schema', 'dependencies'],
    'light',
    broad,
    ['bundle-build'],
  ),
  node(
    'bundle-payload',
    ['bun', 'tests/integration/checks/check-vite-production-payload.ts'],
    ['frontend', 'schema', 'dependencies'],
    'light',
    broad,
    ['bundle-build'],
  ),
  node(
    'bundle-budget',
    ['bun', 'tests/integration/checks/check-vite-bundle-budget.ts'],
    ['frontend', 'schema', 'dependencies'],
    'light',
    broad,
    ['bundle-build'],
  ),
  node(
    'bundle-report',
    ['bun', 'scripts/ci/generate-vite-bundle-report.ts'],
    ['frontend', 'schema', 'dependencies'],
    'light',
    broad,
    ['bundle-build'],
    'local-ci',
    10 * 60_000,
    ['artifacts/bundle-report'],
  ),
  node('actions', ['bun', 'run', 'check:actions'], ['workflows'], 'network'),
  node('action-pins', ['bun', 'tests/integration/checks/check-github-action-pins.ts'], ['workflows']),
  node('security', ['bun', 'run', 'check:security'], ['dependencies'], 'network', ci, [], 'local-ci', 20 * 60_000),
  node(
    'license-rust',
    [
      'bun',
      'scripts/ci/run-compact-command.ts',
      '--label',
      'license:rust',
      '--cwd',
      'src-tauri',
      '--',
      'cargo',
      'deny',
      'check',
      'licenses',
    ],
    ['rust', 'dependencies'],
    'native-heavy',
  ),
  node('browser-harness', ['bun', 'run', 'check:browser-harness'], ['frontend', 'schema', 'rust'], 'browser', broad),
  node(
    'tauri-contracts',
    ['bun', 'tests/integration/checks/tauri/check-tauri-command-registration.ts'],
    ['frontend', 'rust', 'schema'],
  ),
  node(
    'tauri-schemas',
    ['bun', 'tests/integration/checks/tauri/check-tauri-schema-validation.ts'],
    ['frontend', 'rust', 'schema'],
  ),
  node('script-types', ['bun', 'tests/integration/checks/check-script-type-coverage.ts'], ['scripts', 'frontend']),
  node('rust-cfg', ['bun', 'tests/integration/checks/check-rust-platform-cfg-dead-code.ts'], ['rust']),
  node(
    'native-boundaries',
    ['bun', 'tests/integration/checks/check-native-contract-boundary.ts'],
    ['rust', 'dependencies'],
  ),
  node('native-leaves', ['bun', 'tests/integration/checks/check-native-feature-leaves.ts'], ['rust', 'dependencies']),
  node(
    'perf-smoke',
    ['bun', 'scripts/checks/ci/check-performance-smoke.ts'],
    ['frontend', 'rust', 'scripts'],
    'cpu-heavy',
    broad,
  ),
  node('i18n', ['bunx', 'i18next-cli', 'lint'], ['frontend'], 'cpu-heavy'),
  node('i18n-extract', ['bunx', 'i18next-cli', 'extract', '--ci', '--dry-run'], ['frontend'], 'cpu-heavy'),
  node(
    'unused-deps',
    ['bunx', 'knip', '--config', 'knip.jsonc', '--dependencies', '--reporter', 'compact'],
    ['frontend', 'dependencies'],
  ),
  node('docs', ['bun', 'run', 'check:docs'], ['docs']),
];
