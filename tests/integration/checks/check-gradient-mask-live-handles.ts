#!/usr/bin/env bun

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const canvasSource = readFileSync(resolve('src/components/panel/editor/ImageCanvas.tsx'), 'utf8');

const requiredMarkers = [
  'normalizeLinearMaskParametersForLiveHandle',
  'normalizeRadialMaskParametersForLiveHandle',
  'normalizeLinearGradientParameters',
  'normalizeRadialGradientParameters',
  'normalizeLiveGradientRotation',
  'handleLinearGroupDragMove',
  'handleLinearPointDragMove',
  'handleLinearRangeDragMove',
  'handleRadialDragMove',
  'handleRadialTransform',
  'handleRadialTransformEnd',
  'handleRotateMove',
  'onPreviewUpdate(subMask.id, { parameters: newP })',
  'onUpdate(subMask.id, { parameters: newP })',
];

const missingMarkers = requiredMarkers.filter((marker) => !canvasSource.includes(marker));
if (missingMarkers.length > 0) {
  console.error(`Gradient live handle source markers missing: ${missingMarkers.join(', ')}`);
  process.exit(1);
}

const liveUpdateContracts = [
  {
    handler: 'handleLinearGroupDragMove',
    normalizer: 'normalizeLinearMaskParametersForLiveHandle',
  },
  {
    handler: 'handleLinearPointDragMove',
    normalizer: 'normalizeLinearMaskParametersForLiveHandle',
  },
  {
    handler: 'handleLinearRangeDragMove',
    normalizer: 'normalizeLinearMaskParametersForLiveHandle',
  },
  {
    handler: 'handleRadialDragMove',
    normalizer: 'normalizeRadialMaskParametersForLiveHandle',
  },
  {
    handler: 'handleRadialTransform',
    normalizer: 'normalizeRadialMaskParametersForLiveHandle',
  },
  {
    handler: 'handleRotateMove',
    normalizer: 'normalizeRadialMaskParametersForLiveHandle',
  },
];

const finalCommitContracts = [
  {
    handler: 'handleRadialTransformEnd',
    requiredMarkers: ['normalizeRadialMaskParametersForLiveHandle', 'onUpdate(subMask.id, { parameters: newP })'],
  },
  {
    handler: 'handleRadialDragEnd',
    requiredMarkers: ['onUpdate(subMask.id, { parameters: pRef.current })'],
  },
  {
    handler: 'handleRotateEnd',
    requiredMarkers: ['onUpdate(subMask.id, { parameters: pRef.current })'],
  },
  {
    handler: 'handleLinearGroupDragEnd',
    requiredMarkers: ['onUpdate(subMask.id, { parameters: pRef.current })'],
  },
  {
    handler: 'handleLinearPointDragEnd',
    requiredMarkers: ['onUpdate(subMask.id, { parameters: pRef.current })'],
  },
];

for (const { handler, normalizer } of liveUpdateContracts) {
  const handlerIndex = canvasSource.indexOf(`const ${handler} = useCallback`);
  const nextHandlerIndex = canvasSource.indexOf('const handle', handlerIndex + handler.length);
  const body = canvasSource.slice(handlerIndex, nextHandlerIndex === -1 ? undefined : nextHandlerIndex);
  if (handlerIndex === -1 || !body.includes(normalizer)) {
    console.error(`${handler}: expected live handle updates to use ${normalizer}`);
    process.exit(1);
  }
  if (!body.includes('onPreviewUpdate') || !body.includes('onUpdate')) {
    console.error(`${handler}: expected live handle updates to emit preview and persisted updates`);
    process.exit(1);
  }
}

for (const { handler, requiredMarkers } of finalCommitContracts) {
  const handlerIndex = canvasSource.indexOf(`const ${handler} = useCallback`);
  const nextHandlerIndex = canvasSource.indexOf('const handle', handlerIndex + handler.length);
  const body = canvasSource.slice(handlerIndex, nextHandlerIndex === -1 ? undefined : nextHandlerIndex);
  if (handlerIndex === -1) {
    console.error(`${handler}: expected final commit handler to exist`);
    process.exit(1);
  }
  const missingHandlerMarkers = requiredMarkers.filter((marker) => !body.includes(marker));
  if (missingHandlerMarkers.length > 0) {
    console.error(`${handler}: missing final commit markers: ${missingHandlerMarkers.join(', ')}`);
    process.exit(1);
  }
}

console.log(
  `gradient live handle source contract ok (${liveUpdateContracts.length} live handlers, ${finalCommitContracts.length} final handlers)`,
);
