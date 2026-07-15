import { z } from 'zod';
import { Invokes } from '../../../tauri/commands';
import type { MaskOverlayInvokePayload } from '../../../utils/mask/maskOverlayRequest';
import { invokeWithSchema } from '../../../utils/tauriSchemaInvoke';

export type ViewerMaskOverlayInvoke = (payload: MaskOverlayInvokePayload) => Promise<string>;

export interface ViewerMaskOverlayCommandService {
  generate(payload: MaskOverlayInvokePayload): Promise<string>;
}

const invokeViewerMaskOverlay: ViewerMaskOverlayInvoke = (payload) =>
  invokeWithSchema(Invokes.GenerateMaskOverlay, { ...payload }, z.string());

/** Typed native boundary for mask-overlay generation; React views own no IPC details. */
export const createViewerMaskOverlayCommandService = (
  invoke: ViewerMaskOverlayInvoke = invokeViewerMaskOverlay,
): ViewerMaskOverlayCommandService => ({
  generate: (payload) => invoke(payload),
});
