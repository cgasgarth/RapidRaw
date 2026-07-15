const metadataFingerprints = new Map<string, string>();

export function acceptImageOpenMetadataRevision(path: string, fingerprint: string): boolean {
  const previous = metadataFingerprints.get(path);
  metadataFingerprints.set(path, fingerprint);
  return previous !== fingerprint;
}

function clearImageOpenMetadataRevisions(): void {
  metadataFingerprints.clear();
}
