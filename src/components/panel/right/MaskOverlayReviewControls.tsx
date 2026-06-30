import cx from 'clsx';
import { useTranslation } from 'react-i18next';
import type { MaskOverlayMode, MaskOverlaySettings } from '../../../schemas/masks/maskOverlaySchemas';
import AdjustmentSlider from '../../adjustments/AdjustmentSlider';
import Switch from '../../ui/Switch';

const MASK_OVERLAY_REVIEW_MODES = [
  { color: '#f43f5e', mode: 'rubylith' },
  { color: '#10b981', mode: 'green' },
  { color: '#0ea5e9', mode: 'blue' },
  { color: '#d4d4d8', mode: 'grayscale' },
  { color: '#ffffff', mode: 'edges' },
  { color: '#09090b', mode: 'inverse' },
] as const satisfies ReadonlyArray<{ color: string; mode: Exclude<MaskOverlayMode, 'hidden'> }>;

interface MaskOverlayReviewControlsProps {
  hotkeyHint?: string;
  onChange: (settings: MaskOverlaySettings) => void;
  onDragStateChange: (isDragging: boolean) => void;
  settings: MaskOverlaySettings;
}

export function MaskOverlayReviewControls({
  hotkeyHint,
  onChange,
  onDragStateChange,
  settings,
}: MaskOverlayReviewControlsProps) {
  const { t } = useTranslation();
  const isEnabled = settings.mode !== 'hidden';
  const activeMode = isEnabled ? settings.mode : 'rubylith';

  return (
    <div
      className="space-y-3 rounded-md border border-surface bg-card/40 p-3"
      data-mask-overlay-edge-threshold={settings.edgeThreshold.toFixed(2)}
      data-mask-overlay-hotkey={hotkeyHint}
      data-mask-overlay-mode={settings.mode}
      data-mask-overlay-opacity={settings.opacity.toFixed(2)}
      data-testid="mask-overlay-review-controls"
      onPointerDown={(event) => {
        event.stopPropagation();
      }}
    >
      <Switch
        checked={isEnabled}
        label={t('editor.masks.overlay.enabled')}
        onChange={(checked) => {
          onChange({ ...settings, mode: checked ? 'rubylith' : 'hidden' });
        }}
      />

      <div className="grid grid-cols-6 gap-1.5" role="group" aria-label={t('editor.masks.overlay.modeGroup')}>
        {MASK_OVERLAY_REVIEW_MODES.map((option) => {
          const isActive = activeMode === option.mode;
          return (
            <button
              key={option.mode}
              type="button"
              aria-label={option.mode}
              aria-pressed={isActive && isEnabled}
              data-mask-overlay-mode-option={option.mode}
              data-testid={`mask-overlay-mode-${option.mode}`}
              className={cx(
                'h-8 rounded-md border transition-colors',
                isActive && isEnabled ? 'border-accent' : 'border-surface hover:border-text-secondary',
              )}
              style={{ backgroundColor: option.color }}
              onClick={() => {
                onChange({ ...settings, mode: option.mode });
              }}
            />
          );
        })}
      </div>

      <div data-testid="mask-overlay-opacity-control">
        <AdjustmentSlider
          defaultValue={50}
          disabled={!isEnabled}
          fillOrigin="min"
          label={t('editor.masks.overlay.opacity')}
          max={100}
          min={0}
          onDragStateChange={onDragStateChange}
          onValueChange={(value) => {
            onChange({ ...settings, opacity: value / 100 });
          }}
          step={1}
          suffix="%"
          value={Math.round(settings.opacity * 100)}
        />
      </div>

      <div data-testid="mask-overlay-edge-threshold-control">
        <AdjustmentSlider
          defaultValue={50}
          disabled={!isEnabled || activeMode !== 'edges'}
          fillOrigin="min"
          label={t('editor.masks.overlay.edgeThreshold')}
          max={100}
          min={0}
          onDragStateChange={onDragStateChange}
          onValueChange={(value) => {
            onChange({ ...settings, edgeThreshold: value / 100 });
          }}
          step={1}
          suffix="%"
          value={Math.round(settings.edgeThreshold * 100)}
        />
      </div>
    </div>
  );
}
