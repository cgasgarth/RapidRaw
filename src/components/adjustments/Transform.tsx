import { RotateCcw } from 'lucide-react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { TextVariants } from '../../types/typography';
import type { SelectedImage } from '../ui/AppProperties';
import UiText from '../ui/primitives/Text';
import type { TransformLensAdjustmentUpdate, TransformLensAdjustmentView } from './TransformLens';
import TransformLens from './TransformLens';

interface TransformProps {
  adjustments: TransformLensAdjustmentView;
  onDragStateChange?: ((isDragging: boolean) => void) | undefined;
  onReset?: (() => void) | undefined;
  selectedImage: SelectedImage | null;
  setAdjustments: (adjustments: TransformLensAdjustmentUpdate) => void;
}

const TRANSFORM_DEFAULTS = {
  perspectiveCorrection: {
    amount: 100,
    cropPolicy: 'auto_crop',
    guides: [],
    mode: 'off',
    resolvedPlan: null,
  },
  transformAspect: 0,
  transformDistortion: 0,
  transformHorizontal: 0,
  transformRotate: 0,
  transformScale: 100,
  transformVertical: 0,
  transformXOffset: 0,
  transformYOffset: 0,
} as const;

const isTransformEdited = (adjustments: TransformLensAdjustmentView): boolean =>
  adjustments.transformAspect !== TRANSFORM_DEFAULTS.transformAspect ||
  adjustments.transformDistortion !== TRANSFORM_DEFAULTS.transformDistortion ||
  adjustments.transformHorizontal !== TRANSFORM_DEFAULTS.transformHorizontal ||
  adjustments.transformRotate !== TRANSFORM_DEFAULTS.transformRotate ||
  adjustments.transformScale !== TRANSFORM_DEFAULTS.transformScale ||
  adjustments.transformVertical !== TRANSFORM_DEFAULTS.transformVertical ||
  adjustments.transformXOffset !== TRANSFORM_DEFAULTS.transformXOffset ||
  adjustments.transformYOffset !== TRANSFORM_DEFAULTS.transformYOffset ||
  JSON.stringify(adjustments.perspectiveCorrection) !== JSON.stringify(TRANSFORM_DEFAULTS.perspectiveCorrection);

/** The canonical Lightroom-style Transform section in the Adjust inspector. */
export default function Transform({
  adjustments,
  onDragStateChange,
  onReset,
  selectedImage,
  setAdjustments,
}: TransformProps) {
  const { t } = useTranslation();
  const edited = useMemo(() => isTransformEdited(adjustments), [adjustments]);

  return (
    <div className="space-y-2" data-transform-edited={edited ? 'true' : 'false'} data-testid="transform-panel">
      <div className="flex items-center justify-between gap-2 px-0.5" data-testid="transform-panel-status">
        <UiText variant={TextVariants.small} className="text-[10px] text-text-secondary">
          {edited
            ? t('editor.adjustments.status.edited', { defaultValue: 'Edited' })
            : t('editor.adjustments.status.default', { defaultValue: 'Default' })}
        </UiText>
        {onReset ? (
          <button
            aria-label={t('editor.adjustments.resetTransform', { defaultValue: 'Reset Transform' })}
            className="inline-flex h-6 items-center gap-1 rounded border border-editor-border px-1.5 text-[10px] text-text-secondary transition-colors hover:bg-editor-selected-quiet hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-45"
            data-testid="transform-reset"
            disabled={!edited}
            onClick={onReset}
            type="button"
          >
            <RotateCcw size={11} />
            {t('editor.adjustments.reset', { defaultValue: 'Reset' })}
          </button>
        ) : null}
      </div>
      <TransformLens
        adjustments={adjustments}
        mode="transform"
        onDragStateChange={onDragStateChange}
        selectedImage={selectedImage}
        setAdjustments={setAdjustments}
      />
    </div>
  );
}

export type { TransformProps };
