#!/usr/bin/env bun

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { format } from 'prettier';

import {
  artifactHandleV1Schema,
  commandEnvelopeV1Schema,
  filmBlackAndWhiteModelV1Schema,
  filmGlowModelV1Schema,
  filmGrainModelV1Schema,
  filmHalationModelV1Schema,
  filmLookCatalogV1Schema,
  negativeAcquisitionProfileV1Schema,
  negativeLabAppServerToolManifestV1Schema,
  negativeLabApplyPlanRequestV1Schema,
  negativeLabApplyResultV1Schema,
  negativeLabBaseFogEstimateV1Schema,
  negativeLabBaseSampleRecordV1Schema,
  negativeLabBuiltInPresetCatalogV1Schema,
  negativeLabCommandEnvelopeV1Schema,
  negativeLabConversionOperationV1Schema,
  negativeLabDensityNormalizationProfileV1Schema,
  negativeLabDryRunResultV1Schema,
  negativeLabFixtureManifestV1Schema,
  negativeLabFrameDetectionResultV1Schema,
  negativeLabInputProfileCatalogV1Schema,
  negativeLabPerChannelInversionCurveSetV1Schema,
  negativeLabPresetMetadataPolicyCatalogV1Schema,
  negativeLabPositiveVariantProvenanceV1Schema,
  negativeLabProcessProfileV1Schema,
  negativeLabQcProofArtifactV1Schema,
  negativeLabRollBatchWorkflowV1Schema,
  negativeRollSessionV1Schema,
  panoramaArtifactV1Schema,
  queryEnvelopeV1Schema,
  rawEngineToolRegistryV1Schema,
} from '../src/rawEngineSchemas.ts';
import {
  sampleArtifactHandleV1,
  sampleCommandEnvelopeV1,
  sampleFilmBlackAndWhiteModelV1,
  sampleFilmGlowModelV1,
  sampleFilmGrainModelV1,
  sampleFilmHalationModelV1,
  sampleFilmLookCatalogV1,
  sampleNegativeAcquisitionProfileV1,
  sampleNegativeLabAppServerToolManifestV1,
  sampleNegativeLabApplyPlanRequestV1,
  sampleNegativeLabApplyResultV1,
  sampleNegativeLabBaseFogEstimateV1,
  sampleNegativeLabBaseSampleRecordV1,
  sampleNegativeLabBuiltInPresetCatalogV1,
  sampleNegativeLabCommandEnvelopeV1,
  sampleNegativeLabConversionOperationV1,
  sampleNegativeLabDensityNormalizationProfileV1,
  sampleNegativeLabDryRunResultV1,
  sampleNegativeLabFixtureManifestV1,
  sampleNegativeLabFrameDetectionResultV1,
  sampleNegativeLabInputProfileCatalogV1,
  sampleNegativeLabPerChannelInversionCurveSetV1,
  sampleNegativeLabPresetMetadataPolicyCatalogV1,
  sampleNegativeLabPositiveVariantProvenanceV1,
  sampleNegativeLabProcessProfileV1,
  sampleNegativeLabQcProofArtifactV1,
  sampleNegativeLabRollBatchWorkflowV1,
  sampleNegativeRollSessionV1,
  samplePanoramaArtifactV1,
  sampleQueryEnvelopeV1,
  sampleToolRegistryV1,
} from '../src/samplePayloads.ts';

const ROOT = process.cwd();

