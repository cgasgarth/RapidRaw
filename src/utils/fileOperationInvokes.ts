import { invokeWithSchema } from './tauriSchemaInvoke';
import {
  copyMoveFilesRequestSchema,
  createFolderRequestSchema,
  deleteFilesRequestSchema,
  fileOperationPathListSchema,
  fileOperationPathSchema,
  fileOperationVoidResponseSchema,
  importFilesRequestSchema,
  renameFilesRequestSchema,
  renameFolderRequestSchema,
  resolveAndroidContentUriNameRequestSchema,
  type CopyMoveFilesRequest,
  type CreateFolderRequest,
  type DeleteFilesRequest,
  type FileOperationPathList,
  type ImportFilesRequest,
  type RenameFilesRequest,
  type RenameFolderRequest,
  type ResolveAndroidContentUriNameRequest,
} from '../schemas/fileOperationSchemas';
import { Invokes } from '../tauri/commands';

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
