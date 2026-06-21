import { buildNegativeLabConversionPlanResult } from './negativeLabAppServerRoutes';
import {
  negativeLabConversionBundleSchema,
  type NegativeLabConversionBundle,
} from '../schemas/negativeLabConversionBundleSchemas';

export interface NegativeLabConversionBundleReplayProof {
  outputCount: number;
  outputFormat: NegativeLabConversionBundle['conversion']['outputFormat'];
  profileProvenanceHash: string;
  replayIdentityHash: string;
}

const numbersNear = (left: number, right: number) => Math.abs(left - right) < 0.000001;

const paramsNear = (
  left: NegativeLabConversionBundle['conversion']['params'],
  right: NegativeLabConversionBundle['conversion']['params'],
) =>
  numbersNear(left.base_fog_strength, right.base_fog_strength) &&
  numbersNear(left.blue_weight, right.blue_weight) &&
  numbersNear(left.contrast, right.contrast) &&
  numbersNear(left.exposure, right.exposure) &&
  numbersNear(left.green_weight, right.green_weight) &&
  numbersNear(left.red_weight, right.red_weight) &&
  JSON.stringify(left.base_fog_sample) === JSON.stringify(right.base_fog_sample);

export const validateNegativeLabConversionBundleReplay = (value: unknown): NegativeLabConversionBundleReplayProof => {
  const bundle = negativeLabConversionBundleSchema.parse(value);
  const selectedProfile = bundle.conversion.selectedProfile;

  if (selectedProfile === null || bundle.conversion.profileProvenanceHash === null) {
    throw new Error('Negative Lab conversion bundle replay requires a selected runtime profile.');
  }

  const conversionPlan = buildNegativeLabConversionPlanResult({
    outputFormat: bundle.conversion.outputFormat,
    paths: bundle.outputs.map((output) => output.source.path),
    presetId: selectedProfile.presetId,
    sampleRect: bundle.conversion.params.base_fog_sample,
    scope: bundle.outputs.length > 1 ? 'all' : 'active',
    suffix: bundle.conversion.suffix,
  });

  if (conversionPlan.profileProvenanceHash !== selectedProfile.profileProvenanceHash) {
    throw new Error('Negative Lab conversion bundle replay profile provenance does not match app-server plan.');
  }

  if (!paramsNear(conversionPlan.params, bundle.conversion.params)) {
    throw new Error('Negative Lab conversion bundle replay params do not match app-server plan.');
  }

  if (
    conversionPlan.outputFormat !== bundle.conversion.outputFormat ||
    conversionPlan.suffix !== bundle.conversion.suffix
  ) {
    throw new Error('Negative Lab conversion bundle replay export settings do not match app-server plan.');
  }

  return {
    outputCount: bundle.outputs.length,
    outputFormat: bundle.conversion.outputFormat,
    profileProvenanceHash: conversionPlan.profileProvenanceHash,
    replayIdentityHash: bundle.replay.identityHash,
  };
};
