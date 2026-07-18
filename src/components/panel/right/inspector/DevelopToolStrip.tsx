import cx from 'clsx';
import { Crop, Eraser, Layers3, Spline } from 'lucide-react';
import { type KeyboardEvent, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useShallow } from 'zustand/react/shallow';

import { useEditorStore } from '../../../../store/useEditorStore';
import { type DevelopToolId, useUIStore } from '../../../../store/useUIStore';
import type { Panel } from '../../../ui/AppProperties';
import { DEVELOP_TOOL_PANEL_BY_ID } from '../rightPanelRegistry';

interface DevelopToolDefinition {
  icon: typeof Crop;
  id: DevelopToolId;
  label: string;
  panel: Panel;
}

export const DEVELOP_TOOL_DEFINITIONS: readonly DevelopToolDefinition[] = [
  { icon: Crop, id: 'crop', label: 'Crop', panel: DEVELOP_TOOL_PANEL_BY_ID.crop },
  { icon: Eraser, id: 'remove', label: 'Remove', panel: DEVELOP_TOOL_PANEL_BY_ID.remove },
  { icon: Layers3, id: 'masking', label: 'Masking', panel: DEVELOP_TOOL_PANEL_BY_ID.masking },
  { icon: Spline, id: 'tone-curve', label: 'Tone Curve Target', panel: DEVELOP_TOOL_PANEL_BY_ID.toneCurve },
];

export interface DevelopToolAvailability {
  disabled: boolean;
  state: 'available' | 'loading' | 'unavailable';
}

export const resolveDevelopToolAvailability = (selectedImage: { isReady: boolean } | null): DevelopToolAvailability => {
  if (selectedImage === null) return { disabled: true, state: 'unavailable' };
  if (!selectedImage.isReady) return { disabled: true, state: 'loading' };
  return { disabled: false, state: 'available' };
};

interface DevelopToolStripProps {
  testId?: string;
}

export default function DevelopToolStrip({ testId = 'develop-tool-strip' }: DevelopToolStripProps) {
  const { t } = useTranslation();
  const selectedImage = useEditorStore((state) => state.selectedImage);
  const { activateDevelopTool, activeDevelopTool, deactivateDevelopTool } = useUIStore(
    useShallow((state) => ({
      activateDevelopTool: state.activateDevelopTool,
      activeDevelopTool: state.activeDevelopTool,
      deactivateDevelopTool: state.deactivateDevelopTool,
    })),
  );
  const availability = resolveDevelopToolAvailability(selectedImage);

  const selectTool = useCallback(
    (tool: DevelopToolDefinition) => {
      if (availability.disabled) return;
      activateDevelopTool(tool.id);
    },
    [activateDevelopTool, availability.disabled],
  );

  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key !== 'Escape' || activeDevelopTool === null) return;
    event.preventDefault();
    event.stopPropagation();
    const toolId = activeDevelopTool;
    deactivateDevelopTool();
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(() => {
        const buttons = [...document.querySelectorAll<HTMLButtonElement>('[data-develop-tool-id]')];
        const nextFocus = buttons.find((button) => button.dataset['developToolId'] === toolId && !button.disabled);
        nextFocus?.focus();
      });
    }
  };

  return (
    <div
      aria-label={t('editor.developTools.label', { defaultValue: 'Develop tools' })}
      aria-busy={availability.state === 'loading'}
      className="flex min-w-0 items-center gap-1 border-t border-editor-border bg-editor-panel px-2 py-1"
      data-active-develop-tool={activeDevelopTool ?? 'none'}
      data-develop-tool-state={availability.state}
      data-testid={testId}
      role="toolbar"
    >
      {DEVELOP_TOOL_DEFINITIONS.map((tool) => {
        const Icon = tool.icon;
        const isActive = activeDevelopTool === tool.id && !availability.disabled;
        const label = t(`editor.developTools.${tool.id}`, { defaultValue: tool.label });
        return (
          <button
            aria-label={label}
            aria-disabled={availability.disabled}
            aria-pressed={isActive}
            className={cx(
              'inline-flex h-7 min-w-0 flex-1 items-center justify-center gap-1 rounded border border-transparent px-1.5 text-[10px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-editor-focus-ring disabled:cursor-not-allowed disabled:opacity-45',
              isActive
                ? 'border-editor-border bg-editor-primary-active text-editor-primary-active-text'
                : 'text-text-secondary hover:border-editor-border hover:bg-editor-panel-raised hover:text-text-primary',
            )}
            data-develop-tool-id={tool.id}
            data-develop-tool-state={availability.state}
            data-testid={`${testId}-${tool.id}`}
            data-tooltip={label}
            disabled={availability.disabled}
            key={tool.id}
            onClick={() => selectTool(tool)}
            onKeyDown={handleKeyDown}
            type="button"
          >
            <Icon aria-hidden="true" size={14} />
            <span className="truncate">{label}</span>
          </button>
        );
      })}
    </div>
  );
}
