import type { PreviewCoordinatorEffect, PreviewOperationIdentity } from './previewCoordinator';
import type { PreparedPreviewRequestIntent } from './previewRequestIntentAdapter';

export interface PreviewInteractionSchedulingEffectRunnerOptions {
  readonly schedule: (
    prepared: PreparedPreviewRequestIntent,
    delayMs: number,
    causalGeneration: number,
  ) => PreviewOperationIdentity;
}

/** Executes coordinator-issued edited schedules without reconstructing interaction state. */
export class PreviewInteractionSchedulingEffectRunner {
  constructor(private readonly options: PreviewInteractionSchedulingEffectRunnerOptions) {}

  consume(effects: readonly PreviewCoordinatorEffect[]): readonly PreviewOperationIdentity[] {
    const scheduled: PreviewOperationIdentity[] = [];
    for (const effect of effects) {
      if (effect.type !== 'schedule-edited') continue;
      scheduled.push(this.options.schedule(effect.prepared, effect.delayMs, effect.causalGeneration));
    }
    return scheduled;
  }
}
