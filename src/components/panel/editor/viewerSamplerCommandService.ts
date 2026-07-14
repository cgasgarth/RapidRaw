import { Invokes } from '../../../tauri/commands';
import { invokeWithSchema } from '../../../utils/tauriSchemaInvoke';
import {
  type ViewerSampleRequest,
  type ViewerSampleResult,
  viewerSampleResultSchema,
} from '../../../utils/viewerSampler';

export type ViewerSamplerInvoke = (request: ViewerSampleRequest) => Promise<ViewerSampleResult>;

export interface ViewerSamplerCommandService {
  sample(request: ViewerSampleRequest): Promise<ViewerSampleResult>;
}

const invokeViewerSampler: ViewerSamplerInvoke = (request) =>
  invokeWithSchema(Invokes.SampleViewerPixel, { request }, viewerSampleResultSchema);

/** Typed native command boundary for viewer sampling; no view owns native invocation details. */
export const createViewerSamplerCommandService = (
  invoke: ViewerSamplerInvoke = invokeViewerSampler,
): ViewerSamplerCommandService => ({
  sample: (request) => invoke(request),
});
