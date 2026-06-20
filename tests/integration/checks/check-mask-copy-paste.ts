#!/usr/bin/env bun

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';

import { INITIAL_MASK_ADJUSTMENTS } from '../../../src/utils/adjustments.ts';
import {
  cloneMaskContainerForPaste,
  cloneSubMaskForPaste,
  insertMaskContainerAt,
  insertSubMaskAt,
} from '../../../src/utils/maskClipboard.ts';

const fixtureSchema = z.discriminatedUnion('id', [
  z
    .object({
      expected: z
        .object({
          containerIds: z.array(z.string()).length(3),
          subMaskIds: z.array(z.string()).length(2),
          subMaskName: z.string(),
        })
        .strict(),
      id: z.literal('clone-and-insert'),
    })
    .strict(),
  z
    .object({
      expected: z
        .object({
          containerInvert: z.boolean(),
          containerName: z.string(),
          subMaskInvert: z.boolean(),
        })
        .strict(),
      id: z.literal('invert-and-rename'),
    })
    .strict(),
  z
    .object({
      expected: z
        .object({
          exposure: z.number(),
          originalExposure: z.number(),
        })
        .strict(),
      id: z.literal('reset-adjustments'),
    })
    .strict(),
]);

const fixtures = z
  .array(fixtureSchema)
  .min(1)
  .parse(JSON.parse(readFileSync(resolve('fixtures/masks/mask-copy-paste.json'), 'utf8')));

const createIdFactory = (ids) => {
  const pendingIds = [...ids];
  return () => {
    const id = pendingIds.shift();
    if (id === undefined) throw new Error('fixture id factory exhausted');
    return id;
  };
};

const originalSubMask = {
  id: 'submask-original',
  invert: false,
  mode: 'additive',
  name: 'Brush',
  opacity: 0.8,
  parameters: { lines: [] },
  type: 'brush',
  visible: true,
};

const originalContainer = {
  adjustments: { ...INITIAL_MASK_ADJUSTMENTS, exposure: 0.75 },
  id: 'container-original',
  invert: false,
  name: 'Brush layer',
  opacity: 1,
  subMasks: [originalSubMask],
  visible: true,
};

for (const fixture of fixtures) {
  if (fixture.id === 'clone-and-insert') {
    const clonedSubMask = cloneSubMaskForPaste(originalSubMask, createIdFactory(['submask-copy']), {
      renameTo: 'Brush copy',
    });
    const subMasks = insertSubMaskAt(originalContainer.subMasks, clonedSubMask, 0);
    const clonedContainer = cloneMaskContainerForPaste(
      originalContainer,
      createIdFactory(['container-copy', 'container-copy-submask']),
    );
    const containers = insertMaskContainerAt(
      [originalContainer, { ...originalContainer, id: 'container-tail' }],
      clonedContainer,
      1,
    );

    if (JSON.stringify(containers.map((container) => container.id)) !== JSON.stringify(fixture.expected.containerIds)) {
      console.error(`${fixture.id}: container insertion mismatch`);
      process.exit(1);
    }

    if (JSON.stringify(subMasks.map((subMask) => subMask.id)) !== JSON.stringify(fixture.expected.subMaskIds)) {
      console.error(`${fixture.id}: sub-mask insertion mismatch`);
      process.exit(1);
    }

    if (subMasks[0].name !== fixture.expected.subMaskName) {
      console.error(`${fixture.id}: sub-mask clone rename mismatch`);
      process.exit(1);
    }
  } else if (fixture.id === 'invert-and-rename') {
    const clonedContainer = cloneMaskContainerForPaste(
      originalContainer,
      createIdFactory(['container-inverted', 'unused']),
      {
        invert: true,
        renameTo: 'Inverted Brush',
      },
    );
    const clonedSubMask = cloneSubMaskForPaste(originalSubMask, createIdFactory(['submask-inverted']), {
      invert: true,
    });

    if (
      clonedContainer.invert !== fixture.expected.containerInvert ||
      clonedContainer.name !== fixture.expected.containerName ||
      clonedSubMask.invert !== fixture.expected.subMaskInvert
    ) {
      console.error(`${fixture.id}: invert or rename mismatch`);
      process.exit(1);
    }
  } else {
    const clonedContainer = cloneMaskContainerForPaste(
      originalContainer,
      createIdFactory(['container-reset', 'reset-submask']),
      { resetAdjustments: true },
    );
    if (
      clonedContainer.adjustments.exposure !== fixture.expected.exposure ||
      originalContainer.adjustments.exposure !== fixture.expected.originalExposure
    ) {
      console.error(`${fixture.id}: adjustment reset mismatch`);
      process.exit(1);
    }
  }
}

console.log(`Validated ${fixtures.length} mask copy/paste fixtures.`);
