#!/usr/bin/env bun

import {
  type AiObjectMaskProposal,
  acceptObjectMaskProposal,
  aiObjectMaskProposalSchema,
  buildObjectMaskProposalCommandInput,
  readObjectMaskProposalReplayReceipt,
  readObjectPromptCanvasState,
  writeObjectPromptCanvasState,
} from '../../../src/utils/objectMaskPromptCanvas.ts';

const makeProposal = (overrides: Partial<AiObjectMaskProposal> = {}): AiObjectMaskProposal =>
  aiObjectMaskProposalSchema.parse({
    clickToMaskLatencyMs: 144,
    decoderLatencyMs: 61,
    embeddingLatencyMs: 83,
    imageHeight: 4,
    imageWidth: 4,
    maskDataBase64:
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAAAAACMmsGiAAAAEklEQVR4nGP8z4AATAxEcQAzAAFOAAeA1R4aAAAAAElFTkSuQmCC',
    modelId: 'sam_vit_b_01ec64',
    promptCount: 2,
    promptKind: 'box',
    providerId: 'rapidraw-sam-vit-b-onnx-v1',
    ...overrides,
  });

const fail = (message: string): never => {
  console.error(`object mask command failed: ${message}`);
  process.exit(1);
};

const boxState = readObjectPromptCanvasState(
  writeObjectPromptCanvasState(undefined, {
    boxPrompt: { height: 0.35, width: 0.25, x: 0.3, y: 0.2 },
    mode: 'box',
    pendingBoxAnchor: null,
    pointPrompts: [{ label: 'foreground', x: 0.42, y: 0.48 }],
  }),
);
const pointState = readObjectPromptCanvasState(
  writeObjectPromptCanvasState(undefined, {
    boxPrompt: null,
    mode: 'foreground_point',
    pendingBoxAnchor: null,
    pointPrompts: [{ label: 'foreground', x: 0.42, y: 0.48 }],
  }),
);

const boxCommand = buildObjectMaskProposalCommandInput(boxState, { height: 3000, orientationSteps: 0, width: 5000 });
const pointCommand = buildObjectMaskProposalCommandInput(pointState, {
  height: 3000,
  orientationSteps: 0,
  width: 5000,
});
if (boxCommand?.promptKind !== 'box' || boxCommand.startPoint[0] !== 1500 || boxCommand.endPoint[1] !== 1650) {
  fail('box prompts must produce deterministic SAM command coordinates.');
}
if (
  pointCommand?.promptKind !== 'point' ||
  pointCommand.startPoint[0] !== pointCommand.endPoint[0] ||
  pointCommand.startPoint[1] !== pointCommand.endPoint[1]
) {
  fail('point prompts must produce deterministic point-only SAM command coordinates.');
}

const boxProposal = makeProposal();
if (boxProposal.promptKind !== boxCommand.promptKind || boxProposal.promptCount !== 2) {
  fail('box proposal must preserve prompt kind and prompt count from the runtime command.');
}
const acceptedBoxParameters = acceptObjectMaskProposal({}, boxState, boxProposal);
const boxReceipt = readObjectMaskProposalReplayReceipt(acceptedBoxParameters);
if (
  boxReceipt === null ||
  !boxReceipt.hasRaster ||
  !boxReceipt.boxReady ||
  boxReceipt.providerId !== 'rapidraw-sam-vit-b-onnx-v1' ||
  boxReceipt.modelId !== 'sam_vit_b_01ec64' ||
  boxReceipt.promptKind !== 'box'
) {
  fail('accepted box proposal must expose replay receipt raster, provider, model, and prompt state.');
}

const pointProposal = makeProposal({ promptCount: 1, promptKind: 'point' });
const acceptedPointParameters = acceptObjectMaskProposal({}, pointState, pointProposal);
const pointReceipt = readObjectMaskProposalReplayReceipt(acceptedPointParameters);
if (pointReceipt?.promptKind !== 'point' || pointReceipt.boxReady || pointReceipt.pointCount !== 1) {
  fail('accepted point proposal must expose point replay receipt state without a box.');
}

const invalidEmptyRaster = aiObjectMaskProposalSchema.safeParse({
  ...boxProposal,
  maskDataBase64: '',
});
if (invalidEmptyRaster.success) {
  fail('object mask proposal schema must reject empty/no-op raster output.');
}

console.log(`object mask command ok provider=${boxReceipt.providerId} model=${boxReceipt.modelId}`);
