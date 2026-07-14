import { focusRetouchSessionSchema } from '../../../schemas/focus-stack/focusStackRetouchSchemas';
import { Invokes } from '../../../tauri/commands';

export interface FocusRetouchStrokeRequest {
  expectedRevisionId: string | null;
  packagePath: string;
  stroke: {
    hardnessU16: number;
    pointsFixed1256Px: ReadonlyArray<{ x: number; y: number }>;
    radiusFixed1256Px: number;
    sourceIndex: number | null;
    strokeId: string;
  };
}

export type FocusRetouchSession = ReturnType<typeof focusRetouchSessionSchema.parse>;
export type FocusRetouchInvoker = (request: FocusRetouchStrokeRequest) => Promise<unknown>;

export interface FocusRetouchCommandService {
  applyStroke(request: FocusRetouchStrokeRequest): Promise<FocusRetouchSession>;
}

const invokeFocusRetouch: FocusRetouchInvoker = async (request) => {
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke(Invokes.ApplyFocusStackRetouch, { request });
};

/** Typed native boundary for focus-stack retouch; the view receives a validated session only. */
export const createFocusRetouchCommandService = (
  invokeRequest: FocusRetouchInvoker = invokeFocusRetouch,
): FocusRetouchCommandService => ({
  applyStroke: async (request) => focusRetouchSessionSchema.parse(await invokeRequest(request)),
});
