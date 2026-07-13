import { describe, expect, test } from 'bun:test';
import { matchLookApplicationReceiptV1Schema } from '../../../packages/rawengine-schema/src/referenceMatchRuntime';
import { INITIAL_ADJUSTMENTS } from '../../../src/utils/adjustments';
import {
  buildLayerStackSidecarFromMasks,
  materializeMasksFromLayerStackSidecar,
} from '../../../src/utils/layers/layerStackCommandBridge';
import {
  applyReferenceMatchProposal,
  combineReferenceSummaries,
  createReferenceMatchAdjustmentLayer,
  createReferenceMatchAppliedDiffs,
  createReferenceMatchProposal,
  describeReferenceMatchSource,
  fingerprintReferenceMatchValue,
  getReferenceMatchLayerCompatibility,
  mergeReferenceSourceIdentities,
  type ReferenceHistogramSummary,
  type ReferenceMatchReference,
  resolveReferenceMatchRenderAdjustments,
  selectReferenceMatchReferences,
  summarizeReferenceHistogram,
  validateReferenceMatchApplicationIdentities,
} from '../../../src/utils/referenceMatch';

const summary = (overrides: Partial<ReferenceHistogramSummary> = {}): ReferenceHistogramSummary => ({
  analysisBasis: 'color-managed-editor-preview',
  blueMean: 0.4,
  clippedFraction: 0,
  greenMean: 0.4,
  lumaMean: 0.4,
  lumaSpread: 0.15,
  redMean: 0.4,
  sampleCount: 8192,
  spatialTiles: [],
  ...overrides,
});

const reference = (
  id: string,
  weight: number,
  histogramSummary: ReferenceHistogramSummary,
): ReferenceMatchReference => ({
  availability: 'available',
  adjustmentRevision: 4,
  cameraProfile: 'camera_standard',
  geometryFingerprint: `fnv1a64:${'1'.repeat(16)}`,
  geometryRevision: 2,
  graphFingerprint: `fnv1a64:${'2'.repeat(16)}`,
  id,
  label: `${id}.ARW`,
  path: `/references/${id}.ARW`,
  proofFingerprint: `fnv1a64:${'3'.repeat(16)}`,
  proofRevision: 1,
  renderUrl: `blob:${id}:render`,
  role: 'creative',
  sourceFingerprint: fingerprintReferenceMatchValue(id),
  sourceRevision: `source-revision-v1:${id.charCodeAt(0).toString(16).padStart(2, '0').repeat(32)}`,
  summary: histogramSummary,
  viewFingerprint: `fnv1a64:${'4'.repeat(16)}`,
  weight,
});

