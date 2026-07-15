import {
  type PreviewArtifact,
  PreviewCoordinator,
  type PreviewCoordinatorEffect,
  type PreviewCoordinatorEvent,
  type PreviewCoordinatorState,
  type PreviewCoordinatorTransition,
} from './previewCoordinator';
import { PreviewUrlReleaseAuthority } from './previewUrlReleaseAuthority';

export interface PreviewSurfaceUpdate {
  readonly finalPreviewUrl?: string | null;
  readonly presentedPreviewArtifact?: PreviewArtifact | null;
  readonly transformedOriginalUrl?: string | null;
}

export type PreviewCoordinatorEffectConsumer = (effects: readonly PreviewCoordinatorEffect[]) => void;

export interface PreviewCoordinatorRuntimeOptions {
  readonly isUrlProtected?: (url: string) => boolean;
  readonly publishSurface: (update: PreviewSurfaceUpdate) => void;
  readonly releaseUrl?: (url: string) => void;
}

/**
 * Session-owned execution boundary around the pure preview reducer.
 *
 * React reports typed events and installs effect adapters. This runtime alone
 * sequences reducer transitions, adapter fan-out, surface publication, and
 * exactly-once release of materializations that never reached a surface.
 */
export class PreviewCoordinatorRuntime {
  private readonly coordinator = new PreviewCoordinator();
  private effectConsumers: readonly PreviewCoordinatorEffectConsumer[] = [];
  private readonly urlReleaseAuthority: PreviewUrlReleaseAuthority;

  constructor(private readonly options: PreviewCoordinatorRuntimeOptions) {
    this.urlReleaseAuthority = new PreviewUrlReleaseAuthority({
      ...(options.isUrlProtected === undefined ? {} : { isProtected: options.isUrlProtected }),
      ...(options.releaseUrl === undefined ? {} : { release: options.releaseUrl }),
    });
  }

  readonly dispatch = (event: PreviewCoordinatorEvent): PreviewCoordinatorTransition => {
    const previous = this.coordinator.snapshot();
    const transition = this.coordinator.dispatch(event);
    for (const consume of this.effectConsumers) consume(transition.effects);
    this.publishSurfaceEffects(transition.effects);
    this.urlReleaseAuthority.consume(previous, transition);
    return transition;
  };

  installEffectConsumers(consumers: readonly PreviewCoordinatorEffectConsumer[]): void {
    this.effectConsumers = [...consumers];
  }

  releaseUnpresentedUrl(url: string): boolean {
    return this.urlReleaseAuthority.release(url);
  }

  snapshot(): Readonly<PreviewCoordinatorState> {
    return this.coordinator.snapshot();
  }

  private publishSurfaceEffects(effects: readonly PreviewCoordinatorEffect[]): void {
    for (const effect of effects) {
      if (effect.type === 'clear-original') {
        this.options.publishSurface({ transformedOriginalUrl: null });
      } else if (effect.type === 'publish' && effect.identity.kind === 'settled') {
        this.options.publishSurface({
          finalPreviewUrl: effect.artifact.url,
          presentedPreviewArtifact: effect.artifact,
        });
      } else if (effect.type === 'publish' && effect.identity.kind === 'interactive') {
        this.options.publishSurface({ presentedPreviewArtifact: effect.artifact });
      } else if (effect.type === 'publish' && effect.identity.kind === 'original') {
        this.options.publishSurface({ transformedOriginalUrl: effect.artifact.url });
      }
    }
  }
}
