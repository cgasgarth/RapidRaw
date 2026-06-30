import type { ComputationalMergeE2eProofManifest } from '../../schemas/computationalMergeE2eProofSchemas';
import {
  type ComputationalMergePrivateSourceSetCollection,
  computationalMergePrivateSourceSetCollectionSchema,
} from '../../schemas/computationalMergeSourceSetSchemas';
import type { PrivateRawEvidenceLedger } from '../../schemas/privateRawEvidenceSchemas';

const privatePathPrefixes = ['private-fixtures/', 'private-artifacts/'] as const;
const sourceSetFeatureFamilies = new Set(['focus_stack', 'panorama_stitch', 'super_resolution']);

export function buildComputationalMergePrivateSourceSets(
  manifest: ComputationalMergeE2eProofManifest,
  ledger: PrivateRawEvidenceLedger,
): ComputationalMergePrivateSourceSetCollection {
  const ledgerEntriesByEvidenceId = new Map(ledger.entries.map((entry) => [entry.evidenceId, entry]));

  return computationalMergePrivateSourceSetCollectionSchema.parse({
    issue: 1811,
    schemaVersion: 1,
    sourceSets: manifest.proofCases
      .filter((proofCase) => sourceSetFeatureFamilies.has(proofCase.featureFamily))
      .map((proofCase) => {
        const ledgerEntry = ledgerEntriesByEvidenceId.get(proofCase.evidenceId);
        if (ledgerEntry === undefined) {
          throw new Error(`${proofCase.fixtureId}: missing ledger entry ${proofCase.evidenceId}.`);
        }

        return {
          evidenceId: proofCase.evidenceId,
          featureFamily: proofCase.featureFamily,
          fixtureId: proofCase.fixtureId,
          implementationIssue: proofCase.implementationIssue,
          proofStatus: proofCase.proofStatus,
          sourceItems: proofCase.localSourceRelativePaths.map((localRelativePath, sourceIndex) => ({
            expectedRawFormat: ledgerEntry.camera.rawFormat,
            localRelativePath: assertPrivateSourcePath(localRelativePath, proofCase.fixtureId),
            publicRepoAllowed: false,
            sourceIndex,
          })),
          uiIssue: proofCase.uiIssue,
        };
      }),
  });
}

function assertPrivateSourcePath(localRelativePath: string, fixtureId: string): string {
  if (privatePathPrefixes.some((prefix) => localRelativePath.startsWith(prefix))) {
    return localRelativePath;
  }
  throw new Error(`${fixtureId}: source path must stay under a private fixture/artifact prefix.`);
}
