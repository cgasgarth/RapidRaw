import {
  type RawOpenEditExportProofReport,
  type RawOpenEditExportProofRequest,
  rawOpenEditExportProofReportSchema,
  rawOpenEditExportProofRequestSchema,
} from '../schemas/rawOpenEditExportCommandSchemas';
import { invokeWithSchema } from './tauriSchemaInvoke';

const RAW_OPEN_EDIT_EXPORT_PROOF_COMMAND = 'run_raw_open_edit_export_proof';

export async function runRawOpenEditExportProofCommand(
  request: RawOpenEditExportProofRequest,
): Promise<RawOpenEditExportProofReport> {
  const parsedRequest = rawOpenEditExportProofRequestSchema.parse(request);
  return invokeWithSchema(
    RAW_OPEN_EDIT_EXPORT_PROOF_COMMAND,
    { request: parsedRequest },
    rawOpenEditExportProofReportSchema,
    RAW_OPEN_EDIT_EXPORT_PROOF_COMMAND,
  );
}