const sampleArtifacts = [
  {
    name: 'query envelope',
    path: 'packages/rawengine-schema/samples/query-envelope-v1.json',
    schema: queryEnvelopeV1Schema,
    value: sampleQueryEnvelopeV1,
  },
  {
    name: 'command envelope',
    path: 'packages/rawengine-schema/samples/command-envelope-v1.json',
    schema: commandEnvelopeV1Schema,
    value: sampleCommandEnvelopeV1,
  },
  {
    name: 'artifact handle',
    path: 'packages/rawengine-schema/samples/artifact-handle-v1.json',
    schema: artifactHandleV1Schema,
    value: sampleArtifactHandleV1,
  },
  {
    name: 'tool registry',
    path: 'packages/rawengine-schema/samples/tool-registry-v1.json',
    schema: rawEngineToolRegistryV1Schema,
    value: sampleToolRegistryV1,
  },
  {
    name: 'panorama artifact',
    path: 'packages/rawengine-schema/samples/panorama-artifact-v1.json',
    schema: panoramaArtifactV1Schema,
    value: samplePanoramaArtifactV1,
  },
  {
    name: 'film look catalog',
    path: 'packages/rawengine-schema/samples/film-look-catalog-v1.json',
    schema: filmLookCatalogV1Schema,
    value: sampleFilmLookCatalogV1,
  },
  {
    name: 'film black and white model',
    path: 'packages/rawengine-schema/samples/film-black-and-white-model-v1.json',
    schema: filmBlackAndWhiteModelV1Schema,
    value: sampleFilmBlackAndWhiteModelV1,
  },
  {
    name: 'film grain model',
    path: 'packages/rawengine-schema/samples/film-grain-model-v1.json',
    schema: filmGrainModelV1Schema,
    value: sampleFilmGrainModelV1,
  },
  {
    name: 'film halation model',
    path: 'packages/rawengine-schema/samples/film-halation-model-v1.json',
    schema: filmHalationModelV1Schema,
    value: sampleFilmHalationModelV1,
  },
  {
    name: 'film glow model',
    path: 'packages/rawengine-schema/samples/film-glow-model-v1.json',
    schema: filmGlowModelV1Schema,
    value: sampleFilmGlowModelV1,
  },
  {
    name: 'negative acquisition profile',
    path: 'packages/rawengine-schema/samples/negative-acquisition-profile-v1.json',
    schema: negativeAcquisitionProfileV1Schema,
    value: sampleNegativeAcquisitionProfileV1,
  },
  {
    name: 'negative roll session',
    path: 'packages/rawengine-schema/samples/negative-roll-session-v1.json',
    schema: negativeRollSessionV1Schema,
    value: sampleNegativeRollSessionV1,
  },
  {
    name: 'negative lab command envelope',
    path: 'packages/rawengine-schema/samples/negative-lab-command-envelope-v1.json',
    schema: negativeLabCommandEnvelopeV1Schema,
    value: sampleNegativeLabCommandEnvelopeV1,
  },
  {
    name: 'negative lab density normalization profile',
    path: 'packages/rawengine-schema/samples/negative-lab-density-normalization-profile-v1.json',
    schema: negativeLabDensityNormalizationProfileV1Schema,
    value: sampleNegativeLabDensityNormalizationProfileV1,
  },
  {
    name: 'negative lab frame detection result',
    path: 'packages/rawengine-schema/samples/negative-lab-frame-detection-result-v1.json',
    schema: negativeLabFrameDetectionResultV1Schema,
    value: sampleNegativeLabFrameDetectionResultV1,
  },
  {
    name: 'negative lab base sample record',
    path: 'packages/rawengine-schema/samples/negative-lab-base-sample-record-v1.json',
    schema: negativeLabBaseSampleRecordV1Schema,
    value: sampleNegativeLabBaseSampleRecordV1,
  },
  {
    name: 'negative lab base fog estimate',
    path: 'packages/rawengine-schema/samples/negative-lab-base-fog-estimate-v1.json',
    schema: negativeLabBaseFogEstimateV1Schema,
    value: sampleNegativeLabBaseFogEstimateV1,
  },
  {
    name: 'negative lab process profile',
    path: 'packages/rawengine-schema/samples/negative-lab-process-profile-v1.json',
    schema: negativeLabProcessProfileV1Schema,
    value: sampleNegativeLabProcessProfileV1,
  },
  {
    name: 'negative lab per-channel inversion curve set',
    path: 'packages/rawengine-schema/samples/negative-lab-per-channel-inversion-curve-set-v1.json',
    schema: negativeLabPerChannelInversionCurveSetV1Schema,
    value: sampleNegativeLabPerChannelInversionCurveSetV1,
  },
  {
    name: 'negative lab QC proof artifact',
    path: 'packages/rawengine-schema/samples/negative-lab-qc-proof-artifact-v1.json',
    schema: negativeLabQcProofArtifactV1Schema,
    value: sampleNegativeLabQcProofArtifactV1,
  },
  {
    name: 'negative lab roll batch workflow',
    path: 'packages/rawengine-schema/samples/negative-lab-roll-batch-workflow-v1.json',
    schema: negativeLabRollBatchWorkflowV1Schema,
    value: sampleNegativeLabRollBatchWorkflowV1,
  },
  {
    name: 'negative lab dry-run result',
    path: 'packages/rawengine-schema/samples/negative-lab-dry-run-result-v1.json',
    schema: negativeLabDryRunResultV1Schema,
    value: sampleNegativeLabDryRunResultV1,
  },
  {
    name: 'negative lab apply plan request',
    path: 'packages/rawengine-schema/samples/negative-lab-apply-plan-request-v1.json',
    schema: negativeLabApplyPlanRequestV1Schema,
    value: sampleNegativeLabApplyPlanRequestV1,
  },
  {
    name: 'negative lab apply result',
    path: 'packages/rawengine-schema/samples/negative-lab-apply-result-v1.json',
    schema: negativeLabApplyResultV1Schema,
    value: sampleNegativeLabApplyResultV1,
  },
  {
    name: 'negative lab conversion operation',
    path: 'packages/rawengine-schema/samples/negative-lab-conversion-operation-v1.json',
    schema: negativeLabConversionOperationV1Schema,
    value: sampleNegativeLabConversionOperationV1,
  },
  {
    name: 'negative lab app-server tool manifest',
    path: 'packages/rawengine-schema/samples/negative-lab-app-server-tool-manifest-v1.json',
    schema: negativeLabAppServerToolManifestV1Schema,
    value: sampleNegativeLabAppServerToolManifestV1,
  },
  {
    name: 'negative lab positive variant provenance',
    path: 'packages/rawengine-schema/samples/negative-lab-positive-variant-provenance-v1.json',
    schema: negativeLabPositiveVariantProvenanceV1Schema,
    value: sampleNegativeLabPositiveVariantProvenanceV1,
  },
  {
    name: 'negative lab built-in preset catalog',
    path: 'packages/rawengine-schema/samples/negative-lab-built-in-preset-catalog-v1.json',
    schema: negativeLabBuiltInPresetCatalogV1Schema,
    value: sampleNegativeLabBuiltInPresetCatalogV1,
  },
  {
    name: 'negative lab preset metadata policy catalog',
    path: 'packages/rawengine-schema/samples/negative-lab-preset-metadata-policy-catalog-v1.json',
    schema: negativeLabPresetMetadataPolicyCatalogV1Schema,
    value: sampleNegativeLabPresetMetadataPolicyCatalogV1,
  },
  {
    name: 'negative lab fixture manifest',
    path: 'packages/rawengine-schema/samples/negative-lab-fixture-manifest-v1.json',
    schema: negativeLabFixtureManifestV1Schema,
    value: sampleNegativeLabFixtureManifestV1,
  },
  {
    name: 'negative lab input profile catalog',
    path: 'packages/rawengine-schema/samples/negative-lab-input-profile-catalog-v1.json',
    schema: negativeLabInputProfileCatalogV1Schema,
    value: sampleNegativeLabInputProfileCatalogV1,
  },
];

