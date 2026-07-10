import type { ExportReceipt } from '../../components/ui/ExportImportProperties';

export const hasCommittedExportOutputs = (receipt: Pick<ExportReceipt, 'outputs'>) => receipt.outputs.length > 0;

export const shouldRefreshLibraryForExportReceipt = (
  receipt: Pick<ExportReceipt, 'outputs'>,
  currentFolderPath: string | null,
) => {
  if (currentFolderPath === null || currentFolderPath.startsWith('Album: ')) return false;
  const normalizedFolderPath = currentFolderPath.replace(/[\\/]+$/u, '');
  const folderPrefix = `${normalizedFolderPath}/`;
  const windowsFolderPrefix = `${normalizedFolderPath}\\`;
  return receipt.outputs.some(
    (output) =>
      output.outputPath === normalizedFolderPath ||
      output.outputPath.startsWith(folderPrefix) ||
      output.outputPath.startsWith(windowsFolderPrefix),
  );
};
