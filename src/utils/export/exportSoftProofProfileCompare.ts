import { z } from 'zod';
import type { ExportColorCapabilityCatalogV1 } from '../../../packages/rawengine-schema/src/exportColorCapabilities';
import {
  ExportColorProfile,
  type ExportPreset,
  ExportRenderingIntent,
  type FileFormats,
} from '../../components/ui/ExportImportProperties';
import type { ExportSoftProofTransformState } from '../../store/useEditorStore';
import { getSupportedRenderingIntents, isSupportedColorProfileForFormat } from './exportColorCapabilityContracts';

export const EXPORT_SOFT_PROOF_PROFILE_COMPARE_TARGET_RESOLUTION = 1024;
export const EXPORT_SOFT_PROOF_RESOLVER_PRESET_ID = 'internal-soft-proof-export-resolver';

export type ExportSoftProofProfileCompareSideId = 'srgb' | 'displayP3';

export interface ExportSoftProofProfileCompareRequest extends Record<string, unknown> {
  blackPointCompensation: boolean;
  colorProfile: ExportColorProfile;
  jsAdjustments: unknown;
  renderingIntent: ExportRenderingIntent;
  targetResolution: number;
}

export interface ExportSoftProofProfileCompareSideRequest {
  label: string;
  request: ExportSoftProofProfileCompareRequest;
  side: ExportSoftProofProfileCompareSideId;
}

export interface ExportSoftProofProfileCompareUnavailableState {
  error: string;
  requestedColorProfile: ExportColorProfile;
  requestedRenderingIntent: ExportRenderingIntent;
  side: ExportSoftProofProfileCompareSideId;
}

export interface ExportSoftProofProfileCompareProof {
  colorManagedTransform: string | null;
  effectiveColorProfile: string | null;
  effectiveRenderingIntent: string | null;
  label: string;
  previewHash: string;
  previewUrl: string;
  proofRole: string;
  requestedColorProfile: ExportColorProfile;
  requestedRenderingIntent: ExportRenderingIntent;
  side: ExportSoftProofProfileCompareSideId;
  sourcePrecisionPath: string | null;
  transformApplied: boolean | null;
  transformPolicyFingerprint: string | null;
}

export type ExportSoftProofProfileCompareSideState =
  | { side: ExportSoftProofProfileCompareSideId; status: 'idle' | 'loading' }
  | {
      error: string;
      requestedColorProfile: ExportColorProfile;
      requestedRenderingIntent: ExportRenderingIntent;
      side: ExportSoftProofProfileCompareSideId;
      status: 'unavailable';
    }
  | {
      proof: ExportSoftProofProfileCompareProof;
      side: ExportSoftProofProfileCompareSideId;
      status: 'ready';
    };

export const exportSoftProofTransformResponseSchema = z
  .object({
    blackPointCompensation: z.string().trim().min(1),
    colorManagedTransform: z.string().trim().min(1),
    effectiveColorProfile: z.string().trim().min(1),
    effectiveRenderingIntent: z.string().trim().min(1),
    policyStatus: z.string().trim().min(1),
    policyVersion: z.string().trim().min(1),
    sourcePrecisionPath: z.string().trim().min(1),
    transformApplied: z.boolean(),
    transformPolicyFingerprint: z
      .string()
      .trim()
      .regex(/^sha256:/u),
  })
  .transform(
    (metadata): ExportSoftProofTransformState => ({
      blackPointCompensation: metadata.blackPointCompensation,
      colorManagedTransform: metadata.colorManagedTransform,
      effectiveColorProfile: metadata.effectiveColorProfile,
      effectiveRenderingIntent: metadata.effectiveRenderingIntent,
      policyStatus: metadata.policyStatus,
      policyVersion: metadata.policyVersion,
      sourcePrecisionPath: metadata.sourcePrecisionPath,
      transformApplied: metadata.transformApplied,
      transformPolicyFingerprint: metadata.transformPolicyFingerprint,
    }),
  );

export const createInitialSoftProofProfileCompareState = (): Record<
  ExportSoftProofProfileCompareSideId,
  ExportSoftProofProfileCompareSideState
> => ({
  displayP3: { side: 'displayP3', status: 'idle' },
  srgb: { side: 'srgb', status: 'idle' },
});

