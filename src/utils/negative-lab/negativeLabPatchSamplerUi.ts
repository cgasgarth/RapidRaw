import type { NegativeLabBaseFogSampleRect } from '../../schemas/negative-lab/negativeLabPresetCatalogSchemas';

export const NEGATIVE_LAB_PATCH_ROLES = ['neutral', 'highlight', 'shadow'] as const;

export type NegativeLabPatchRole = (typeof NEGATIVE_LAB_PATCH_ROLES)[number];

export type DensitometerPatchLabelKey =
  | 'modals.negativeConversion.sampleCenterPatch'
  | 'modals.negativeConversion.sampleHighlightPatch'
  | 'modals.negativeConversion.sampleLeftEdge'
  | 'modals.negativeConversion.sampleShadowPatch';

export const NEGATIVE_LAB_DENSITOMETER_PATCH_PRESETS = [
  {
    labelKey: 'modals.negativeConversion.sampleLeftEdge',
    rect: { height: 0.5, width: 0.08, x: 0.02, y: 0.25 },
    testId: 'negative-lab-patch-probe-left-edge',
  },
  {
    labelKey: 'modals.negativeConversion.sampleCenterPatch',
    rect: { height: 0.1, width: 0.1, x: 0.45, y: 0.45 },
    testId: 'negative-lab-patch-probe-center-patch',
  },
  {
    labelKey: 'modals.negativeConversion.sampleShadowPatch',
    rect: { height: 0.12, width: 0.12, x: 0.18, y: 0.72 },
    testId: 'negative-lab-patch-probe-shadow-patch',
  },
  {
    labelKey: 'modals.negativeConversion.sampleHighlightPatch',
    rect: { height: 0.1, width: 0.1, x: 0.68, y: 0.18 },
    testId: 'negative-lab-patch-probe-highlight-patch',
  },
] satisfies Array<{ labelKey: DensitometerPatchLabelKey; rect: NegativeLabBaseFogSampleRect; testId: string }>;

export interface NegativeLabPatchProbeOverlayInput {
  label: string;
  rect: NegativeLabBaseFogSampleRect;
}

export interface NegativeLabPatchProbeOverlayModel {
  label: string;
  role: NegativeLabPatchRole;
  sampleRectAttribute: string;
  testId: `negative-lab-patch-probe-overlay-${NegativeLabPatchRole}`;
}

export const getNegativeLabPatchRoleForLabelKey = (labelKey: DensitometerPatchLabelKey): NegativeLabPatchRole => {
  if (labelKey === 'modals.negativeConversion.sampleHighlightPatch') return 'highlight';
  if (labelKey === 'modals.negativeConversion.sampleShadowPatch') return 'shadow';
  return 'neutral';
};

export const getNegativeLabDensitometerLabelKeyForPatchRole = (
  role: NegativeLabPatchRole,
): DensitometerPatchLabelKey => {
  if (role === 'highlight') return 'modals.negativeConversion.sampleHighlightPatch';
  if (role === 'shadow') return 'modals.negativeConversion.sampleShadowPatch';
  return 'modals.negativeConversion.sampleCenterPatch';
};

export const formatNegativeLabSampleRectAttribute = (rect: NegativeLabBaseFogSampleRect): string =>
  `${rect.x.toFixed(4)},${rect.y.toFixed(4)},${rect.width.toFixed(4)},${rect.height.toFixed(4)}`;

export const buildNegativeLabPatchProbeOverlayModels = (
  patchProbeByRole: Partial<Record<NegativeLabPatchRole, NegativeLabPatchProbeOverlayInput>>,
): NegativeLabPatchProbeOverlayModel[] =>
  NEGATIVE_LAB_PATCH_ROLES.flatMap((role) => {
    const patchProbe = patchProbeByRole[role];
    if (patchProbe === undefined) return [];

    return [
      {
        label: patchProbe.label,
        role,
        sampleRectAttribute: formatNegativeLabSampleRectAttribute(patchProbe.rect),
        testId: `negative-lab-patch-probe-overlay-${role}`,
      },
    ];
  });