const toAbsolutePath = (repoPath) => join(ROOT, repoPath);
const toStableJson = (value) => format(JSON.stringify(value, null, 2), { parser: 'json', printWidth: 120 });

const updateArtifacts = async () => {
  for (const artifact of sampleArtifacts) {
    const absolutePath = toAbsolutePath(artifact.path);
    mkdirSync(dirname(absolutePath), { recursive: true });
    writeFileSync(absolutePath, await toStableJson(artifact.value));
  }

  console.log(`Updated ${sampleArtifacts.length} RawEngine schema sample artifacts.`);
};

const checkArtifacts = async () => {
  const failures = [];

  for (const artifact of sampleArtifacts) {
    const absolutePath = toAbsolutePath(artifact.path);
    const expectedContents = await toStableJson(artifact.value);

    if (!existsSync(absolutePath)) {
      failures.push(`${artifact.path}: missing generated sample artifact`);
      continue;
    }

    const actualContents = readFileSync(absolutePath, 'utf8');
    if (actualContents !== expectedContents) {
      failures.push(`${artifact.path}: sample artifact drifted from ${artifact.name}`);
      continue;
    }

    const parsedArtifact = artifact.schema.safeParse(JSON.parse(actualContents));
    if (!parsedArtifact.success) {
      failures.push(`${artifact.path}: checked artifact no longer satisfies ${artifact.name} schema`);
    }
  }

  if (failures.length > 0) {
    console.error('RawEngine schema sample artifact check failed.');
    console.error('Refresh intentional changes with: bun run schema:samples:update');
    console.error(failures.join('\n'));
    process.exit(1);
  }

  console.log(`RawEngine schema sample artifact check passed for ${sampleArtifacts.length} artifacts.`);
};

const args = new Set(process.argv.slice(2));

if (args.has('--update')) {
  await updateArtifacts();
} else {
  await checkArtifacts();
}
