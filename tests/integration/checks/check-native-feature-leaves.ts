const metadataResult = Bun.spawnSync(
  ['cargo', 'metadata', '--format-version', '1', '--no-deps', '--manifest-path', 'src-tauri/Cargo.toml'],
  { stderr: 'pipe', stdout: 'pipe' },
);
if (metadataResult.exitCode !== 0) {
  throw new Error(`cargo metadata failed: ${metadataResult.stderr.toString().trim()}`);
}

interface CargoDependency {
  kind: string | null;
  name: string;
  optional: boolean;
}
interface CargoPackage {
  dependencies: CargoDependency[];
  features: Record<string, string[]>;
  name: string;
}
const packages = (JSON.parse(metadataResult.stdout.toString()) as { packages: CargoPackage[] }).packages;
const packageNamed = (name: string): CargoPackage => {
  const found = packages.find((entry) => entry.name === name);
  if (!found) throw new Error(`${name} is not a workspace package.`);
  return found;
};

const app = packageNamed('RapidRAW');
const codecs = packageNamed('rapidraw-codecs');
const computational = packageNamed('rapidraw-computational');
const heavyCodecPackages = new Set(['jxl-encoder', 'jxl-oxide', 'mozjpeg-rs', 'webp']);
const leakedToApp = app.dependencies.filter((dependency) => heavyCodecPackages.has(dependency.name));
if (leakedToApp.length > 0) {
  throw new Error(`codec implementation leaked into RapidRAW: ${leakedToApp.map(({ name }) => name).join(', ')}`);
}
for (const name of heavyCodecPackages) {
  if (!codecs.dependencies.some((dependency) => dependency.name === name)) {
    throw new Error(`rapidraw-codecs does not own ${name}.`);
  }
}
const allowedComputational = new Set(['blake3', 'rapidraw-types', 'serde', 'serde_json']);
const computationalLeak = computational.dependencies
  .filter((dependency) => dependency.kind === null && !dependency.optional)
  .filter((dependency) => !allowedComputational.has(dependency.name));
if (computationalLeak.length > 0) {
  throw new Error(
    `computational leaf leaked platform/codec/application dependencies: ${computationalLeak
      .map(({ name }) => name)
      .join(', ')}`,
  );
}
const unexpectedOptionalComputational = computational.dependencies.filter(
  (dependency) => dependency.optional && dependency.name !== 'opencv',
);
if (unexpectedOptionalComputational.length > 0) {
  throw new Error(
    `unexpected optional computational implementation: ${unexpectedOptionalComputational
      .map(({ name }) => name)
      .join(', ')}`,
  );
}
if (
  app.dependencies.some(
    (dependency) => dependency.kind === null && (dependency.name === 'opencv' || dependency.name === 'image-hdr'),
  )
) {
  throw new Error('OpenCV/image-hdr implementation must not be a normal RapidRAW application dependency.');
}
if (!app.features['advanced-codecs']?.includes('rapidraw-codecs/advanced')) {
  throw new Error('RapidRAW advanced-codecs feature must acquire the codec leaf advanced capability.');
}

const jpegTree = Bun.spawnSync(
  [
    'cargo',
    'tree',
    '--manifest-path',
    'src-tauri/Cargo.toml',
    '-p',
    'rapidraw-codecs',
    '--no-default-features',
    '--features',
    'jpeg',
    '--prefix',
    'none',
  ],
  { stderr: 'pipe', stdout: 'pipe' },
);
if (jpegTree.exitCode !== 0) throw new Error(jpegTree.stderr.toString().trim());
const baselineGraph = new Set(
  jpegTree.stdout
    .toString()
    .split('\n')
    .map((line) => line.split(' ')[0])
    .filter(Boolean),
);
const advancedLeak = ['image', 'jxl-encoder', 'jxl-oxide', 'webp'].filter((name) => baselineGraph.has(name));
if (advancedLeak.length > 0) {
  throw new Error(`advanced codec leaked into baseline JPEG graph: ${advancedLeak.join(', ')}`);
}

console.log('native computational/codec feature leaves ok');
