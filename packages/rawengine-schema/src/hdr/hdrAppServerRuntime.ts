import { z } from 'zod';

import {
  ComputationalMergeAppServerRuntimeToolBusV1,
  type ComputationalMergeRuntimeApplyToolResultV1,
  type ComputationalMergeRuntimeDryRunToolResultV1,
  type ComputationalMergeRuntimeToolResultV1,
} from '../computational-merge/computationalMergeAppServerRuntimeBus.js';
import {
  applyHdrRuntimePlanV1,
  buildHdrRuntimeDryRunV1,
  type HdrRuntimeApplyResultV1,
  type HdrRuntimeDryRunResultV1,
  type HdrRuntimePlanRequestV1,
  hdrRuntimePlanRequestV1Schema,
} from './hdrRuntimePlan.js';

export const hdrAppServerRuntimeToolNameV1Schema = z.enum([
  'computationalmerge.hdr.dry_run_command',
  'computationalmerge.hdr.apply_command',
]);

export const hdrAppServerRuntimeToolRequestV1Schema = z
  .object({
    request: hdrRuntimePlanRequestV1Schema,
    toolName: hdrAppServerRuntimeToolNameV1Schema,
  })
  .strict();

export type HdrAppServerRuntimeToolNameV1 = z.infer<typeof hdrAppServerRuntimeToolNameV1Schema>;

export type HdrAppServerRuntimeDryRunToolResultV1 = ComputationalMergeRuntimeDryRunToolResultV1<
  HdrAppServerRuntimeToolNameV1,
  HdrRuntimeDryRunResultV1
>;

export type HdrAppServerRuntimeApplyToolResultV1 = ComputationalMergeRuntimeApplyToolResultV1<
  HdrAppServerRuntimeToolNameV1,
  HdrRuntimeApplyResultV1
>;

export type HdrAppServerRuntimeToolResultV1 = ComputationalMergeRuntimeToolResultV1<
  HdrAppServerRuntimeToolNameV1,
  HdrRuntimeDryRunResultV1,
  HdrRuntimeApplyResultV1
>;

export class HdrAppServerRuntimeToolBusV1 extends ComputationalMergeAppServerRuntimeToolBusV1<
  HdrAppServerRuntimeToolNameV1,
  HdrRuntimePlanRequestV1,
  HdrRuntimeDryRunResultV1,
  HdrRuntimeApplyResultV1
> {
  constructor(manifestValue: unknown) {
    super(manifestValue, {
      applyBuilder: applyHdrRuntimePlanV1,
      commandEnvelopeLabel: 'HDR',
      commandType: 'computationalMerge.createHdr',
      dryRunBuilder: buildHdrRuntimeDryRunV1,
      dryRunPlanLabel: 'HDR',
      requestSchema: hdrAppServerRuntimeToolRequestV1Schema,
      runtimeLabel: 'HDR',
      toolNameSchema: hdrAppServerRuntimeToolNameV1Schema,
    });
  }
}
