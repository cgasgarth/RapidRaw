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
  importFilesRequestSchema,
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

export function importFilesWithSchema(request: ImportFilesRequest): Promise<void> {
  return invokeFileOperationVoid(Invokes.ImportFiles, importFilesRequestSchema.parse(request));
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
