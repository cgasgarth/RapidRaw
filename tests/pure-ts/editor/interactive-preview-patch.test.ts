import { expect, test } from 'bun:test';
import { resolveEditorPreviewSource } from '../../../src/utils/editorImagePreviewSource.ts';
import {
  decodeInteractivePreviewUrl,
  InteractivePreviewGenerationController,
  type InteractivePreviewScope,
  InteractivePreviewUrlRegistry,
  isCurrentInteractivePreviewRequest,
  isInteractivePreviewPatchCoherent,
  LatestOnlyInteractiveScheduler,
  parseInteractivePreviewPatchPayload,
} from '../../../src/utils/interactivePreviewPatch.ts';

const flushMicrotasks = async () => {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
};

const buildJpegBytes = (width: number, height: number) =>
  new Uint8Array([
    0xff,
    0xd8,
    0xff,
    0xc0,
    0x00,
    0x0b,
    0x08,
    (height >> 8) & 0xff,
    height & 0xff,
    (width >> 8) & 0xff,
    width & 0xff,
    0x01,
    0x01,
    0x11,
    0x00,
    0xff,
    0xd9,
  ]);

const buildPatchBuffer = ({
  fullH = 100,
  fullW = 200,
  patchH = 50,
  patchW = 100,
  patchX = 20,
  patchY = 10,
  imageBytes = buildJpegBytes(patchW, patchH),
}: {
  fullH?: number;
  fullW?: number;
  imageBytes?: Uint8Array;
  patchH?: number;
  patchW?: number;
  patchX?: number;
  patchY?: number;
} = {}) => {
  const buffer = new ArrayBuffer(24 + imageBytes.byteLength);
  const view = new DataView(buffer);
  view.setUint32(0, patchX, true);
  view.setUint32(4, patchY, true);
  view.setUint32(8, patchW, true);
  view.setUint32(12, patchH, true);
  view.setUint32(16, fullW, true);
  view.setUint32(20, fullH, true);
  new Uint8Array(buffer, 24).set(imageBytes);
  return buffer;
};

const previewScope = (overrides: Partial<InteractivePreviewScope> = {}): InteractivePreviewScope => ({
  backend: 'cpu',
  adjustmentRevision: 4,
  basePreviewUrl: 'blob:base-a',
  devicePixelRatio: 2,
  geometryIdentity: 2,
  graphIdentity: '1:4:1',
  imageSessionId: 1,
  maskRevision: 1,
  patchRevision: 1,
  proofRevision: 1,
  roiX: 0.1,
  roiY: 0.1,
  roiW: 0.5,
  roiH: 0.5,
  sourceImagePath: '/photos/alaska-a.ARW',
  targetResolution: 2048,
  viewportIdentity: 3,
  ...overrides,
});

test('interactive preview patch parser returns normalized bounds for valid backend payloads', () => {
  const patch = parseInteractivePreviewPatchPayload(buildPatchBuffer());

  expect(patch).toEqual({
    fullHeight: 100,
    fullWidth: 200,
    imageBuffer: expect.any(ArrayBuffer),
    normH: 0.5,
    normW: 0.5,
    normX: 0.1,
    normY: 0.1,
    ok: true,
    pixelHeight: 50,
    pixelWidth: 100,
  });
});

test('interactive preview patch parser rejects full-frame JPEG content labeled as an offset ROI', () => {
  expect(
    parseInteractivePreviewPatchPayload(
      buildPatchBuffer({
        imageBytes: buildJpegBytes(200, 100),
        patchH: 50,
        patchW: 100,
        patchX: 20,
        patchY: 10,
      }),
    ),
  ).toEqual({
    ok: false,
    reason: 'interactive_patch_encoded_size_mismatch',
  });
});

test('interactive preview patch parser rejects payloads that would black out the preview overlay', () => {
  expect(parseInteractivePreviewPatchPayload(new ArrayBuffer(24))).toEqual({
    ok: false,
    reason: 'interactive_patch_too_short',
  });
  expect(parseInteractivePreviewPatchPayload(buildPatchBuffer({ fullW: 0 }))).toEqual({
    ok: false,
    reason: 'interactive_patch_empty_full_size',
  });
  expect(parseInteractivePreviewPatchPayload(buildPatchBuffer({ patchW: 0 }))).toEqual({
    ok: false,
    reason: 'interactive_patch_empty_roi',
  });
  expect(parseInteractivePreviewPatchPayload(buildPatchBuffer({ patchW: 300 }))).toEqual({
    ok: false,
    reason: 'interactive_patch_out_of_bounds',
  });
  expect(parseInteractivePreviewPatchPayload(buildPatchBuffer({ imageBytes: new Uint8Array([0, 1, 2]) }))).toEqual({
    ok: false,
    reason: 'interactive_patch_not_jpeg',
  });
});

test('interactive preview patch coherence rejects base preview and geometry transitions', () => {
  const geometryIdentity = 1;
  const basePreviewUrl = resolveEditorPreviewSource({
    finalPreviewUrl: 'blob:preview-a',
    isReady: true,
    thumbnailUrl: 'blob:thumbnail-a',
  });
  const patchIdentity = {
    basePreviewUrl,
    geometryIdentity,
    sourceImagePath: '/photos/alaska.ARW',
  };

  expect(isInteractivePreviewPatchCoherent(patchIdentity, patchIdentity)).toBe(true);
  expect(
    isInteractivePreviewPatchCoherent(patchIdentity, {
      ...patchIdentity,
      basePreviewUrl: 'blob:preview-b',
    }),
  ).toBe(false);
  expect(
    isInteractivePreviewPatchCoherent(patchIdentity, {
      ...patchIdentity,
      geometryIdentity: 2,
    }),
  ).toBe(false);
});