export const buildSoftProofProfileCompareRequests = ({
  blackPointCompensation,
  jsAdjustments,
  renderingIntent,
  targetResolution = EXPORT_SOFT_PROOF_PROFILE_COMPARE_TARGET_RESOLUTION,
}: {
  blackPointCompensation: boolean;
  jsAdjustments: unknown;
  renderingIntent: ExportRenderingIntent;
  targetResolution?: number;
}): ExportSoftProofProfileCompareSideRequest[] => [
  {
    label: 'sRGB',
    request: {
      blackPointCompensation,
      colorProfile: ExportColorProfile.Srgb,
      jsAdjustments,
      renderingIntent,
      targetResolution,
    },
    side: 'srgb',
  },
  {
    label: 'Display P3',
    request: {
      blackPointCompensation,
      colorProfile: ExportColorProfile.DisplayP3,
      jsAdjustments,
      renderingIntent,
      targetResolution,
    },
    side: 'displayP3',
  },
];

export const buildSoftProofProfileCompareInvokeRequest = (
  request: ExportSoftProofProfileCompareRequest,
): {
  request: ExportSoftProofProfileCompareRequest;
} => ({
  request,
});

export const buildSoftProofProfileCompareUnavailableState = ({
  error,
  requestedColorProfile,
  requestedRenderingIntent,
  side,
}: ExportSoftProofProfileCompareUnavailableState): ExportSoftProofProfileCompareSideState => ({
  error,
  requestedColorProfile,
  requestedRenderingIntent,
  side,
  status: 'unavailable',
});

