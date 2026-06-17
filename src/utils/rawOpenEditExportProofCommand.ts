import { invokeWithSchema } from './tauriSchemaInvoke';
import { Invokes } from '../components/ui/AppProperties';
import {
  rawOpenEditExportProofReportSchema,
  rawOpenEditExportProofRequestSchema,
  type RawOpenEditExportProofReport,
  type RawOpenEditExportProofRequest,
} from '../schemas/rawOpenEditExportCommandSchemas';

export async function runRawOpenEditExportProofCommand(
  request: RawOpenEditExportProofRequest,
): Promise<RawOpenEditExportProofReport> {
  const parsedRequest = rawOpenEditExportProofRequestSchema.parse(request);
  return invokeWithSchema(
    Invokes.RunRawOpenEditExportProof,
    { request: parsedRequest },
    rawOpenEditExportProofReportSchema,
    Invokes.RunRawOpenEditExportProof,
  );
}
