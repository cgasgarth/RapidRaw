import { invokeWithSchema } from './tauriSchemaInvoke';
import {
  rawOpenEditExportProofReportSchema,
  rawOpenEditExportProofRequestSchema,
  type RawOpenEditExportProofReport,
  type RawOpenEditExportProofRequest,
} from '../schemas/rawOpenEditExportCommandSchemas';

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
