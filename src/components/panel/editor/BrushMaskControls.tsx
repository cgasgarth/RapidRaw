import { useTranslation } from 'react-i18next';
import AdjustmentSlider from '../../adjustments/AdjustmentSlider';
import type { BrushSettings } from '../../ui/AppProperties';
import { ToolType } from '../right/layers/Masks';

export type BrushSettingsUpdater = BrushSettings | ((settings: BrushSettings | null) => BrushSettings);

const fallbackSettings = (): BrushSettings => ({
  density: 100,
  feather: 50,
  flow: 100,
  size: 50,
  tool: ToolType.Brush,
});

export interface BrushMaskControlsProps {
  readonly settings: BrushSettings;
  readonly onSettingsChange: (updater: BrushSettingsUpdater) => void;
  readonly onDragStateChange?: ((isDragging: boolean) => void) | undefined;
  readonly showDensity?: boolean;
  readonly showFlow?: boolean;
  readonly testId?: string;
}

/** Compact Lightroom-style controls shared by manual masks and AI paint masks. */
export function BrushMaskControls({
  onDragStateChange,
  onSettingsChange,
  settings,
  showDensity = true,
  showFlow = true,
  testId = 'brush-mask-controls',
}: BrushMaskControlsProps) {
  const { t } = useTranslation();
  const update = (patch: Partial<BrushSettings>) =>
    onSettingsChange((current) => ({ ...fallbackSettings(), ...current, ...patch }));

  return (
    <div
      className="grid gap-1.5"
      data-brush-density={String(settings.density ?? 100)}
      data-brush-flow={String(settings.flow ?? 100)}
      data-testid={testId}
    >
      <AdjustmentSlider
        density="compact"
        defaultValue={100}
        label={t('editor.masks.brush.size')}
        max={200}
        min={1}
        onValueChange={(value) => update({ size: value })}
        onDragStateChange={onDragStateChange}
        step={1}
        value={settings.size}
        fillOrigin="min"
      />
      <AdjustmentSlider
        density="compact"
        defaultValue={50}
        label={t('editor.masks.brush.feather')}
        max={100}
        min={0}
        onValueChange={(value) => update({ feather: value })}
        onDragStateChange={onDragStateChange}
        step={1}
        value={settings.feather}
        fillOrigin="min"
      />
      {showFlow && (
        <AdjustmentSlider
          density="compact"
          defaultValue={100}
          label={t('editor.masks.brush.flow')}
          max={100}
          min={0}
          onValueChange={(value) => update({ flow: value })}
          onDragStateChange={onDragStateChange}
          step={1}
          value={settings.flow ?? 100}
          fillOrigin="min"
        />
      )}
      {showDensity && (
        <AdjustmentSlider
          density="compact"
          defaultValue={100}
          label={t('editor.masks.brush.density', { defaultValue: 'Density' })}
          max={100}
          min={0}
          onValueChange={(value) => update({ density: value })}
          onDragStateChange={onDragStateChange}
          step={1}
          value={settings.density ?? 100}
          fillOrigin="min"
        />
      )}
      <div
        className="grid grid-cols-2 gap-1.5 pt-1"
        data-brush-tool={settings.tool === ToolType.Eraser ? 'erase' : 'paint'}
      >
        <button
          aria-pressed={settings.tool === ToolType.Brush}
          className={`flex min-h-7 items-center justify-center rounded px-2 py-1 text-[12px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-editor-focus-ring ${settings.tool === ToolType.Brush ? 'bg-editor-primary-active text-editor-primary-active-text' : 'bg-editor-panel text-text-secondary hover:bg-editor-panel-raised hover:text-text-primary'}`}
          data-testid="brush-mask-tool-paint"
          data-mask-operation="add"
          onClick={() => update({ tool: ToolType.Brush })}
          type="button"
        >
          {t('editor.masks.brush.brush')}
        </button>
        <button
          aria-pressed={settings.tool === ToolType.Eraser}
          className={`flex min-h-7 items-center justify-center rounded px-2 py-1 text-[12px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-editor-focus-ring ${settings.tool === ToolType.Eraser ? 'bg-editor-primary-active text-editor-primary-active-text' : 'bg-editor-panel text-text-secondary hover:bg-editor-panel-raised hover:text-text-primary'}`}
          data-testid="brush-mask-tool-erase"
          data-mask-operation="subtract"
          onClick={() => update({ tool: ToolType.Eraser })}
          type="button"
        >
          {t('editor.masks.brush.eraser')}
        </button>
      </div>
    </div>
  );
}
