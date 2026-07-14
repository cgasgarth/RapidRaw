export interface StartupManifestIdentity {
  file: string;
  name?: string;
  src?: string;
}

const forbiddenStartupDependencies = ['react', 'react-dom', 'zod'] as const;

/** Matches semantic Vite manifest identities, never opaque emitted content hashes. */
export function findForbiddenStartupDependency(
  manifestKey: string,
  chunk: StartupManifestIdentity,
): (typeof forbiddenStartupDependencies)[number] | undefined {
  const identity = [manifestKey, chunk.name, chunk.src].filter(Boolean).join('\n').toLowerCase();
  return forbiddenStartupDependencies.find((dependency) => identity.includes(dependency));
}
