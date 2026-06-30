import {
  type LibraryBackupFileEntry,
  type LibraryBackupManifest,
  parseLibraryBackupManifest,
} from '../schemas/libraryBackupSchemas';
import { type LibrarySessionSet, librarySessionSetSchema } from '../schemas/librarySessionSchemas';

interface BuildLibraryBackupManifestInput {
  backupId: string;
  createdAt: string;
  excludedOriginalPaths: string[];
  files: LibraryBackupFileEntry[];
  includeOriginals: boolean;
  manifestHash: string;
  sessionId: string;
  sessionSet: LibrarySessionSet;
  sourceSessionHash: string;
}

interface VerifyLibraryBackupRestoreInput {
  manifest: LibraryBackupManifest;
  restoredFiles: LibraryBackupFileEntry[];
  restoredSessionSet: LibrarySessionSet;
}

export const buildLibraryBackupManifest = (input: BuildLibraryBackupManifestInput): LibraryBackupManifest => {
  const sessionSet = librarySessionSetSchema.parse(input.sessionSet);
  const session = sessionSet.sessions.find((candidate) => candidate.id === input.sessionId);
  if (!session) {
    throw new Error(`${input.sessionId}: session missing from backup source.`);
  }

  const files = [...input.files].sort((left, right) => left.originalPath.localeCompare(right.originalPath));

  return parseLibraryBackupManifest({
    backupId: input.backupId,
    createdAt: input.createdAt,
    excludedOriginalPaths: [...input.excludedOriginalPaths].sort((left, right) => left.localeCompare(right)),
    fileCount: files.length,
    files,
    includeOriginals: input.includeOriginals,
    manifestHash: input.manifestHash,
    schemaVersion: 1,
    sessionId: input.sessionId,
    sourceSessionHash: input.sourceSessionHash,
    totalBytes: files.reduce((sum, file) => sum + file.byteLength, 0),
  });
};

export const verifyLibraryBackupRestore = ({
  manifest,
  restoredFiles,
  restoredSessionSet,
}: VerifyLibraryBackupRestoreInput): void => {
  const restoredSession = restoredSessionSet.sessions.find((candidate) => candidate.id === manifest.sessionId);
  if (!restoredSession) {
    throw new Error(`${manifest.sessionId}: session missing after restore.`);
  }

  const restoredByPath = new Map(restoredFiles.map((file) => [file.originalPath, file]));
  for (const expectedFile of manifest.files) {
    const restoredFile = restoredByPath.get(expectedFile.originalPath);
    if (!restoredFile) {
      throw new Error(`${expectedFile.originalPath}: missing from restored backup.`);
    }
    if (restoredFile.contentHash !== expectedFile.contentHash || restoredFile.byteLength !== expectedFile.byteLength) {
      throw new Error(`${expectedFile.originalPath}: restored file hash or size changed.`);
    }
  }
};
