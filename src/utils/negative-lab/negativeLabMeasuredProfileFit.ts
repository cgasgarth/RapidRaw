import {
  type NegativeLabMeasuredProfile,
  negativeLabMeasuredProfileSchema,
  negativeLabProfileFitReceiptSchema,
} from '../../schemas/negative-lab/negativeLabMeasuredProfileSchemas';
import {
  type NegativeLabPresetParams,
  negativeLabPresetParamsSchema,
} from '../../schemas/negative-lab/negativeLabPresetCatalogSchemas';
import { Invokes } from '../../tauri/commands';
import { invokeWithSchema } from '../tauriSchemaInvoke';

export interface NegativeLabCalibrationPatchV1 {
  expectedRgb: [number, number, number];
  independentColorPatch: boolean;
  observedRgb: [number, number, number];
  clipped?: boolean;
}

export const fitNegativeLabMeasuredProfile = async ({
  patches,
  sourceInterpretationHash,
  targetLayoutId = 'rawengine_negative_lab_target_v1',
}: {
  patches: NegativeLabCalibrationPatchV1[];
  sourceInterpretationHash: string;
  targetLayoutId?: 'rawengine_negative_lab_target_v1';
}) =>
  invokeWithSchema(
    Invokes.FitNegativeLabMeasuredProfile,
    {
      request: {
        patches,
        schemaVersion: 1,
        sourceInterpretationHash,
        targetLayoutId,
      },
    },
    negativeLabProfileFitReceiptSchema,
    Invokes.FitNegativeLabMeasuredProfile,
  );

export const buildNegativeLabMeasuredProfileFromFit = ({
  baseParams,
  displayName,
  evidenceFixtureIds,
  evidenceFixtureHashes,
  filmClass = 'color_negative',
  processFamily = 'c41_color_negative',
  profileId,
  receipt,
  sourceGenericPresetId,
}: {
  baseParams: NegativeLabPresetParams;
  displayName: string;
  evidenceFixtureIds: string[];
  evidenceFixtureHashes: string[];
  filmClass?: 'color_negative' | 'black_and_white_silver';
  processFamily?: 'c41_color_negative' | 'black_and_white_silver_negative';
  profileId: `negative_lab.measured.${'c41' | 'bw'}.${string}.v1`;
  receipt: ReturnType<typeof negativeLabProfileFitReceiptSchema.parse>;
  sourceGenericPresetId: NegativeLabPresetParams extends never ? never : string;
}): NegativeLabMeasuredProfile => {
  const fittedParams = negativeLabPresetParamsSchema.parse({
    ...baseParams,
    base_fog_strength: receipt.fittedParams.baseFogStrength,
    blue_weight: receipt.fittedParams.blueWeight,
    contrast: receipt.fittedParams.contrast,
    green_weight: receipt.fittedParams.greenWeight,
    red_weight: receipt.fittedParams.redWeight,
  });
  const runtimeApplied = receipt.claimStatus === 'runtime_parameter_applied';
  const limitations = ['no_stock_emulation_claim', 'no_colorimetric_match_claim'];
  if (!runtimeApplied) limitations.push('schema_only', 'no_runtime_profile_resolver');
  return negativeLabMeasuredProfileSchema.parse({
    claimLevel: 'measured_profile',
    claimPolicy: 'process_family_profile_no_stock_claim',
    calibrationMethod: 'density_curve_process_family_v1',
    crosstalkProfile: null,
    displayName,
    doesNotProve: limitations,
    evidenceDigest: {
      fixtureLegalStatus: 'project_owned_private_ci',
      renderProofStatus: runtimeApplied ? 'runtime_route_verified' : 'metadata_only',
      sourceFixtureContentHashes: evidenceFixtureHashes,
    },
    evidenceFixtureIds,
    filmClass,
    measurementProfileId: profileId,
    measurementSource: 'fixture_measured_profile',
    params: fittedParams,
    processFamily,
    profileId,
    profileStatus: 'fixture_measured',
    runtimeLimitations: limitations,
    runtimeStatus: runtimeApplied ? 'runtime_parameter_applied' : 'ui_catalog_only',
    sourceGenericPresetId,
  });
};
