import { Check, CheckCircle, Plus, Save, Trash2, TriangleAlert, X } from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useManagedFocus } from '../../../../hooks/ui/useManagedFocus';
import { EXPORT_LAST_USED_PRESET_ID } from '../../../../schemas/exportRecipeIds';
import { buildExportRecipeUiRows } from '../../../../schemas/exportRecipeUiSchemas';
import { TextVariants } from '../../../../types/typography';
import type { AppSettings } from '../../../ui/AppProperties';
import type { ExportPreset } from '../../../ui/ExportImportProperties';
import Dropdown from '../../../ui/primitives/Dropdown';
import UiText from '../../../ui/primitives/Text';

interface ExportPresetsListProps {
  appSettings: AppSettings | null;
  currentSettings: Omit<ExportPreset, 'id' | 'name'>;
  onApplyPreset: (preset: ExportPreset) => void;
  onSettingsChange: (settings: AppSettings) => void;
}

export default function ExportPresetsList({
  appSettings,
  currentSettings,
  onApplyPreset,
  onSettingsChange,
}: ExportPresetsListProps) {
  const { t } = useTranslation();
  const [isCreating, setIsCreating] = useState(false);
  const [newPresetName, setNewPresetName] = useState('');
  const [selectedPresetId, setSelectedPresetId] = useState<string>('');
  const [isSaved, setIsSaved] = useState(false);
  const newPresetInputRef = useRef<HTMLInputElement>(null);
  const presets = useMemo(() => appSettings?.exportPresets ?? [], [appSettings?.exportPresets]);
  const recipeRows = useMemo(() => buildExportRecipeUiRows(presets), [presets]);
  const validRecipeCount = recipeRows.filter((row) => row.isValidRecipe).length;
  const builtInRecipeCount = recipeRows.filter((row) => row.isBuiltIn).length;

  useManagedFocus(newPresetInputRef, isCreating);

  const handleSelect = (id: string) => {
    setSelectedPresetId(id);
    const preset = presets.find((p) => p.id === id);
    if (preset) {
      onApplyPreset(preset);
    }
  };

  const handleSavePreset = () => {
    if (!newPresetName.trim() || !appSettings) return;

    const newPreset: ExportPreset = {
      id: crypto.randomUUID(),
      name: newPresetName.trim(),
      ...currentSettings,
    };

    const updatedPresets = [...presets, newPreset];
    const updatedSettings = { ...appSettings, exportPresets: updatedPresets };

    onSettingsChange(updatedSettings);

    setSelectedPresetId(newPreset.id);
    setIsCreating(false);
    setNewPresetName('');
  };

  const isDefault = selectedPresetId.startsWith('default-');

  const handleOverwritePreset = () => {
    if (!selectedPresetId || isDefault || !appSettings) return;

    const updatedPresets = presets.map((p) => {
      if (p.id === selectedPresetId) {
        return {
          ...p,
          ...currentSettings,
        };
      }
      return p;
    });

    const updatedSettings = { ...appSettings, exportPresets: updatedPresets };
    onSettingsChange(updatedSettings);

    setIsSaved(true);
    setTimeout(() => {
      setIsSaved(false);
    }, 1500);
  };

  const handleDeletePreset = () => {
    if (!selectedPresetId || !appSettings) return;

    const updatedPresets = presets.filter((p) => p.id !== selectedPresetId);
    const updatedSettings = { ...appSettings, exportPresets: updatedPresets };

    onSettingsChange(updatedSettings);
    setSelectedPresetId('');
  };

  const dropdownOptions = presets
    .filter((preset) => preset.id !== EXPORT_LAST_USED_PRESET_ID)
    .map((preset) => ({
      label: preset.name,
      value: preset.id,
    }));

  return (
    <div className="mb-8">
      <UiText variant={TextVariants.heading} className="mb-2">
        {t('ui.exportPresets.heading')}
      </UiText>

      {!isCreating ? (
        <div className="flex gap-2">
          <Dropdown
            value={selectedPresetId}
            onChange={handleSelect}
            options={dropdownOptions}
            placeholder={t('ui.exportPresets.placeholder')}
            className="w-full"
          />

          <button
            onClick={() => {
              setIsCreating(true);
            }}
            className="p-2 bg-surface hover:bg-card-active rounded-md text-text-primary transition-colors"
            data-tooltip={t('ui.exportPresets.saveAsNewTooltip')}
          >
            <Plus size={18} />
          </button>

          {selectedPresetId && !isDefault && (
            <>
              <button
                onClick={handleOverwritePreset}
                disabled={isSaved}
                className={`p-2 bg-surface hover:bg-card-active rounded-md transition-colors ${
                  isSaved ? 'text-green-500' : 'text-text-secondary'
                }`}
                data-tooltip={isSaved ? t('ui.exportPresets.savedTooltip') : t('ui.exportPresets.overwriteTooltip')}
              >
                {isSaved ? <Check size={18} /> : <Save size={18} />}
              </button>
              <button
                onClick={handleDeletePreset}
                className="p-2 bg-surface hover:bg-red-500/20 hover:text-red-500 rounded-md text-text-secondary transition-colors"
                data-tooltip={t('ui.exportPresets.deleteTooltip')}
              >
                <Trash2 size={18} />
              </button>
            </>
          )}
        </div>
      ) : (
        <div className="flex gap-2 items-center animate-in fade-in slide-in-from-top-1 duration-200">
          <input
            type="text"
            placeholder={t('ui.exportPresets.presetNamePlaceholder')}
            value={newPresetName}
            onChange={(e) => {
              setNewPresetName(e.target.value);
            }}
            ref={newPresetInputRef}
            className="grow bg-bg-primary border border-surface rounded-md p-2 text-sm text-text-primary focus:ring-accent focus:border-accent"
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                handleSavePreset();
              }
            }}
          />
          <button
            onClick={handleSavePreset}
            disabled={!newPresetName.trim()}
            className="p-2 bg-accent text-button-text rounded-md hover:bg-accent/90 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Save size={18} />
          </button>
          <button
            onClick={() => {
              setIsCreating(false);
            }}
            className="p-2 bg-surface text-text-secondary rounded-md hover:bg-card-active"
          >
            <X size={18} />
          </button>
        </div>
      )}

      {recipeRows.length > 0 && (
        <div className="mt-3 grid gap-2">
          <div
            className="grid grid-cols-3 gap-2 rounded-md border border-surface bg-bg-primary p-2 text-xs"
            data-built-in-recipe-count={builtInRecipeCount}
            data-recipe-count={recipeRows.length}
            data-testid="export-recipe-readiness-summary"
            data-valid-recipe-count={validRecipeCount}
          >
            <UiText as="span" variant={TextVariants.small} className="rounded bg-surface px-2 py-1 text-text-secondary">
              {t('ui.exportPresets.recipeCount', { count: recipeRows.length })}
            </UiText>
            <UiText as="span" variant={TextVariants.small} className="rounded bg-surface px-2 py-1 text-text-secondary">
              {t('ui.exportPresets.validRecipeCount', { count: validRecipeCount })}
            </UiText>
            <UiText as="span" variant={TextVariants.small} className="rounded bg-surface px-2 py-1 text-text-secondary">
              {t('ui.exportPresets.builtInRecipeCount', { count: builtInRecipeCount })}
            </UiText>
          </div>
          {recipeRows.map((row) => (
            <button
              className={`rounded-md border p-3 text-left transition-colors ${
                selectedPresetId === row.id
                  ? 'border-accent bg-accent/10'
                  : 'border-surface bg-bg-primary hover:bg-card-active'
              }`}
              key={row.id}
              onClick={() => {
                handleSelect(row.id);
              }}
              type="button"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <UiText as="div" variant={TextVariants.label} className="truncate">
                    {row.label}
                  </UiText>
                  <UiText as="div" variant={TextVariants.small} className="mt-1 text-text-secondary">
                    {row.subtitle}
                  </UiText>
                </div>
                {row.isValidRecipe ? (
                  <CheckCircle className="h-4 w-4 shrink-0 text-green-400" />
                ) : (
                  <TriangleAlert className="h-4 w-4 shrink-0 text-yellow-400" />
                )}
              </div>
              <div className="mt-2 flex flex-wrap gap-1">
                <span className="rounded bg-surface px-2 py-0.5 text-xs text-text-secondary">{row.resizeLabel}</span>
                <span className="rounded bg-surface px-2 py-0.5 text-xs text-text-secondary">{row.metadataLabel}</span>
                {row.isBuiltIn && (
                  <span className="rounded bg-accent/15 px-2 py-0.5 text-xs text-accent">
                    {t('ui.exportPresets.builtIn')}
                  </span>
                )}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
