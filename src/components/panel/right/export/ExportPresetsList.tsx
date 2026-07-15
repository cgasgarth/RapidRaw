import { Check, CheckCircle, Plus, Save, Trash2, TriangleAlert, X } from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useManagedFocus } from '../../../../hooks/ui/useManagedFocus';
import { EXPORT_LAST_USED_PRESET_ID } from '../../../../schemas/export/exportRecipeIds';
import {
  buildCurrentExportRecipe,
  type ExportRecipeSettings,
  exportRecipeSchema,
} from '../../../../schemas/export/exportRecipeSchemas';
import { buildExportRecipeUiRows } from '../../../../schemas/export/exportRecipeUiSchemas';
import { useEditorStore } from '../../../../store/useEditorStore';
import { TextVariants } from '../../../../types/typography';
import { EXPORT_SOFT_PROOF_RESOLVER_PRESET_ID } from '../../../../utils/export/exportSoftProofProfileCompare';
import { resolveExportSoftProofRecipe } from '../../../../utils/export/exportSoftProofRecipeSelection';
import type { AppSettings } from '../../../ui/AppProperties';
import type { ExportPreset } from '../../../ui/ExportImportProperties';
import Dropdown from '../../../ui/primitives/Dropdown';
import UiText from '../../../ui/primitives/Text';

interface ExportPresetsListProps {
  appSettings: AppSettings | null;
  currentSettings: ExportRecipeSettings;
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
  const [activePresetId, setActivePresetId] = useState<string>('');
  const [selectedRecordId, setSelectedRecordId] = useState<string>('');
  const [isSaved, setIsSaved] = useState(false);
  const newPresetInputRef = useRef<HTMLInputElement>(null);
  const presets = useMemo(() => appSettings?.exportPresets ?? [], [appSettings?.exportPresets]);
  const recipeRows = useMemo(() => buildExportRecipeUiRows(presets), [presets]);
  const validRecipeCount = recipeRows.filter((row) => row.isValidRecipe).length;
  const builtInRecipeCount = recipeRows.filter((row) => row.isBuiltIn).length;
  const selectedRow = useMemo(
    () => recipeRows.find((recipe) => recipe.id === selectedRecordId),
    [recipeRows, selectedRecordId],
  );
  const normalizedSelectedPreset = useMemo(() => {
    const parsed = exportRecipeSchema.safeParse(selectedRow?.settings);
    return parsed.success ? parsed.data : null;
  }, [selectedRow]);
  const isSelectedPresetEdited =
    normalizedSelectedPreset !== null &&
    Object.entries(currentSettings).some(
      ([key, value]) => !Object.is(normalizedSelectedPreset[key as keyof ExportPreset], value),
    );

  useManagedFocus(newPresetInputRef, isCreating);

  const commitPresets = (updatedSettings: AppSettings) => {
    onSettingsChange(updatedSettings);
    const editor = useEditorStore.getState();
    const resolvedProof = resolveExportSoftProofRecipe({
      enabled: editor.isExportSoftProofEnabled,
      presets: updatedSettings.exportPresets ?? [],
      requestedRecipeId: editor.exportSoftProofRecipeId,
    });
    editor.setEditor({
      exportSoftProofRecipeId: resolvedProof.recipeId,
      isExportSoftProofEnabled: resolvedProof.enabled,
    });
  };

  const handleSelect = (id: string) => {
    setSelectedRecordId(id);
    const row = recipeRows.find((recipe) => recipe.id === id);
    const parsed = exportRecipeSchema.safeParse(row?.settings);
    if (parsed.success) {
      setActivePresetId(id);
      onApplyPreset(parsed.data);
    }
  };

  const handleSavePreset = () => {
    if (!newPresetName.trim() || !appSettings) return;

    const newPreset = buildCurrentExportRecipe({
      id: crypto.randomUUID(),
      name: newPresetName.trim(),
      settings: currentSettings,
    });

    const updatedPresets = [...presets, newPreset];
    const updatedSettings = { ...appSettings, exportPresets: updatedPresets };

    commitPresets(updatedSettings);

    setActivePresetId(newPreset.id);
    setSelectedRecordId(newPreset.id);
    setIsCreating(false);
    setNewPresetName('');
  };

