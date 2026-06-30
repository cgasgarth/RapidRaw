import { z } from 'zod';

import {
  ComputationalMergeAppServerRuntimeToolBusV1,
  type ComputationalMergeRuntimeApplyToolResultV1,
  type ComputationalMergeRuntimeDryRunToolResultV1,
  type ComputationalMergeRuntimeToolResultV1,
} from './computationalMergeAppServerRuntimeBus.js';
import {
  applyPanoramaRuntimePlanV1,
  buildPanoramaRuntimeDryRunV1,
  type PanoramaRuntimeApplyResultV1,
  type PanoramaRuntimeDryRunResultV1,
  type PanoramaRuntimePlanRequestV1,
  panoramaRuntimePlanRequestV1Schema,
} from './panoramaRuntimePlan.js';

export const panoramaAppServerRuntimeToolNameV1Schema = z.enum([
  'computationalmerge.panorama.dry_run_command',
  'computationalmerge.panorama.apply_command',
]);

export const panoramaAppServerRuntimeToolRequestV1Schema = z
  .object({
    request: panoramaRuntimePlanRequestV1Schema,
    toolName: panoramaAppServerRuntimeToolNameV1Schema,
  })
  .strict();

export type PanoramaAppServerRuntimeToolNameV1 = z.infer<typeof panoramaAppServerRuntimeToolNameV1Schema>;

export type PanoramaAppServerRuntimeDryRunToolResultV1 = ComputationalMergeRuntimeDryRunToolResultV1<
  PanoramaAppServerRuntimeToolNameV1,
  PanoramaRuntimeDryRunResultV1
>;

export type PanoramaAppServerRuntimeApplyToolResultV1 = ComputationalMergeRuntimeApplyToolResultV1<
  PanoramaAppServerRuntimeToolNameV1,
  PanoramaRuntimeApplyResultV1
>;

export type PanoramaAppServerRuntimeToolResultV1 = ComputationalMergeRuntimeToolResultV1<
  PanoramaAppServerRuntimeToolNameV1,
  PanoramaRuntimeDryRunResultV1,
  PanoramaRuntimeApplyResultV1
>;

export class PanoramaAppServerRuntimeToolBusV1 extends ComputationalMergeAppServerRuntimeToolBusV1<
  PanoramaAppServerRuntimeToolNameV1,
  PanoramaRuntimePlanRequestV1,
  PanoramaRuntimeDryRunResultV1,
  PanoramaRuntimeApplyResultV1
> {
  constructor(manifestValue: unknown) {
    super(manifestValue, {
      applyBuilder: applyPanoramaRuntimePlanV1,
      commandEnvelopeLabel: 'panorama',
      commandType: 'computationalMerge.createPanorama',
      dryRunBuilder: buildPanoramaRuntimeDryRunV1,
      dryRunPlanLabel: 'panorama',
      requestSchema: panoramaAppServerRuntimeToolRequestV1Schema,
      runtimeLabel: 'Panorama',
      toolNameSchema: panoramaAppServerRuntimeToolNameV1Schema,
    });
  }
}
