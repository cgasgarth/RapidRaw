import cx from 'clsx';
import { Check, GripVertical, RotateCcw, X } from 'lucide-react';
import { type DragEvent, type KeyboardEvent, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useShallow } from 'zustand/react/shallow';

import { useUIStore } from '../../../../store/useUIStore';
import { TextVariants } from '../../../../types/typography';
import {
  DEFAULT_DEVELOP_PANEL_ORDER,
  DEVELOP_PANEL_IDS,
  type DevelopPanelId,
} from '../../../../utils/developPanelCustomization';
import UiText from '../../../ui/primitives/Text';

const LABELS: Record<DevelopPanelId, string> = {
  calibration: 'Calibration',
  colorGrading: 'Color Grading',
  colorMixer: 'Color Mixer',
  curves: 'Tone Curve',
  details: 'Detail',
  effects: 'Effects',
  lensCorrection: 'Lens Corrections',
  transform: 'Transform',
};

interface DevelopPanelCustomizationProps {
  onClose: () => void;
}

export default function DevelopPanelCustomization({ onClose }: DevelopPanelCustomizationProps) {
  const { t } = useTranslation();
  const rowRefs = useRef(new Map<DevelopPanelId, HTMLDivElement>());
  const { developPanelOrder, hiddenDevelopPanelIds, reset, setOrder, setVisibility } = useUIStore(
    useShallow((state) => ({
      developPanelOrder: state.developPanelOrder,
      hiddenDevelopPanelIds: state.hiddenDevelopPanelIds,
      reset: state.resetDevelopPanelCustomization,
      setOrder: state.setDevelopPanelOrder,
      setVisibility: state.setDevelopPanelVisibility,
    })),
  );

  const move = (id: DevelopPanelId, offset: -1 | 1) => {
    const currentIndex = developPanelOrder.indexOf(id);
    const nextIndex = currentIndex + offset;
    if (currentIndex < 0 || nextIndex < 0 || nextIndex >= developPanelOrder.length) return;
    const next = [...developPanelOrder];
    const [item] = next.splice(currentIndex, 1);
    if (item === undefined) return;
    next.splice(nextIndex, 0, item);
    setOrder(next);
    window.requestAnimationFrame(() => rowRefs.current.get(id)?.focus({ preventScroll: true }));
  };

  const handleRowKeyDown = (event: KeyboardEvent<HTMLDivElement>, id: DevelopPanelId) => {
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      move(id, -1);
    } else if (event.key === 'ArrowDown') {
      event.preventDefault();
      move(id, 1);
    } else if (event.key === 'Home') {
      event.preventDefault();
      const next = [id, ...developPanelOrder.filter((candidate) => candidate !== id)];
      setOrder(next);
      window.requestAnimationFrame(() => rowRefs.current.get(id)?.focus({ preventScroll: true }));
    } else if (event.key === 'End') {
      event.preventDefault();
      const next = [...developPanelOrder.filter((candidate) => candidate !== id), id];
      setOrder(next);
      window.requestAnimationFrame(() => rowRefs.current.get(id)?.focus({ preventScroll: true }));
    }
  };

  const moveByPointer = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    const target = event.currentTarget.dataset['panelId'] as DevelopPanelId | undefined;
    const dragged = event.dataTransfer.getData('text/plain') as DevelopPanelId;
    if (!target || !DEVELOP_PANEL_IDS.includes(target) || !DEVELOP_PANEL_IDS.includes(dragged) || target === dragged)
      return;
    const sourceIndex = developPanelOrder.indexOf(dragged);
    const targetIndex = developPanelOrder.indexOf(target);
    if (sourceIndex < 0 || targetIndex < 0) return;
    const next = [...developPanelOrder];
    next.splice(sourceIndex, 1);
    next.splice(sourceIndex < targetIndex ? targetIndex - 1 : targetIndex, 0, dragged);
    setOrder(next);
  };

  return (
    <section
      aria-label={t('editor.adjustments.customize.title', { defaultValue: 'Customize Develop Panel' })}
      className="absolute right-1 top-8 z-40 w-[min(20rem,calc(100vw-1rem))] rounded-md border border-editor-border bg-editor-panel-raised p-2 shadow-xl"
      data-testid="develop-panel-customization"
      id="develop-panel-customization"
      role="dialog"
    >
      <header className="flex items-center justify-between gap-2 border-b border-editor-border pb-1">
        <UiText as="h3" variant={TextVariants.label} className="font-semibold">
          {t('editor.adjustments.customize.title', { defaultValue: 'Customize Develop Panel' })}
        </UiText>
        <button
          aria-label={t('editor.adjustments.customize.close', { defaultValue: 'Close customization' })}
          className="flex h-6 w-6 items-center justify-center rounded text-text-secondary hover:bg-editor-selected-quiet hover:text-text-primary focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-editor-focus-ring"
          data-testid="develop-panel-customization-close"
          onClick={onClose}
          type="button"
        >
          <X size={14} />
        </button>
      </header>
      <p className="px-1 py-1.5 text-[10px] leading-4 text-text-secondary">
        {t('editor.adjustments.customize.description', {
          defaultValue: 'Basic, Histogram, and tools stay fixed. Utilities remain available separately.',
        })}
      </p>
      <div
        aria-label={t('editor.adjustments.customize.list', { defaultValue: 'Develop panels' })}
        className="space-y-0.5"
        role="listbox"
      >
        <div
          className="flex min-h-7 items-center gap-2 rounded border border-editor-border bg-editor-panel-well px-1.5 text-[11px]"
          data-testid="develop-panel-customization-fixed-basic"
        >
          <Check aria-hidden="true" className="text-editor-success" size={13} />
          <span className="font-medium">{t('editor.adjustments.scopedSections.basic', { defaultValue: 'Light' })}</span>
          <span className="ml-auto text-[9px] text-text-tertiary">
            {t('editor.adjustments.customize.fixed', { defaultValue: 'Fixed' })}
          </span>
        </div>
        {developPanelOrder.map((id) => {
          const hidden = hiddenDevelopPanelIds.includes(id);
          return (
            <div
              aria-label={LABELS[id]}
              className={cx(
                'flex min-h-8 items-center gap-1 rounded border px-1 py-0.5 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-editor-focus-ring',
                hidden
                  ? 'border-editor-border bg-editor-panel opacity-60'
                  : 'border-editor-border bg-editor-panel-well',
              )}
              data-panel-id={id}
              data-testid={`develop-panel-customization-row-${id}`}
              draggable
              key={id}
              onDragOver={(event) => {
                event.preventDefault();
                event.dataTransfer.dropEffect = 'move';
              }}
              onDragStart={(event) => {
                event.dataTransfer.effectAllowed = 'move';
                event.dataTransfer.setData('text/plain', id);
              }}
              onDrop={moveByPointer}
              onKeyDown={(event) => handleRowKeyDown(event, id)}
              ref={(element) => {
                if (element) rowRefs.current.set(id, element);
                else rowRefs.current.delete(id);
              }}
              aria-selected={!hidden}
              role="option"
              tabIndex={0}
            >
              <GripVertical aria-hidden="true" className="shrink-0 text-text-tertiary" size={13} />
              <span className="min-w-0 flex-1 truncate text-[11px]">{LABELS[id]}</span>
              <button
                aria-label={t('editor.adjustments.customize.moveUp', {
                  panel: LABELS[id],
                  defaultValue: 'Move panel up',
                })}
                className="h-6 rounded px-1 text-[10px] text-text-secondary hover:bg-editor-selected-quiet disabled:opacity-40"
                disabled={developPanelOrder.indexOf(id) === 0}
                onClick={() => move(id, -1)}
                type="button"
              >
                ↑
              </button>
              <button
                aria-label={t('editor.adjustments.customize.moveDown', {
                  panel: LABELS[id],
                  defaultValue: 'Move panel down',
                })}
                className="h-6 rounded px-1 text-[10px] text-text-secondary hover:bg-editor-selected-quiet disabled:opacity-40"
                disabled={developPanelOrder.indexOf(id) === developPanelOrder.length - 1}
                onClick={() => move(id, 1)}
                type="button"
              >
                ↓
              </button>
              <button
                aria-pressed={!hidden}
                aria-label={t('editor.adjustments.customize.visibility', {
                  panel: LABELS[id],
                  defaultValue: hidden ? 'Show panel' : 'Hide panel',
                })}
                className={cx(
                  'h-6 rounded px-1.5 text-[10px] font-medium focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-editor-focus-ring',
                  hidden ? 'text-text-secondary' : 'text-editor-success',
                )}
                data-testid={`develop-panel-customization-visibility-${id}`}
                onClick={() => setVisibility(id, hidden)}
                type="button"
              >
                {hidden
                  ? t('editor.adjustments.customize.show', { defaultValue: 'Show' })
                  : t('editor.adjustments.customize.hide', { defaultValue: 'Hide' })}
              </button>
            </div>
          );
        })}
      </div>
      <footer className="mt-2 flex items-center justify-between border-t border-editor-border pt-1.5">
        <button
          className="inline-flex items-center gap-1 rounded px-1.5 py-1 text-[10px] text-text-secondary hover:bg-editor-selected-quiet hover:text-text-primary focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-editor-focus-ring"
          data-testid="develop-panel-customization-reset"
          onClick={() => {
            reset();
            const firstPanel = DEFAULT_DEVELOP_PANEL_ORDER[0];
            if (firstPanel !== undefined) {
              window.requestAnimationFrame(() => rowRefs.current.get(firstPanel)?.focus({ preventScroll: true }));
            }
          }}
          type="button"
        >
          <RotateCcw size={12} />
          {t('editor.adjustments.customize.restore', { defaultValue: 'Restore Default Order' })}
        </button>
        <span className="text-[9px] text-text-tertiary">
          {t('editor.adjustments.customize.keyboardHint', { defaultValue: '↑ ↓ reorder' })}
        </span>
      </footer>
    </section>
  );
}