  const canOverwriteSelected = selectedRow !== undefined && (!selectedRow.isBuiltIn || !selectedRow.isValidRecipe);

  const handleOverwritePreset = () => {
    if (!canOverwriteSelected || !appSettings || selectedRow === undefined) return;

    const replacement = buildCurrentExportRecipe({
      id: selectedRow.id,
      name: selectedRow.label,
      settings: currentSettings,
    });

    const updatedPresets = presets.map((p) => {
      return p === selectedRow.settings ? replacement : p;
    });

    const updatedSettings = { ...appSettings, exportPresets: updatedPresets };
    commitPresets(updatedSettings);
    setActivePresetId(replacement.id);

    setIsSaved(true);
    setTimeout(() => {
      setIsSaved(false);
    }, 1500);
  };

  const handleDeletePreset = () => {
    if (!selectedRecordId || !appSettings || selectedRow === undefined || selectedRow.isBuiltIn) return;

    const updatedPresets = presets.filter((preset) => preset !== selectedRow.settings);
    const updatedSettings = { ...appSettings, exportPresets: updatedPresets };

    commitPresets(updatedSettings);
    if (activePresetId === selectedRecordId) setActivePresetId('');
    setSelectedRecordId('');
  };

  const dropdownOptions = recipeRows
    .filter(
      (recipe) =>
        recipe.isValidRecipe &&
        recipe.id !== EXPORT_LAST_USED_PRESET_ID &&
        recipe.id !== EXPORT_SOFT_PROOF_RESOLVER_PRESET_ID,
    )
    .map((recipe) => ({
      label: recipe.label,
      value: recipe.id,
    }));

