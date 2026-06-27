import { invokeWithSchema } from './tauriSchemaInvoke';
import {
  fileOperationPathListSchema,
  renameFilesRequestSchema,
  type FileOperationPathList,
  type RenameFilesRequest,
} from '../schemas/fileOperationSchemas';
import { Invokes } from '../tauri/commands';

export function renameFilesWithSchema(request: RenameFilesRequest): Promise<FileOperationPathList> {
  const args = renameFilesRequestSchema.parse(request);
  return invokeWithSchema(Invokes.RenameFiles, args, fileOperationPathListSchema, Invokes.RenameFiles);
}