export const hashSoftProofPreviewBuffer = (buffer: ArrayBuffer): string => {
  const bytes = new Uint8Array(buffer);
  let hash = 0x811c9dc5;
  for (const byte of bytes) {
    hash ^= byte;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `fnv1a32:${hash.toString(16).padStart(8, '0')}`;
};

export const describeSoftProofProfileRole = ({
  requestedColorProfile,
  requestedRenderingIntent,
  transformApplied,
}: {
  requestedColorProfile: ExportColorProfile;
  requestedRenderingIntent: ExportRenderingIntent;
  transformApplied: boolean | null;
}): string => {
  if (requestedColorProfile === ExportColorProfile.Srgb) {
    if (requestedRenderingIntent === ExportRenderingIntent.Perceptual) return 'srgb-perceptual-gamut-map';
    return transformApplied ? 'srgb-managed-transform' : 'srgb-relative-identity';
  }

  if (requestedColorProfile === ExportColorProfile.DisplayP3) {
    return transformApplied ? 'display-p3-managed-transform' : 'display-p3-unavailable-or-identity';
  }

  return transformApplied ? 'managed-transform' : 'identity-transform';
};

export const buildSoftProofProfileCompareProof = ({
  buffer,
  label,
  metadata,
  previewUrl,
  request,
  side,
}: {
  buffer: ArrayBuffer;
  label: string;
  metadata: ExportSoftProofTransformState;
  previewUrl: string;
  request: ExportSoftProofProfileCompareRequest;
  side: ExportSoftProofProfileCompareSideId;
}): ExportSoftProofProfileCompareProof => ({
  colorManagedTransform: metadata.colorManagedTransform,
  effectiveColorProfile: metadata.effectiveColorProfile,
  effectiveRenderingIntent: metadata.effectiveRenderingIntent,
  label,
  previewHash: hashSoftProofPreviewBuffer(buffer),
  previewUrl,
  proofRole: describeSoftProofProfileRole({
    requestedColorProfile: request.colorProfile,
    requestedRenderingIntent: request.renderingIntent,
    transformApplied: metadata.transformApplied,
  }),
  requestedColorProfile: request.colorProfile,
  requestedRenderingIntent: request.renderingIntent,
  side,
  sourcePrecisionPath: metadata.sourcePrecisionPath,
  transformApplied: metadata.transformApplied,
  transformPolicyFingerprint: metadata.transformPolicyFingerprint,
});

export const getSoftProofProfileCompareStatus = (
  states: Record<ExportSoftProofProfileCompareSideId, ExportSoftProofProfileCompareSideState>,
): 'idle' | 'loading' | 'ready' | 'unavailable' => {
  const sides = Object.values(states);
  if (sides.some((side) => side.status === 'loading')) return 'loading';
  if (sides.some((side) => side.status === 'unavailable')) return 'unavailable';
  if (sides.every((side) => side.status === 'ready')) return 'ready';
  return 'idle';
};

export interface ExportSoftProofResolverStatus {
  canPreviewCurrentExportSettings: boolean;
  canUseCurrentSoftProofForExport: boolean;
  currentProofPreset: ExportPreset | null;
  isCurrentProofExportConsistent: boolean;
  parityStatus: 'matched' | 'mismatch' | 'pending' | 'unsupported';
  unsupportedReason:
    | 'missing-app-settings'
    | 'missing-proof-preset'
    | 'unsupported-profile-format'
    | 'unsupported-rendering-intent'
    | null;
}

export const buildExportSoftProofResolverPreset = ({
  currentSettings,
  name,
}: {
  currentSettings: Omit<ExportPreset, 'id' | 'name'>;
  name: string;
}): ExportPreset => ({
  ...currentSettings,
  id: EXPORT_SOFT_PROOF_RESOLVER_PRESET_ID,
  name,
});

export const upsertExportSoftProofResolverPreset = ({
  currentSettings,
  name,
  presets,
}: {
  currentSettings: Omit<ExportPreset, 'id' | 'name'>;
  name: string;
  presets: ExportPreset[];
}): ExportPreset[] => {
  const resolverPreset = buildExportSoftProofResolverPreset({ currentSettings, name });
  const existingIndex = presets.findIndex((preset) => preset.id === EXPORT_SOFT_PROOF_RESOLVER_PRESET_ID);
  if (existingIndex === -1) return [...presets, resolverPreset];
  return presets.map((preset, index) => (index === existingIndex ? resolverPreset : preset));
};

export const getExportSoftProofResolverStatus = ({
  appSettingsAvailable,
  catalog,
  currentExportBlackPointCompensation,
  currentExportColorProfile,
  currentExportRenderingIntent,
  exportSoftProofRecipeId,
  exportSoftProofTransform,
  fileFormat,
  isExportSoftProofEnabled,
  proofPreset,
}: {
  appSettingsAvailable: boolean;
  catalog: ExportColorCapabilityCatalogV1;
  currentExportBlackPointCompensation: boolean;
  currentExportColorProfile: ExportColorProfile;
  currentExportRenderingIntent: ExportRenderingIntent;
  exportSoftProofRecipeId: string | null;
  exportSoftProofTransform: ExportSoftProofTransformState | null;
  fileFormat: FileFormats;
  isExportSoftProofEnabled: boolean;
  proofPreset: ExportPreset | null;
}): ExportSoftProofResolverStatus => {
  if (!appSettingsAvailable) {
    return {
      canPreviewCurrentExportSettings: false,
      canUseCurrentSoftProofForExport: false,
      currentProofPreset: null,
      isCurrentProofExportConsistent: false,
      parityStatus: 'unsupported',
      unsupportedReason: 'missing-app-settings',
    };
  }

  if (!proofPreset || !exportSoftProofRecipeId) {
    return {
      canPreviewCurrentExportSettings: true,
      canUseCurrentSoftProofForExport: false,
      currentProofPreset: null,
      isCurrentProofExportConsistent: false,
      parityStatus: 'pending',
      unsupportedReason: 'missing-proof-preset',
    };
  }

  const proofColorProfile = proofPreset.colorProfile ?? ExportColorProfile.Srgb;
  const proofRenderingIntent = proofPreset.renderingIntent ?? ExportRenderingIntent.RelativeColorimetric;
  const supportedIntents = getSupportedRenderingIntents(catalog, fileFormat, proofColorProfile);
  const supportsProofProfile = isSupportedColorProfileForFormat(fileFormat, proofColorProfile);
  const supportsProofIntent = supportedIntents.length === 0 || supportedIntents.includes(proofRenderingIntent);

  if (!supportsProofProfile) {
    return {
      canPreviewCurrentExportSettings: true,
      canUseCurrentSoftProofForExport: false,
      currentProofPreset: proofPreset,
      isCurrentProofExportConsistent: false,
      parityStatus: 'unsupported',
      unsupportedReason: 'unsupported-profile-format',
    };
  }

  if (!supportsProofIntent) {
    return {
      canPreviewCurrentExportSettings: true,
      canUseCurrentSoftProofForExport: false,
      currentProofPreset: proofPreset,
      isCurrentProofExportConsistent: false,
      parityStatus: 'unsupported',
      unsupportedReason: 'unsupported-rendering-intent',
    };
  }

  const isCurrentProofExportConsistent =
    isExportSoftProofEnabled &&
    proofColorProfile === currentExportColorProfile &&
    proofRenderingIntent === currentExportRenderingIntent &&
    (proofPreset.blackPointCompensation ?? false) === currentExportBlackPointCompensation &&
    exportSoftProofTransform !== null;

  return {
    canPreviewCurrentExportSettings: true,
    canUseCurrentSoftProofForExport: !isCurrentProofExportConsistent,
    currentProofPreset: proofPreset,
    isCurrentProofExportConsistent,
    parityStatus: isCurrentProofExportConsistent
      ? 'matched'
      : exportSoftProofTransform === null
        ? 'pending'
        : 'mismatch',
    unsupportedReason: null,
  };
};