  return (
    <section className="border-b border-surface pb-3" data-testid="export-recipe-picker">
      <div className="mb-2 flex min-w-0 items-center justify-between gap-2">
        <UiText variant={TextVariants.heading}>{t('ui.exportPresets.heading')}</UiText>
        {selectedRow?.isValidRecipe ? (
          <span className="truncate text-xs text-text-secondary" data-testid="export-selected-recipe-status">
            {isSelectedPresetEdited ? t('ui.exportPresets.edited') : t('ui.exportPresets.current')}
          </span>
        ) : null}
      </div>

      {!isCreating ? (
        <div className="flex min-w-0 gap-1.5">
          <Dropdown
            value={activePresetId}
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
            aria-label={t('ui.exportPresets.saveAsNewTooltip')}
            data-tooltip={t('ui.exportPresets.saveAsNewTooltip')}
            type="button"
          >
            <Plus size={18} />
          </button>

          {selectedRecordId && canOverwriteSelected && (
            <>
              <button
                onClick={handleOverwritePreset}
                disabled={isSaved}
                aria-label={isSaved ? t('ui.exportPresets.savedTooltip') : t('ui.exportPresets.overwriteTooltip')}
                className={`p-2 bg-surface hover:bg-card-active rounded-md transition-colors ${
                  isSaved ? 'text-green-500' : 'text-text-secondary'
                }`}
                data-tooltip={isSaved ? t('ui.exportPresets.savedTooltip') : t('ui.exportPresets.overwriteTooltip')}
                type="button"
              >
                {isSaved ? <Check size={18} /> : <Save size={18} />}
              </button>
              <button
                onClick={handleDeletePreset}
                disabled={selectedRow?.isBuiltIn}
                aria-label={t('ui.exportPresets.deleteTooltip')}
                className="p-2 bg-surface hover:bg-red-500/20 hover:text-red-500 rounded-md text-text-secondary transition-colors disabled:cursor-not-allowed disabled:opacity-40"
                data-tooltip={t('ui.exportPresets.deleteTooltip')}
                type="button"
              >
                <Trash2 size={18} />
              </button>
            </>
          )}
        </div>
      ) : (
        <div className="flex items-center gap-1.5 animate-in fade-in slide-in-from-top-1 duration-200">
          <input
            type="text"
            placeholder={t('ui.exportPresets.presetNamePlaceholder')}
            value={newPresetName}
            onChange={(e) => {
              setNewPresetName(e.target.value);
            }}
            ref={newPresetInputRef}
            className="grow bg-bg-primary border border-surface rounded-md p-2 text-sm text-text-primary focus:ring-accent focus:border-accent"
            aria-label={t('ui.exportPresets.presetNamePlaceholder')}
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
            aria-label={t('ui.exportPresets.saveAsNewTooltip')}
            data-tooltip={t('ui.exportPresets.saveAsNewTooltip')}
            type="button"
          >
            <Save size={18} />
          </button>
          <button
            onClick={() => {
              setIsCreating(false);
            }}
            className="p-2 bg-surface text-text-secondary rounded-md hover:bg-card-active"
            aria-label={t('ui.exportPresets.cancelTooltip')}
            data-tooltip={t('ui.exportPresets.cancelTooltip')}
            type="button"
          >
            <X size={18} />
          </button>
        </div>
      )}

      {recipeRows.length > 0 && (
        <div className="mt-2 grid gap-1.5">
          <div
            className="flex flex-wrap gap-x-3 gap-y-1 border-y border-surface py-1.5 text-xs"
            data-built-in-recipe-count={builtInRecipeCount}
            data-recipe-count={recipeRows.length}
            data-testid="export-recipe-readiness-summary"
            data-valid-recipe-count={validRecipeCount}
          >
            <UiText as="span" variant={TextVariants.small} className="text-text-secondary">
              {t('ui.exportPresets.recipeCount', { count: recipeRows.length })}
            </UiText>
            <UiText as="span" variant={TextVariants.small} className="text-text-secondary">
              {t('ui.exportPresets.validRecipeCount', { count: validRecipeCount })}
            </UiText>
            <UiText as="span" variant={TextVariants.small} className="text-text-secondary">
              {t('ui.exportPresets.builtInRecipeCount', { count: builtInRecipeCount })}
            </UiText>
          </div>
          <div aria-label={t('ui.exportPresets.recipeListLabel')} className="max-h-44 overflow-y-auto" role="list">
            {recipeRows.map((row) => (
              <button
                aria-pressed={activePresetId === row.id}
                className={`flex w-full min-w-0 items-center gap-2 border-b border-surface px-1.5 py-2 text-left transition-colors last:border-b-0 ${
                  activePresetId === row.id
                    ? 'bg-accent/10'
                    : selectedRecordId === row.id
                      ? 'bg-yellow-500/10'
                      : 'hover:bg-card-active'
                }`}
                data-repair-target={selectedRecordId === row.id}
                data-recipe-state={
                  !row.isValidRecipe
                    ? 'invalid'
                    : activePresetId === row.id && isSelectedPresetEdited
                      ? 'edited'
                      : 'ready'
                }
                data-tooltip={row.label}
                key={row.id}
                onClick={() => {
                  handleSelect(row.id);
                }}
                type="button"
              >
                {row.isValidRecipe ? (
                  <CheckCircle className="h-4 w-4 shrink-0 text-green-400" />
                ) : (
                  <TriangleAlert className="h-4 w-4 shrink-0 text-yellow-400" />
                )}
                <div className="min-w-0 flex-1">
                  <UiText as="div" variant={TextVariants.label} className="truncate">
                    {row.label}
                  </UiText>
                  <UiText as="div" variant={TextVariants.small} className="truncate text-text-secondary">
                    {row.subtitle}
                  </UiText>
                </div>
                <span className="shrink-0 text-xs text-text-secondary">
                  {!row.isValidRecipe
                    ? t('ui.exportPresets.invalid')
                    : activePresetId === row.id && isSelectedPresetEdited
                      ? t('ui.exportPresets.edited')
                      : row.isBuiltIn
                        ? t('ui.exportPresets.builtIn')
                        : row.resizeLabel}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
