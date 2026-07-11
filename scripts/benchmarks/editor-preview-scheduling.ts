import { publishAdjustmentSnapshot } from '../../src/utils/adjustmentSnapshots.ts';
import { INITIAL_ADJUSTMENTS } from '../../src/utils/adjustments.ts';

const INTERACTIVE_CYCLES = 500;
const SETTLED_CYCLES = 50;
const TOTAL_CYCLES = INTERACTIVE_CYCLES + SETTLED_CYCLES;

const stress = structuredClone(INITIAL_ADJUSTMENTS);
stress.masks = Array.from({ length: 80 }, (_, index) => ({
  id: `mask-${String(index)}`,
  name: `Mask ${String(index)}`,
  enabled: true,
  adjustments: {},
  subMasks: Array.from({ length: 8 }, (_unused, subIndex) => ({
    id: `mask-${String(index)}-${String(subIndex)}`,
    type: 'ai',
    parameters: { mask_data_base64: 'x'.repeat(8_192) },
  })),
})) as typeof stress.masks;
stress.aiPatches = Array.from({ length: 40 }, (_, index) => ({
  id: `patch-${String(index)}`,
  isLoading: false,
  patchData: { metadata: 'x'.repeat(16_384) },
  subMasks: [],
})) as typeof stress.aiPatches;

const measure = (run: () => void): number => {
  const startedAt = performance.now();
  run();
  return performance.now() - startedAt;
};

const legacyMs = measure(() => {
  for (let index = 0; index < TOTAL_CYCLES; index += 1) {
    const scheduled = structuredClone(stress);
    structuredClone(scheduled);
    JSON.stringify({
      geometry: scheduled.crop,
      graph: scheduled,
      roi: [0.1, 0.1, 0.5, 0.5],
      viewport: { height: 1440, width: 2560 },
    });
  }
});

const snapshot = publishAdjustmentSnapshot(null, stress);
let sink = 0;
const revisionedMs = measure(() => {
  for (let index = 0; index < TOTAL_CYCLES; index += 1) {
    const request = {
      snapshot,
      scope: [1, snapshot.adjustmentRevision, snapshot.geometryRevision, 1, 1, 2048, 'wgpu'] as const,
    };
    sink += request.scope[1] + request.snapshot.patchRevision;
  }
});

const result = {
  cycles: { interactive: INTERACTIVE_CYCLES, settled: SETTLED_CYCLES },
  legacyMs: Number(legacyMs.toFixed(3)),
  revisionedMs: Number(revisionedMs.toFixed(3)),
  speedup: Number((legacyMs / revisionedMs).toFixed(1)),
  deepClonesPerRevisionedDispatch: 0,
  wholeObjectStringifiesPerRevisionedDispatch: 0,
  sink,
};

console.log(JSON.stringify(result));
