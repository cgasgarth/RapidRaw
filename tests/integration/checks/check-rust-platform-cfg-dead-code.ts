const sourcePath = 'src-tauri/src/color/display_profile.rs';
const source = await Bun.file(sourcePath).text();

const enumMatch = source.match(/pub enum DisplayPreviewLutTransformStatus \{(?<body>[\s\S]*?)\n\}/);

if (!enumMatch?.groups?.body) {
  throw new Error(`${sourcePath}: missing DisplayPreviewLutTransformStatus enum.`);
}

const body = enumMatch.groups.body;
const requiredCfgByVariant = new Map([
  ['ActiveDisplayTransform', 'target_os = "linux"'],
  ['SrgbFallbackTransform', 'target_os = "linux"'],
]);

const failures: string[] = [];

for (const [variant, requiredCfg] of requiredCfgByVariant) {
  const variantMatch = body.match(new RegExp(`(?<prefix>(?:\\s*#\\[[^\\n]+\\]\\n)*)\\s*${variant},`));

  if (!variantMatch?.groups?.prefix) {
    failures.push(`${variant}: missing cfg guard before platform-specific variant.`);
    continue;
  }

  if (!variantMatch.groups.prefix.includes(requiredCfg)) {
    failures.push(`${variant}: cfg guard must exclude ${requiredCfg}.`);
  }
}

if (failures.length > 0) {
  throw new Error(
    [
      'Rust platform cfg dead-code guard failed.',
      ...failures.map((failure) => `- ${failure}`),
      'Linux main validation runs cargo clippy with -D warnings; platform-only variants must be cfg-gated locally.',
    ].join('\n'),
  );
}

console.log('rust platform cfg dead-code guard ok');
