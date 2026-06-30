import { z } from 'zod';

import {
  ComputationalMergeAppServerRuntimeToolBusV1,
  type ComputationalMergeRuntimeApplyToolResultV1,
  type ComputationalMergeRuntimeDryRunToolResultV1,
  type ComputationalMergeRuntimeToolResultV1,
} from './computationalMergeAppServerRuntimeBus.js';
import {
  applySuperResolutionRuntimePlanV1,
  buildSuperResolutionRuntimeDryRunV1,
  type SuperResolutionRuntimeApplyResultV1,
  type SuperResolutionRuntimeDryRunResultV1,
  type SuperResolutionRuntimePlanRequestV1,
  superResolutionRuntimePlanRequestV1Schema,
} from './superResolutionRuntimePlan.js';

export const superResolutionAppServerRuntimeToolNameV1Schema = z.enum([
  'computationalmerge.super_resolution.dry_run_command',
  'computationalmerge.super_resolution.apply_command',
]);

export const superResolutionAppServerRuntimeToolRequestV1Schema = z
  .object({
    request: superResolutionRuntimePlanRequestV1Schema,
    toolName: superResolutionAppServerRuntimeToolNameV1Schema,
  })
  .strict();

export type SuperResolutionAppServerRuntimeToolNameV1 = z.infer<typeof superResolutionAppServerRuntimeToolNameV1Schema>;
export type SuperResolutionAppServerRuntimeToolRequestV1 = z.infer<
  typeof superResolutionAppServerRuntimeToolRequestV1Schema
>;

export type SuperResolutionAppServerRuntimeDryRunToolResultV1 = ComputationalMergeRuntimeDryRunToolResultV1<
  SuperResolutionAppServerRuntimeToolNameV1,
  SuperResolutionRuntimeDryRunResultV1
>;

export type SuperResolutionAppServerRuntimeApplyToolResultV1 = ComputationalMergeRuntimeApplyToolResultV1<
  SuperResolutionAppServerRuntimeToolNameV1,
  SuperResolutionRuntimeApplyResultV1
>;

export type SuperResolutionAppServerRuntimeToolResultV1 = ComputationalMergeRuntimeToolResultV1<
  SuperResolutionAppServerRuntimeToolNameV1,
  SuperResolutionRuntimeDryRunResultV1,
  SuperResolutionRuntimeApplyResultV1
>;

export class SuperResolutionAppServerRuntimeToolBusV1 extends ComputationalMergeAppServerRuntimeToolBusV1<
  SuperResolutionAppServerRuntimeToolNameV1,
  SuperResolutionRuntimePlanRequestV1,
  SuperResolutionRuntimeDryRunResultV1,
  SuperResolutionRuntimeApplyResultV1
> {
  constructor(manifestValue: unknown) {
    super(manifestValue, {
      applyBuilder: applySuperResolutionRuntimePlanV1,
      commandEnvelopeLabel: 'super-resolution',
      commandType: 'computationalMerge.createSuperResolution',
      dryRunBuilder: buildSuperResolutionRuntimeDryRunV1,
      dryRunPlanLabel: 'super-resolution',
      requestSchema: superResolutionAppServerRuntimeToolRequestV1Schema,
      runtimeLabel: 'Super-resolution',
      toolNameSchema: superResolutionAppServerRuntimeToolNameV1Schema,
    });
  }
}
