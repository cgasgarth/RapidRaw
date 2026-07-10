import type { ExportReceipt } from '../../components/ui/ExportImportProperties';

export const hasCommittedExportOutputs = (receipt: Pick<ExportReceipt, 'outputs'>) => receipt.outputs.length > 0;

const receiptOutputPaths = (receipt: Pick<ExportReceipt, 'outputs'>) =>
  receipt.outputs.flatMap((output) => [
    output.outputPath,
    ...(output.auxiliaryOutputPaths ?? []),
    ...(output.rawProvenanceSidecarPath === null || output.rawProvenanceSidecarPath === undefined
      ? []
      : [output.rawProvenanceSidecarPath]),
  ]);

export const shouldRefreshLibraryForExportReceipt = (
  receipt: Pick<ExportReceipt, 'outputs'>,
  currentFolderPath: string | null,
) => {
  if (currentFolderPath === null || currentFolderPath.startsWith('Album: ')) return false;
  const normalizedFolderPath = currentFolderPath.replace(/[\\/]+$/u, '');
  const folderPrefix = `${normalizedFolderPath}/`;
  const windowsFolderPrefix = `${normalizedFolderPath}\\`;
  return receiptOutputPaths(receipt).some(
    (outputPath) =>
      outputPath === normalizedFolderPath ||
      outputPath.startsWith(folderPrefix) ||
      outputPath.startsWith(windowsFolderPrefix),
  );
};
