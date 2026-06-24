#!/usr/bin/env bun

import { readFileSync } from 'node:fs';

import { buildLayerGroupWorkflowProof, groupLayerWithNext, ungroupLayerGroup } from '../../../src/utils/layerStack.ts';
import {
  DEFAULT_LAYER_BLEND_MODE,
  INITIAL_MASK_ADJUSTMENTS,
  type MaskContainer,
} from '../../../src/utils/adjustments.ts';

const locale = JSON.parse(readFileSync('src/i18n/locales/en.json', 'utf8'));
const layerLocale = locale.editor?.layers;
const requiredLocaleKeys = [
  'groupSummaryCount',
  'groupSummaryCount_one',
  'groupSummaryCount_other',
  'hiddenLayerCount',
  'hiddenLayerCount_one',
  'hiddenLayerCount_other',
  'layerCount',
  'visibleLayerCount',
];
const requiredExportReadinessLocaleKeys = ['summary', 'title'];
const requiredOperationReadinessLocaleKeys = [
  'groupBlocked',
  'groupReady',
  'moveBlocked',
  'moveReady',
  'ungroupBlocked',
  'ungroupReady',
];
const requiredActionLocaleKeys = ['showAllHidden', 'soloActive'];
const requiredActiveRenderStateKeys = ['hidden', 'summary', 'title', 'visible'];
const requiredCloneKeys = ['cloneRowSummary', 'newCloneLayerName'];

const missingKeys = requiredLocaleKeys.filter((key) => typeof layerLocale?.[key] !== 'string');
if (missingKeys.length > 0) {
  console.error(`Missing layer stack panel locale keys: ${missingKeys.join(', ')}`);
  process.exit(1);
}

const missingActionKeys = requiredActionLocaleKeys.filter((key) => typeof layerLocale?.actions?.[key] !== 'string');
if (missingActionKeys.length > 0) {
  console.error(`Missing layer stack panel action locale keys: ${missingActionKeys.join(', ')}`);
  process.exit(1);
}
if (typeof layerLocale?.actions?.createCloneLayer !== 'string') {
  console.error('Missing layer stack clone action locale key: editor.layers.actions.createCloneLayer');
  process.exit(1);
}
const missingCloneKeys = requiredCloneKeys.filter((key) => typeof layerLocale?.[key] !== 'string');
if (missingCloneKeys.length > 0) {
  console.error(`Missing layer stack clone locale keys: ${missingCloneKeys.join(', ')}`);
  process.exit(1);
}

const missingActiveRenderStateKeys = requiredActiveRenderStateKeys.filter(
  (key) => typeof layerLocale?.activeRenderState?.[key] !== 'string',
);
if (missingActiveRenderStateKeys.length > 0) {
  console.error(`Missing layer active render-state locale keys: ${missingActiveRenderStateKeys.join(', ')}`);
  process.exit(1);
}

const missingExportReadinessKeys = requiredExportReadinessLocaleKeys.filter(
  (key) => typeof layerLocale?.exportReadiness?.[key] !== 'string',
);
if (missingExportReadinessKeys.length > 0) {
  console.error(`Missing layer export readiness locale keys: ${missingExportReadinessKeys.join(', ')}`);
  process.exit(1);
}

const missingOperationReadinessKeys = requiredOperationReadinessLocaleKeys.filter(
  (key) => typeof layerLocale?.operationReadiness?.[key] !== 'string',
);
if (missingOperationReadinessKeys.length > 0) {
  console.error(`Missing layer operation readiness locale keys: ${missingOperationReadinessKeys.join(', ')}`);
  process.exit(1);
}

