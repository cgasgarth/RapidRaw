import type { TFunction } from 'i18next';

import { FILE_FORMATS, type FileFormat, type FileFormats } from '../../../ui/ExportImportProperties';

interface ExportDestinationInput {
  fileFormat: FileFormats;
  filenameTemplate: string;
  isAndroid: boolean;
  lastExportPath?: string;
  pathsToExport: string[];
  t: TFunction;
}

interface ExportDestinationDependencies {
  saveFile: (options: {
    defaultPath: string;
    filters: Array<{ extensions: string[]; name: string }>;
    title: string;
  }) => Promise<string | null>;
  selectFolder: (options: { defaultPath?: string; directory: true; title: string }) => Promise<string | null>;
}

export interface ExportDestination {
  finalFilenameTemplate: string;
  lastExportDirectory: string | null;
  outputFolderOrFile: string;
  selectedFormat: FileFormat;
}

export async function chooseExportDestination(
  { fileFormat, filenameTemplate, isAndroid, lastExportPath, pathsToExport, t }: ExportDestinationInput,
  { saveFile, selectFolder }: ExportDestinationDependencies,
): Promise<ExportDestination | null> {
  const selectedFormat = FILE_FORMATS.find((format) => format.id === fileFormat);
  if (selectedFormat === undefined) throw new Error(t('export.status.failed'));

  const finalFilenameTemplate = normalizeFilenameTemplate(filenameTemplate, pathsToExport.length);
  const outputFolderOrFile =
    pathsToExport.length === 1
      ? await chooseSingleFile({
          finalFilenameTemplate,
          isAndroid,
          ...(lastExportPath === undefined ? {} : { lastExportPath }),
          path: pathsToExport[0] ?? '',
          saveFile,
          selectedFormat,
          t,
        })
      : await chooseBatchFolder({
          isAndroid,
          ...(lastExportPath === undefined ? {} : { lastExportPath }),
          selectFolder,
          total: pathsToExport.length,
          t,
        });

  if (!isAndroid && outputFolderOrFile === null) return null;
  const resolvedOutput = outputFolderOrFile ?? '';

  return {
    finalFilenameTemplate,
    lastExportDirectory: isAndroid
      ? null
      : pathsToExport.length === 1
        ? parentDirectory(resolvedOutput)
        : resolvedOutput,
    outputFolderOrFile: resolvedOutput,
    selectedFormat,
  };
}

export function normalizeFilenameTemplate(filenameTemplate: string, imageCount: number): string {
  if (imageCount > 1 && !filenameTemplate.includes('{sequence}') && !filenameTemplate.includes('{original_filename}')) {
    return `${filenameTemplate}_{sequence}`;
  }
  return filenameTemplate;
}

async function chooseSingleFile({
  finalFilenameTemplate,
  isAndroid,
  lastExportPath,
  path,
  saveFile,
  selectedFormat,
  t,
}: {
  finalFilenameTemplate: string;
  isAndroid: boolean;
  lastExportPath?: string;
  path: string;
  saveFile: ExportDestinationDependencies['saveFile'];
  selectedFormat: FileFormat;
  t: TFunction;
}): Promise<string | null> {
  const originalFilename = path.split(/[\\/]/).pop() || '';
  const stem = originalFilename.substring(0, originalFilename.lastIndexOf('.')) || originalFilename;
  const suggestedName = finalFilenameTemplate.replace('{original_filename}', stem);
  const extension = selectedFormat.extensions[0] ?? selectedFormat.id;
  const outputFileName = `${suggestedName}.${extension}`;
  if (isAndroid) return outputFileName;

  return saveFile({
    defaultPath: lastExportPath ? `${lastExportPath}/${outputFileName}` : outputFileName,
    filters: [
      { name: selectedFormat.name, extensions: selectedFormat.extensions },
      ...FILE_FORMATS.filter((format) => format.id !== selectedFormat.id).map((format) => ({
        name: format.name,
        extensions: format.extensions,
      })),
    ],
    title: t('export.dialog.saveEditedImageTitle'),
  });
}

function chooseBatchFolder({
  isAndroid,
  lastExportPath,
  selectFolder,
  t,
  total,
}: {
  isAndroid: boolean;
  lastExportPath?: string;
  selectFolder: ExportDestinationDependencies['selectFolder'];
  t: TFunction;
  total: number;
}): Promise<string | null> {
  if (isAndroid) return Promise.resolve('');
  return selectFolder({
    ...(lastExportPath ? { defaultPath: lastExportPath } : {}),
    directory: true,
    title: t('export.dialog.selectFolderTitle', { count: total }),
  });
}

function parentDirectory(path: string): string | null {
  const separator = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
  return separator > 0 ? path.substring(0, separator) : null;
}
