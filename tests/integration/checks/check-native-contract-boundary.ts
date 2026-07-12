const result = Bun.spawnSync(
  ['cargo', 'metadata', '--format-version', '1', '--no-deps', '--manifest-path', 'src-tauri/Cargo.toml'],
  { stderr: 'pipe', stdout: 'pipe' },
);

if (result.exitCode !== 0) {
  throw new Error(`cargo metadata failed: ${result.stderr.toString().trim()}`);
}

interface CargoPackage {
  dependencies: Array<{ name: string }>;
  name: string;
}

const metadata = JSON.parse(result.stdout.toString()) as { packages: CargoPackage[] };
const contractPackage = metadata.packages.find((entry) => entry.name === 'rapidraw-types');
if (!contractPackage) throw new Error('rapidraw-types is not a Cargo workspace member.');

const allowed = new Set(['serde', 'serde_json']);
const unexpected = contractPackage.dependencies
  .map((dependency) => dependency.name)
  .filter((name) => !allowed.has(name));
if (unexpected.length > 0) {
  throw new Error(`rapidraw-types dependency boundary leaked: ${unexpected.sort().join(', ')}`);
}

const appPackage = metadata.packages.find((entry) => entry.name === 'RapidRAW');
if (!appPackage?.dependencies.some((dependency) => dependency.name === 'rapidraw-types')) {
  throw new Error('RapidRAW must consume the rapidraw-types production crate.');
}

console.log('native contract dependency boundary ok');