const source = readFileSync('src/components/panel/right/LayerStackPanel.tsx', 'utf8');
for (const marker of [
  'data-testid="layer-stack-composition-summary"',
  'data-testid="layer-stack-count-summary"',
  'data-collapsed-group-count={groupWorkflowProof.collapsedGroupCount}',
  'data-collapsed-group-ids={groupWorkflowProof.collapsedGroupIds.join',
  'data-hidden-group-count={groupWorkflowProof.hiddenGroupCount}',
  'data-grouped-layer-count={groupWorkflowProof.groupedLayerCount}',
  'data-mixed-group-count={groupWorkflowProof.mixedGroupCount}',
  'data-visible-group-count={groupWorkflowProof.visibleGroupCount}',
  'data-visible-order={groupWorkflowProof.visibleOrder.join',
  "layer-stack-group-row-${row.groupId ?? 'unknown'}",
  'layer-stack-layer-row-${row.id}',
  'data-group-collapsed={String(row.isGroupCollapsed)}',
  'data-group-visible-state={row.isGroupHeader ? row.visibleState :',
  'data-grouped-layer={String(row.isGroupedLayer)}',
  'buildLayerGroupWorkflowProof(masks, collapsedGroupIds)',
  'data-testid="layer-hidden-count"',
  'data-testid="layer-active-action-strip"',
  'data-testid="layer-active-render-state"',
  'data-active-layer-id={activeRow.id}',
  'data-active-layer-adjustment-count={activeRow.adjustmentKeys.length}',
  'data-active-layer-adjustment-keys={activeRow.adjustmentKeys.join',
  'data-active-layer-opacity={activeRow.opacity}',
  'data-active-layer-visible={String(activeRow.visible)}',
  'data-active-layer-visible-state={activeRow.visibleState}',
  'data-testid="layer-export-readiness-summary"',
  'data-testid="layer-operation-readiness-summary"',
  'data-layer-stack-graph-revision={layerGraphRevision}',
  'data-layer-stack-last-command-type={lastCommandType}',
  'data-layer-stack-last-changed-layer-count={lastChangedLayerCount}',
  'data-retouch-clone-source={row.retouchCloneSourceLabel ??',
  'applyLayerStackCommandBridgeOperation',
  'data-testid="layer-create-clone-layer"',
  'data-testid="layer-operation-move-ready"',
  'data-testid="layer-operation-group-ready"',
  'data-testid="layer-operation-ungroup-ready"',
  'data-testid="layer-active-solo"',
  'data-testid="layer-show-all-hidden"',
  'data-testid="layer-icon-action-row"',
  'data-exportable-layer-count={exportReadiness.exportableLayerCount}',
  'data-masked-layer-count={exportReadiness.maskedLayerCount}',
  'buildLayerExportReadinessSummary(masks)',
  'data-visible-layer-count={visibleLayerCount}',
  'data-hidden-layer-count={hiddenLayerCount}',
  'data-solo-active={String(isActiveLayerSoloed)}',
  'data-can-move-active-layer={String(canMoveActiveLayerUp || canMoveActiveLayerDown)}',
  'data-can-group-active-layer={String(canGroupActiveLayer)}',
  'data-can-ungroup-active-layer={String(canUngroupActiveLayer)}',
  'data-group-count={groupCount}',
  'editor.layers.exportReadiness.title',
  'editor.layers.exportReadiness.summary',
  'editor.layers.hiddenLayerCount',
  'editor.layers.groupSummaryCount',
  'editor.layers.actions.soloActive',
  'editor.layers.actions.showAllHidden',
  'editor.layers.actions.createCloneLayer',
  'editor.layers.activeRenderState.title',
  'editor.layers.cloneRowSummary',
  'editor.layers.newCloneLayerName',
  'editor.layers.activeRenderState.summary',
  'editor.layers.activeRenderState.visible',
  'editor.layers.activeRenderState.hidden',
  'editor.layers.operationReadiness.moveReady',
  'editor.layers.operationReadiness.groupReady',
  'editor.layers.operationReadiness.ungroupReady',
]) {
  if (!source.includes(marker)) {
    console.error(`Layer stack panel missing count summary marker: ${marker}`);
    process.exit(1);
  }
}

const sampleLayers: MaskContainer[] = [
  {
    adjustments: structuredClone(INITIAL_MASK_ADJUSTMENTS),
    blendMode: DEFAULT_LAYER_BLEND_MODE,
    id: 'layer_a',
    invert: false,
    name: 'Layer A',
    opacity: 100,
    subMasks: [],
    visible: true,
  },
  {
    adjustments: structuredClone(INITIAL_MASK_ADJUSTMENTS),
    blendMode: DEFAULT_LAYER_BLEND_MODE,
    id: 'layer_b',
    invert: false,
    name: 'Layer B',
    opacity: 75,
    subMasks: [],
    visible: true,
  },
  {
    adjustments: structuredClone(INITIAL_MASK_ADJUSTMENTS),
    blendMode: DEFAULT_LAYER_BLEND_MODE,
    id: 'layer_c',
    invert: false,
    name: 'Layer C',
    opacity: 50,
    subMasks: [],
    visible: true,
  },
];
const groupedLayers = groupLayerWithNext(sampleLayers, 'layer_a', 'group_alpha', 'Proof group');
const collapsedProof = buildLayerGroupWorkflowProof(groupedLayers, new Set(['group_alpha']));
if (
  collapsedProof.groupCount !== 1 ||
  collapsedProof.groupedLayerCount !== 2 ||
  collapsedProof.collapsedGroupIds.join(',') !== 'group_alpha' ||
  collapsedProof.visibleGroupCount !== 1 ||
  collapsedProof.mixedGroupCount !== 0 ||
  collapsedProof.visibleOrder.join(',') !== 'layer_a,layer_b,layer_c'
) {
  console.error('Layer group workflow proof did not preserve group, collapse, and visible order metadata.');
  process.exit(1);
}

const ungroupedProof = buildLayerGroupWorkflowProof(ungroupLayerGroup(groupedLayers, 'group_alpha'));
if (ungroupedProof.groupCount !== 0 || ungroupedProof.groupedLayerCount !== 0) {
  console.error('Layer group workflow proof did not clear group metadata after ungroup.');
  process.exit(1);
}

const mixedGroupProof = buildLayerGroupWorkflowProof(
  groupedLayers.map((layer) => (layer.id === 'layer_b' ? { ...layer, visible: false } : layer)),
);
if (
  mixedGroupProof.mixedGroupCount !== 1 ||
  mixedGroupProof.visibleGroupCount !== 0 ||
  mixedGroupProof.hiddenGroupCount !== 0 ||
  mixedGroupProof.groups[0]?.visibleState !== 'mixed'
) {
  console.error('Layer group workflow proof did not expose mixed parent visibility state.');
  process.exit(1);
}

console.log('layer stack panel UI ok');
