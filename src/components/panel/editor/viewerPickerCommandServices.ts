import { Invokes } from '../../../tauri/commands';
import { type PointColorPickerResponse, pointColorPickerResponseSchema } from '../../../utils/color/pointColorPicker';
import { invokeWithSchema } from '../../../utils/tauriSchemaInvoke';
import {
  type ToneEqualizerPickerResponse,
  toneEqualizerPickerResponseSchema,
} from '../../../utils/toneEqualizerPicker';

export interface ViewerPickerCommandServices {
  samplePointColor(request: Record<string, unknown>): Promise<PointColorPickerResponse>;
  sampleToneEqualizer(request: Record<string, unknown>): Promise<ToneEqualizerPickerResponse>;
}

export interface ViewerPickerInvoker {
  samplePointColor(request: Record<string, unknown>): Promise<PointColorPickerResponse>;
  sampleToneEqualizer(request: Record<string, unknown>): Promise<ToneEqualizerPickerResponse>;
}

const nativeViewerPickerInvoker: ViewerPickerInvoker = {
  samplePointColor: (request) =>
    invokeWithSchema(Invokes.SamplePointColorPicker, { request }, pointColorPickerResponseSchema),
  sampleToneEqualizer: (request) =>
    invokeWithSchema(Invokes.SampleToneEqualizerPicker, { request }, toneEqualizerPickerResponseSchema),
};

/** Typed native command boundary for picker tools; view code supplies semantic requests only. */
export const createViewerPickerCommandServices = (
  invoker: ViewerPickerInvoker = nativeViewerPickerInvoker,
): ViewerPickerCommandServices => ({
  samplePointColor: (request) => invoker.samplePointColor(request),
  sampleToneEqualizer: (request) => invoker.sampleToneEqualizer(request),
});
