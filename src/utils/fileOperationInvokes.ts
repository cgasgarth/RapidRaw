import { invokeWithSchema } from './tauriSchemaInvoke';
import { Invokes } from '../components/ui/AppProperties';
import {
  fileOperationPathListSchema,
  renameFilesRequestSchema,
  type FileOperationPathList,
  type RenameFilesRequest,
} from '../schemas/fileOperationSchemas';

export function renameFilesWithSchema(request: RenameFilesRequest): Promise<FileOperationPathList> {
  const args = renameFilesRequestSchema.parse(request);
  return invokeWithSchema(Invokes.RenameFiles, args, fileOperationPathListSchema, Invokes.RenameFiles);
}
