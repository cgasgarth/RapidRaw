import { z } from 'zod';
import {
  type CopyMoveFilesRequest,
  type CreateFolderRequest,
  copyMoveFilesRequestSchema,
  createFolderRequestSchema,
  type DeleteFilesRequest,
  deleteFilesRequestSchema,
  type FileOperationPathList,
  fileOperationPathListSchema,
  fileOperationPathSchema,
  fileOperationVoidResponseSchema,
  type ImportFilesRequest,
  type ImportJobAuthority,
  type ImportResumeValidation,
  importFilesRequestSchema,
  importJobAuthoritySchema,
  importJobIdSchema,
  importResumeValidationSchema,
  type RenameFilesRequest,
  type RenameFolderRequest,
  type ResolveAndroidContentUriNameRequest,
  renameFilesRequestSchema,
  renameFolderRequestSchema,
  resolveAndroidContentUriNameRequestSchema,
} from '../schemas/fileOperationSchemas';
import { Invokes } from '../tauri/commands';
import { invokeWithSchema } from './tauriSchemaInvoke';

const invokeFileOperationVoid = (command: Invokes, args: Record<string, unknown>): Promise<void> =>
  invokeWithSchema(command, args, fileOperationVoidResponseSchema, command);

export function deleteFilesFromDiskWithSchema(request: DeleteFilesRequest): Promise<void> {
  return invokeFileOperationVoid(Invokes.DeleteFilesFromDisk, deleteFilesRequestSchema.parse(request));
}

export function deleteFilesWithAssociatedWithSchema(request: DeleteFilesRequest): Promise<void> {
  return invokeFileOperationVoid(Invokes.DeleteFilesWithAssociated, deleteFilesRequestSchema.parse(request));
}

export function createFolderWithSchema(request: CreateFolderRequest): Promise<void> {
  return invokeFileOperationVoid(Invokes.CreateFolder, createFolderRequestSchema.parse(request));
}

export function renameFolderWithSchema(request: RenameFolderRequest): Promise<void> {
  return invokeFileOperationVoid(Invokes.RenameFolder, renameFolderRequestSchema.parse(request));
}

export function renameFilesWithSchema(request: RenameFilesRequest): Promise<FileOperationPathList> {
  const args = renameFilesRequestSchema.parse(request);
  return invokeWithSchema(Invokes.RenameFiles, args, fileOperationPathListSchema, Invokes.RenameFiles);
}

export function importFilesWithSchema(request: ImportFilesRequest): Promise<ImportJobAuthority> {
  return invokeWithSchema(
    Invokes.ImportFiles,
    importFilesRequestSchema.parse(request),
    importJobAuthoritySchema,
    Invokes.ImportFiles,
  );
}

export function cancelImportWithSchema(authority: ImportJobAuthority): Promise<boolean> {
  return invokeWithSchema(
    Invokes.CancelImport,
    importJobAuthoritySchema.parse(authority),
    z.boolean(),
    Invokes.CancelImport,
  );
}

export function validateImportJobResumeWithSchema(jobId: string): Promise<ImportResumeValidation> {
  const args = { jobId: importJobIdSchema.parse(jobId) };
  return invokeWithSchema(
    Invokes.ValidateImportJobResume,
    args,
    importResumeValidationSchema,
    Invokes.ValidateImportJobResume,
  );
}

export function resumeImportJobWithSchema(jobId: string): Promise<ImportJobAuthority> {
  const args = { jobId: importJobIdSchema.parse(jobId) };
  return invokeWithSchema(Invokes.ResumeImportJob, args, importJobAuthoritySchema, Invokes.ResumeImportJob);
}

export function copyFilesWithSchema(request: CopyMoveFilesRequest): Promise<void> {
  return invokeFileOperationVoid(Invokes.CopyFiles, copyMoveFilesRequestSchema.parse(request));
}

export function moveFilesWithSchema(request: CopyMoveFilesRequest): Promise<void> {
  return invokeFileOperationVoid(Invokes.MoveFiles, copyMoveFilesRequestSchema.parse(request));
}

export function resolveAndroidContentUriNameWithSchema(request: ResolveAndroidContentUriNameRequest): Promise<string> {
  const args = resolveAndroidContentUriNameRequestSchema.parse(request);
  return invokeWithSchema(
    Invokes.ResolveAndroidContentUriName,
    args,
    fileOperationPathSchema,
    Invokes.ResolveAndroidContentUriName,
  );
}
