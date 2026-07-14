import type { NegativeLabStagePreviewArtifact } from '../../../utils/negative-lab/negativeLabRuntimeDryRunAdapter';

interface NegativeLabStagePreviewStripProps {
  onSelect: (stageId: NegativeLabStagePreviewArtifact['stageId'] | 'final_display') => void;
  selectedStageId: NegativeLabStagePreviewArtifact['stageId'] | 'final_display';
  stages: readonly NegativeLabStagePreviewArtifact[];
}

const stageLabel = (stageId: NegativeLabStagePreviewArtifact['stageId'] | 'final_display'): string => {
  if (stageId === 'final_display') return 'Final display';
  return stageId === 'normalized_density' ? 'Normalized density' : 'Scene-linear print';
};

export function NegativeLabStagePreviewStrip({ onSelect, selectedStageId, stages }: NegativeLabStagePreviewStripProps) {
  if (stages.length === 0) return null;

  return (
    <div
      className="absolute bottom-20 left-1/2 z-20 flex max-w-[calc(100%-1rem)] -translate-x-1/2 gap-1 overflow-x-auto rounded-md border border-white/10 bg-black/75 p-1 backdrop-blur-md"
      data-stage-count={stages.length}
      data-testid="negative-lab-stage-preview-strip"
      role="group"
      aria-label={[stageLabel('final_display'), ...stages.map((stage) => stageLabel(stage.stageId))].join(', ')}
    >
      <button
        aria-pressed={selectedStageId === 'final_display'}
        className={`rounded px-2 py-1 text-[10px] ${selectedStageId === 'final_display' ? 'bg-accent text-button-text' : 'text-white/70 hover:bg-white/10'}`}
        data-stage-id="final_display"
        data-testid="negative-lab-stage-final-display"
        onClick={() => onSelect('final_display')}
        type="button"
      >
        {stageLabel('final_display')}
      </button>
      {stages.map((stage) => (
        <button
          aria-label={`${stageLabel(stage.stageId)} (${stage.colorDomain})`}
          aria-pressed={selectedStageId === stage.stageId}
          className={`rounded px-2 py-1 text-[10px] ${selectedStageId === stage.stageId ? 'bg-accent text-button-text' : 'text-white/70 hover:bg-white/10'}`}
          data-color-domain={stage.colorDomain}
          data-content-hash={stage.contentHash}
          data-display-transform={stage.displayTransform}
          data-stage-id={stage.stageId}
          data-testid={`negative-lab-stage-${stage.stageId}`}
          key={stage.stageId}
          onClick={() => onSelect(stage.stageId)}
          type="button"
        >
          {stageLabel(stage.stageId)}
        </button>
      ))}
    </div>
  );
}