describe('color-managed reference matching', () => {
  test('presents physical and virtual-copy sources without leaking the serialized suffix into the filename', () => {
    expect(describeReferenceMatchSource('/photos/reference.ARW')).toEqual({
      label: 'reference.ARW',
      sourcePath: '/photos/reference.ARW',
      virtualCopyId: null,
    });
    expect(describeReferenceMatchSource('/photos/reference.ARW?vc=look-2')).toEqual({
      label: 'reference.ARW',
      sourcePath: '/photos/reference.ARW',
      virtualCopyId: 'look-2',
    });
  });
  test('summarizes real histogram bins and rejects incomplete analysis inputs', () => {
    const bins = (peak: number) => Array.from({ length: 256 }, (_, index) => (index === peak ? 1_000 : 0));
    const result = summarizeReferenceHistogram({
      blue: { data: bins(64) },
      green: { data: bins(128) },
      luma: { data: bins(96) },
      red: { data: bins(192) },
    });

    expect(result).toMatchObject({
      analysisBasis: 'color-managed-editor-preview',
      sampleCount: 1_000,
    });
    expect(result?.redMean).toBeCloseTo(192 / 255, 8);
    expect(result?.blueMean).toBeCloseTo(64 / 255, 8);
    expect(
      summarizeReferenceHistogram({
        blue: { data: [] },
        green: { data: [] },
        luma: { data: [] },
        red: { data: [] },
      }),
    ).toBeNull();
  });

  test('combines multiple references by weight independent of ordering', () => {
    const dark = reference('dark', 1, summary({ lumaMean: 0.2, redMean: 0.3 }));
    const bright = reference('bright', 3, summary({ lumaMean: 0.8, redMean: 0.7 }));
    const first = combineReferenceSummaries([dark, bright]);
    const reversed = combineReferenceSummaries([bright, dark]);

    expect(first).toEqual(reversed);
    expect(first?.lumaMean).toBeCloseTo(0.65, 8);
    expect(first?.redMean).toBeCloseTo(0.6, 8);
  });

  test('uses an explicit technical authority for Normalize and normalized creative contributions for Match Look', () => {
    const technical = { ...reference('technical', 9, summary({ lumaMean: 0.2 })), role: 'technical' as const };
    const creative = reference('creative', 3, summary({ lumaMean: 0.7, redMean: 0.7 }));
    const secondCreative = reference('second', 1, summary({ lumaMean: 0.5, redMean: 0.6 }));

    expect(selectReferenceMatchReferences([creative, technical], 'normalize')).toEqual([technical]);
    expect(selectReferenceMatchReferences([technical], 'match-look')).toEqual([]);

    const normalize = createReferenceMatchProposal({
      adjustments: INITIAL_ADJUSTMENTS,
      mode: 'normalize',
      references: [creative, technical],
      target: summary({ lumaMean: 0.4 }),
    });
    expect(normalize?.effectiveReferences).toEqual([
      { role: 'technical', sourceFingerprint: technical.sourceFingerprint, weight: 1 },
    ]);

    const match = createReferenceMatchProposal({
      adjustments: INITIAL_ADJUSTMENTS,
      mode: 'match-look',
      references: [creative, technical, secondCreative],
      target: summary({ lumaMean: 0.3, redMean: 0.3 }),
    });
    expect(match?.effectiveReferences.map(({ role, weight }) => ({ role, weight }))).toEqual([
      { role: 'creative', weight: 0.75 },
      { role: 'creative', weight: 0.25 },
    ]);
  });

  test('detects same-path source replacement without discarding the cached reference artifact identity', () => {
    const source = reference('offline', 1, summary());
    const [replaced] = mergeReferenceSourceIdentities(
      [source],
      new Map([[source.path, { available: true, sourceRevision: `source-revision-v1:${'f'.repeat(64)}` }]]),
    );
    expect(replaced).toMatchObject({ availability: 'replaced', id: source.id, renderUrl: source.renderUrl });
    const [missing] = mergeReferenceSourceIdentities(
      [source],
      new Map([[source.path, { available: false, sourceRevision: null }]]),
    );
    expect(missing).toMatchObject({ availability: 'missing', id: source.id, renderUrl: source.renderUrl });
    if (!missing) throw new Error('Expected reference');
    expect(mergeReferenceSourceIdentities([missing], new Map([[source.path, null]]))[0]?.availability).toBe('unknown');
    expect(
      mergeReferenceSourceIdentities(
        [source],
        new Map([[source.path, { available: true, sourceRevision: source.sourceRevision }]]),
      )[0]?.availability,
    ).toBe('available');
  });

  test('revalidates every effective physical source identity immediately before Apply', () => {
    const source = reference('apply-source', 1, summary());
    const proposal = createReferenceMatchProposal({
      adjustments: INITIAL_ADJUSTMENTS,
      mode: 'match-look',
      references: [source],
      target: summary({ lumaMean: 0.2, redMean: 0.2 }),
    });
    if (!proposal) throw new Error('Expected proposal');

    expect(
      validateReferenceMatchApplicationIdentities(
        proposal,
        [source],
        new Map([[source.path, { available: true, sourceRevision: source.sourceRevision }]]),
      ),
    ).toEqual({ failure: null, valid: true });
    expect(
      validateReferenceMatchApplicationIdentities(
        proposal,
        [source],
        new Map([[source.path, { available: true, sourceRevision: `source-revision-v1:${'f'.repeat(64)}` }]]),
      ),
    ).toEqual({ failure: 'reference-replaced', valid: false });
    expect(validateReferenceMatchApplicationIdentities(proposal, [], new Map())).toEqual({
      failure: 'reference-set-changed',
      valid: false,
    });
  });

  test('keeps Normalize technical and exposes a broader allow-listed Match Look proposal', () => {
    const target = summary({ blueMean: 0.45, greenMean: 0.4, lumaMean: 0.25, lumaSpread: 0.08, redMean: 0.35 });
    const warmReference = reference(
      'warm',
      1,
      summary({ blueMean: 0.3, greenMean: 0.42, lumaMean: 0.5, lumaSpread: 0.18, redMean: 0.62 }),
    );
    const normalize = createReferenceMatchProposal({
      adjustments: INITIAL_ADJUSTMENTS,
      mode: 'normalize',
      references: [warmReference],
      target,
    });
    const match = createReferenceMatchProposal({
      adjustments: INITIAL_ADJUSTMENTS,
      mode: 'match-look',
      references: [warmReference],
      target,
    });

    expect(normalize?.diffs.map((diff) => diff.key)).toEqual(['exposure', 'contrast']);
    expect(match?.diffs.map((diff) => diff.key)).toEqual([
      'exposure',
      'contrast',
      'creativeTemperature',
      'creativeTint',
      'saturation',
      'vibrance',
    ]);
    expect(match?.residualAfter).toBeLessThan(match?.residualBefore ?? 0);
    expect(match?.diffs.find((diff) => diff.key === 'creativeTemperature')?.proposed).toBeGreaterThan(0);
  });

  test('Impact 0 is exact no-op, Impact 100 applies exact diffs, and groups are independently gated', () => {
    const proposal = createReferenceMatchProposal({
      adjustments: INITIAL_ADJUSTMENTS,
      mode: 'match-look',
      references: [reference('look', 1, summary({ lumaMean: 0.7, redMean: 0.7 }))],
      target: summary({ lumaMean: 0.3, redMean: 0.3 }),
    });
    if (!proposal) throw new Error('Expected proposal');

    expect(
      applyReferenceMatchProposal({
        adjustments: INITIAL_ADJUSTMENTS,
        enabledGroups: new Set(['color', 'presence', 'tone']),
        impact: 0,
        proposal,
      }),
    ).toEqual(INITIAL_ADJUSTMENTS);

    const toneOnly = applyReferenceMatchProposal({
      adjustments: INITIAL_ADJUSTMENTS,
      enabledGroups: new Set(['tone']),
      impact: 100,
      proposal,
    });
    expect(toneOnly.exposure).toBe(proposal.diffs.find((diff) => diff.key === 'exposure')?.proposed);
    expect(toneOnly.creativeTemperature).toBe(INITIAL_ADJUSTMENTS.creativeTemperature);
    expect(toneOnly.cameraProfile).toBe(INITIAL_ADJUSTMENTS.cameraProfile);
    expect(toneOnly.crop).toBe(INITIAL_ADJUSTMENTS.crop);
  });

  test('creates a compatible full-frame layer with Impact encoded in nodes and provenance surviving sidecar reopen', () => {
    const proposal = createReferenceMatchProposal({
      adjustments: INITIAL_ADJUSTMENTS,
      mode: 'normalize',
      references: [reference('normalized', 1, summary({ lumaMean: 0.7, lumaSpread: 0.22 }))],
      target: summary({ lumaMean: 0.3, lumaSpread: 0.08 }),
    });
    if (!proposal) throw new Error('Expected proposal');
    const groups = new Set<ReferenceMatchGroup>(['tone']);
    const receipt = matchLookApplicationReceiptV1Schema.parse({
      appliedDiffs: createReferenceMatchAppliedDiffs({
        adjustments: INITIAL_ADJUSTMENTS,
        enabledGroups: groups,
        impact: 40,
        proposal,
      }),
      appliedAt: '2026-07-13T12:00:00.000Z',
      destination: 'adjustment-layer',
      effectiveReferences: proposal.effectiveReferences,
      enabledGroups: ['tone'],
      historyEntriesAdded: 1,
      impact: 40,
      layerId: 'reference-layer',
      proposalFingerprint: proposal.proposalFingerprint,
      resultingGraphFingerprint: fingerprintReferenceMatchValue('reference-layer-graph'),
      schemaVersion: 1,
      targetAnalysisFingerprint: proposal.targetAnalysisFingerprint,
    });
    expect(receipt.appliedDiffs).toEqual(
      proposal.diffs
        .filter((diff) => diff.group === 'tone')
        .map((diff) => ({
          after: INITIAL_ADJUSTMENTS[diff.key] + (diff.proposed - diff.current) * 0.4,
          before: INITIAL_ADJUSTMENTS[diff.key],
          key: diff.key,
        }))
        .sort((left, right) => left.key.localeCompare(right.key)),
    );
    const layer = createReferenceMatchAdjustmentLayer({
      enabledGroups: groups,
      id: 'reference-layer',
      impact: 40,
      name: 'Reference Normalize',
      proposal,
      receipt,
    });
    const exposure = proposal.diffs.find((diff) => diff.key === 'exposure');
    expect(layer.opacity).toBe(100);
    expect(layer.adjustments.exposure).toBeCloseTo(((exposure?.proposed ?? 0) - (exposure?.current ?? 0)) * 0.4);

    const sidecar = buildLayerStackSidecarFromMasks([layer], {
      graphRevision: 'reference-match-layer-v1',
      imagePath: '/photos/target.ARW',
      operationId: 'persist-reference-match-layer',
      sessionId: 'reference-match-test',
    });
    expect(sidecar.layers[0]?.referenceMatchApplicationReceipt).toEqual(receipt);
    expect(materializeMasksFromLayerStackSidecar(sidecar)[0]?.referenceMatchApplicationReceipt).toEqual(receipt);
  });

  test('abstains from layer apply for unsupported selected nodes and keeps Impact updates bounded', () => {
    const proposal = createReferenceMatchProposal({
      adjustments: INITIAL_ADJUSTMENTS,
      mode: 'match-look',
      references: [reference('look', 1, summary({ blueMean: 0.2, lumaMean: 0.7, redMean: 0.75 }))],
      target: summary({ blueMean: 0.5, lumaMean: 0.3, redMean: 0.25 }),
    });
    if (!proposal) throw new Error('Expected proposal');
    const allGroups = new Set<ReferenceMatchGroup>(['color', 'presence', 'tone']);
    expect(getReferenceMatchLayerCompatibility(proposal, allGroups)).toEqual({
      supported: false,
      unsupportedKeys: ['creativeTemperature', 'creativeTint', 'vibrance'],
    });
    expect(getReferenceMatchLayerCompatibility(proposal, new Set(['tone']))).toEqual({
      supported: true,
      unsupportedKeys: [],
    });

    const startedAt = performance.now();
    for (let impact = 0; impact < 10_000; impact += 1) {
      applyReferenceMatchProposal({
        adjustments: INITIAL_ADJUSTMENTS,
        enabledGroups: allGroups,
        impact: impact % 101,
        proposal,
      });
    }
    expect(performance.now() - startedAt).toBeLessThan(750);
  });

  test('renders a preview only for its exact target and committed graph revision', () => {
    const previewAdjustments = { ...INITIAL_ADJUSTMENTS, exposure: 1.25 };
    const preview = {
      adjustments: previewAdjustments,
      baseAdjustmentRevision: 7,
      targetPath: '/photos/target.ARW',
    };
    expect(
      resolveReferenceMatchRenderAdjustments({
        adjustmentRevision: 7,
        committed: INITIAL_ADJUSTMENTS,
        preview,
        targetPath: '/photos/target.ARW',
      }),
    ).toBe(previewAdjustments);
    expect(
      resolveReferenceMatchRenderAdjustments({
        adjustmentRevision: 8,
        committed: INITIAL_ADJUSTMENTS,
        preview,
        targetPath: '/photos/target.ARW',
      }),
    ).toBe(INITIAL_ADJUSTMENTS);
    expect(
      resolveReferenceMatchRenderAdjustments({
        adjustmentRevision: 7,
        committed: INITIAL_ADJUSTMENTS,
        preview,
        targetPath: '/photos/other.ARW',
      }),
    ).toBe(INITIAL_ADJUSTMENTS);
  });

  test('reports clipping, proof/profile incompatibility, and localized-analysis limits without replacing profile', () => {
    const incompatible = {
      ...reference('incompatible', 1, summary({ clippedFraction: 0.08, lumaMean: 0.7, redMean: 0.65 })),
      cameraProfile: 'camera_portrait',
      proofFingerprint: fingerprintReferenceMatchValue('proof:other'),
    };
    const proposal = createReferenceMatchProposal({
      adjustments: INITIAL_ADJUSTMENTS,
      mode: 'match-look',
      references: [incompatible],
      target: summary(),
      targetProfile: INITIAL_ADJUSTMENTS.cameraProfile,
      targetProofFingerprint: fingerprintReferenceMatchValue('proof:target'),
    });
    expect(proposal?.warnings).toEqual(
      expect.arrayContaining([
        'Clipped histogram endpoints reduce match reliability.',
        'Reference and target proof identities differ.',
        'Reference and target camera profiles differ; profile replacement is excluded.',
        'Spatial analysis is unavailable; inspect localized subject differences before apply.',
      ]),
    );
    expect(proposal?.diffs.some((diff) => diff.key === 'cameraProfile')).toBe(false);
  });

  test('uses coarse spatial tiles to warn when a localized mismatch is unsafe to fit globally', () => {
    const tiles = (values: number[]) =>
      values.map((lumaMean, index) => ({
        blueMean: lumaMean,
        clippedFraction: 0,
        greenMean: lumaMean,
        lumaMean,
        lumaSpread: 0.05,
        redMean: lumaMean,
        sampleCount: 512,
        x: index % 4,
        y: Math.floor(index / 4),
      }));
    const localized = createReferenceMatchProposal({
      adjustments: INITIAL_ADJUSTMENTS,
      mode: 'normalize',
      references: [reference('localized', 1, summary({ lumaMean: 0.5, spatialTiles: tiles([0.9, 0.1, 0.1, 0.1]) }))],
      target: summary({ lumaMean: 0.3, spatialTiles: tiles([0.3, 0.3, 0.3, 0.3]) }),
    });
    expect(localized?.warnings).toContain(
      'Spatial tiles disagree with a global match; localized subject differences reduce reliability.',
    );
    expect(localized?.confidence).toBeLessThan(0.98);
  });
});