test('interactive previews decode their successor URL before it can be published', async () => {
  let assignedUrl = '';
  let decodeUrl = '';
  await decodeInteractivePreviewUrl('blob:successor', () => ({
    decode: async () => {
      decodeUrl = assignedUrl;
    },
    onerror: null,
    onload: null,
    get src() {
      return assignedUrl;
    },
    set src(value: string) {
      assignedUrl = value;
    },
  }));

  expect(decodeUrl).toBe('blob:successor');
});

test('interactive previews reject stale request and render identities', () => {
  expect(isCurrentInteractivePreviewRequest({ currentJobId: 12, jobId: 12, latestRequestId: 8, requestId: 8 })).toBe(
    true,
  );
  expect(isCurrentInteractivePreviewRequest({ currentJobId: 12, jobId: 11, latestRequestId: 8, requestId: 8 })).toBe(
    false,
  );
  expect(isCurrentInteractivePreviewRequest({ currentJobId: 12, jobId: 12, latestRequestId: 8, requestId: 7 })).toBe(
    false,
  );
});

test('generation-bound interactive work cannot dispatch, decode, or publish after A to B selection', () => {
  const controller = new InteractivePreviewGenerationController();
  const requestIdentity = controller.synchronize(previewScope()).identity;

  expect(controller.isCurrent(requestIdentity, controller.synchronize(previewScope()).identity)).toBe(true);

  const imageB = controller.synchronize(previewScope({ sourceImagePath: '/photos/alaska-b.ARW' }));
  expect(imageB.invalidated).toBe(true);
  expect(controller.isCurrent(requestIdentity, imageB.identity)).toBe(false);
  expect(controller.isCurrent(requestIdentity, imageB.identity)).toBe(false);
  expect(controller.canCommit(requestIdentity, 1, imageB.identity)).toBe(false);

  const imageAAgain = controller.synchronize(previewScope());
  expect(imageAAgain.identity.selectionEpoch).toBeGreaterThan(requestIdentity.selectionEpoch);
  expect(controller.isCurrent(requestIdentity, imageAAgain.identity)).toBe(false);
});

test('generation identity invalidates geometry, ROI, viewport, DPR, graph, and backend changes', () => {
  const variants: Array<Partial<InteractivePreviewScope>> = [
    { geometryIdentity: 3 },
    { roiX: 0.2 },
    { viewportIdentity: 4 },
    { devicePixelRatio: 3 },
    { adjustmentRevision: 5, graphIdentity: '1:5:1' },
    { backend: 'wgpu' },
  ];

  for (const variant of variants) {
    const controller = new InteractivePreviewGenerationController();
    const requestIdentity = controller.synchronize(previewScope()).identity;
    const current = controller.synchronize(previewScope(variant));

    expect(current.invalidated).toBe(true);
    expect(controller.isCurrent(requestIdentity, current.identity)).toBe(false);
    expect(controller.canCommit(requestIdentity, 1, current.identity)).toBe(false);
  }
});

test('active interactive completions paint monotonically while only newer work is pending', () => {
  const controller = new InteractivePreviewGenerationController();
  const identity = controller.synchronize(previewScope()).identity;
  const current = controller.synchronize(previewScope()).identity;

  expect(controller.canCommit(identity, 1, current)).toBe(true);
  expect(controller.canCommit(identity, 2, current)).toBe(true);
  expect(controller.canCommit(identity, 1, current)).toBe(false);

  const releasedIdentity = controller.supersede(previewScope());
  expect(controller.isCurrent(identity, releasedIdentity)).toBe(false);
});

test('interactive preview scheduler bounds active work and keeps only the latest pending request', async () => {
  const started: number[] = [];
  const completions: Array<() => void> = [];
  let active = 0;
  let maxActive = 0;
  const scheduler = new LatestOnlyInteractiveScheduler<number>(async (request) => {
    started.push(request);
    active += 1;
    maxActive = Math.max(maxActive, active);
    await new Promise<void>((resolve) => {
      completions.push(() => {
        active -= 1;
        resolve();
      });
    });
  });

  scheduler.schedule(1);
  scheduler.schedule(2);
  scheduler.schedule(3);
  expect(started).toEqual([1]);
  expect(maxActive).toBe(1);

  completions[0]?.();
  await flushMicrotasks();
  expect(started).toEqual([1, 3]);
  expect(maxActive).toBe(1);

  completions[1]?.();
  await flushMicrotasks();
  scheduler.dispose();
});

test('canvas URL ownership retains predecessor bytes until the owning rendered layer retires', () => {
  const registry = new InteractivePreviewUrlRegistry();

  registry.claim('base:painted', 'blob:painted');
  registry.claim('patch:painted', 'blob:painted');
  registry.claim('base:successor', 'blob:successor');

  expect(registry.release('base:painted', 'blob:painted')).toBe(false);
  expect(registry.release('patch:painted', 'blob:painted')).toBe(true);
  expect(registry.release('base:successor', 'blob:successor')).toBe(true);
});

test('canvas URL ownership releases only the final owner during unmount cleanup', () => {
  const registry = new InteractivePreviewUrlRegistry();
  registry.claim('base:painted', 'blob:painted');
  registry.claim('patch:painted', 'blob:painted');

  expect(registry.releaseOwner('base:painted')).toEqual([]);
  expect(registry.releaseOwner('patch:painted')).toEqual(['blob:painted']);
});
