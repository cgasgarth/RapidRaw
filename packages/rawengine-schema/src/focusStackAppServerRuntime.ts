import { z } from 'zod';

import {
  ComputationalMergeAppServerRuntimeToolBusV1,
  type ComputationalMergeRuntimeApplyToolResultV1,
  type ComputationalMergeRuntimeDryRunToolResultV1,
  type ComputationalMergeRuntimeToolResultV1,
} from './computationalMergeAppServerRuntimeBus.js';
import {
  applyFocusStackRuntimePlanV1,
  buildFocusStackRuntimeDryRunV1,
  type FocusStackRuntimeApplyResultV1,
  type FocusStackRuntimeDryRunResultV1,
  type FocusStackRuntimePlanRequestV1,
  focusStackRuntimePlanRequestV1Schema,
} from './focusStackRuntimePlan.js';

export const focusStackAppServerRuntimeToolNameV1Schema = z.enum([
  'computationalmerge.focus_stack.dry_run_command',
  'computationalmerge.focus_stack.apply_command',
]);

export const focusStackAppServerRuntimeToolRequestV1Schema = z
  .object({
    request: focusStackRuntimePlanRequestV1Schema,
    toolName: focusStackAppServerRuntimeToolNameV1Schema,
  })
  .strict();

export type FocusStackAppServerRuntimeToolNameV1 = z.infer<typeof focusStackAppServerRuntimeToolNameV1Schema>;

export type FocusStackAppServerRuntimeDryRunToolResultV1 = ComputationalMergeRuntimeDryRunToolResultV1<
  FocusStackAppServerRuntimeToolNameV1,
  FocusStackRuntimeDryRunResultV1
>;

export type FocusStackAppServerRuntimeApplyToolResultV1 = ComputationalMergeRuntimeApplyToolResultV1<
  FocusStackAppServerRuntimeToolNameV1,
  FocusStackRuntimeApplyResultV1
>;

export type FocusStackAppServerRuntimeToolResultV1 = ComputationalMergeRuntimeToolResultV1<
  FocusStackAppServerRuntimeToolNameV1,
  FocusStackRuntimeDryRunResultV1,
  FocusStackRuntimeApplyResultV1
>;

export class FocusStackAppServerRuntimeToolBusV1 extends ComputationalMergeAppServerRuntimeToolBusV1<
  FocusStackAppServerRuntimeToolNameV1,
  FocusStackRuntimePlanRequestV1,
  FocusStackRuntimeDryRunResultV1,
  FocusStackRuntimeApplyResultV1
> {
  constructor(manifestValue: unknown) {
    super(manifestValue, {
      applyBuilder: applyFocusStackRuntimePlanV1,
      commandEnvelopeLabel: 'focus stack',
      commandType: 'computationalMerge.createFocusStack',
      dryRunBuilder: buildFocusStackRuntimeDryRunV1,
      dryRunPlanLabel: 'focus stack',
      requestSchema: focusStackAppServerRuntimeToolRequestV1Schema,
      runtimeLabel: 'Focus stack',
      toolNameSchema: focusStackAppServerRuntimeToolNameV1Schema,
    });
  }
}
