const result = Bun.spawnSync(
  ['cargo', 'metadata', '--format-version', '1', '--no-deps', '--manifest-path', 'src-tauri/Cargo.toml'],
  { stderr: 'pipe', stdout: 'pipe' },
);

if (result.exitCode !== 0) {
  throw new Error(`cargo metadata failed: ${result.stderr.toString().trim()}`);
}

interface CargoPackage {
  dependencies: Array<{ kind: string | null; name: string }>;
  name: string;
}

const metadata = JSON.parse(result.stdout.toString()) as { packages: CargoPackage[] };
const contractPackage = metadata.packages.find((entry) => entry.name === 'rapidraw-types');
if (!contractPackage) throw new Error('rapidraw-types is not a Cargo workspace member.');

const allowedRuntime = new Set(['serde']);
const unexpected = contractPackage.dependencies
  .filter((dependency) => dependency.kind === null)
  .map((dependency) => dependency.name)
  .filter((name) => !allowedRuntime.has(name));
if (unexpected.length > 0) {
  throw new Error(`rapidraw-types dependency boundary leaked: ${unexpected.sort().join(', ')}`);
}

const appPackage = metadata.packages.find((entry) => entry.name === 'RapidRAW');
if (!appPackage?.dependencies.some((dependency) => dependency.name === 'rapidraw-types')) {
  throw new Error('RapidRAW must consume the rapidraw-types production crate.');
}

const aiPackage = metadata.packages.find((entry) => entry.name === 'rapidraw-ai');
if (!aiPackage) throw new Error('rapidraw-ai is not a Cargo workspace member.');
for (const dependency of ['ort', 'tokenizers']) {
  if (!aiPackage.dependencies.some((entry) => entry.kind === null && entry.name === dependency)) {
    throw new Error(`rapidraw-ai must own ${dependency}.`);
  }
  if (appPackage.dependencies.some((entry) => entry.kind === null && entry.name === dependency)) {
    throw new Error(`RapidRAW root must not directly own ${dependency}.`);
  }
}

const tree = runCargo([
  'tree',
  '--manifest-path',
  'src-tauri/Cargo.toml',
  '-p',
  'RapidRAW',
  '--no-default-features',
  '--offline',
  '--prefix',
  'none',
]);
for (const forbidden of ['ort ', 'ort-sys ', 'tokenizers ']) {
  if (tree.split('\n').some((line) => line.startsWith(forbidden))) {
    throw new Error(`non-AI dependency graph contains ${forbidden.trim()}.`);
  }
}

const noAiBuild = runCargo([
  'check',
  '--manifest-path',
  'src-tauri/Cargo.toml',
  '-p',
  'RapidRAW',
  '--no-default-features',
  '--offline',
]);
if (/Downloading ONNX Runtime|onnxruntimes-v/u.test(noAiBuild)) {
  throw new Error('non-AI build attempted ONNX Runtime artifact acquisition.');
}

console.log('native contract and optional AI boundaries ok');

function runCargo(args: string[]): string {
  const command = Bun.spawnSync(['cargo', ...args], { stderr: 'pipe', stdout: 'pipe' });
  const output = `${command.stdout.toString()}\n${command.stderr.toString()}`;
  if (command.exitCode !== 0) {
    throw new Error(`cargo ${args[0]} failed:\n${output.split('\n').slice(-40).join('\n')}`);
  }
  return output;
}
