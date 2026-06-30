import { z } from 'zod';
import type { Adjustments } from '../adjustments';
import {
  buildFilmLookAppliedAdjustmentPatch,
  clampFilmLookStrength,
  type FilmLookBrowserItem,
} from './filmLookBrowser';

export const FILM_LOOK_COLOR_PIPELINE_COMMAND_SCHEMA_VERSION = 1;

const hashSchema = z.string().regex(/^rawengine-pixel-hash:[a-f0-9]{16}$/u);

export const filmLookColorPipelinePixelSchema = z
  .object({
    b: z.number().min(0).max(1),
    g: z.number().min(0).max(1),
    r: z.number().min(0).max(1),
    x: z.number().int().min(0),
    y: z.number().int().min(0),
  })
  .strict();

export const filmLookColorPipelineSchema = z
  .object({
    chromaticAdaptation: z.literal('bradford_v1'),
    inputDomain: z.literal('camera_linear_rgb'),
    operationDomain: z.literal('acescg_linear_v1'),
    renderTarget: z
      .object({
        bitDepth: z.literal(16),
        outputProfile: z.literal('display_p3'),
        viewTransform: z.literal('rawengine_agx_v1'),
      })
      .strict(),
    sceneToDisplayTransform: z.literal('rawengine_agx_v1'),
    workingSpace: z.literal('acescg_linear_v1'),
  })
  .strict();

export const filmLookAbSlotSchema = z
  .object({
    afterHash: hashSchema,
    beforeHash: hashSchema,
    changedPixelRatio: z.number().min(0).max(1),
    clippingWarningCount: z.number().int().min(0),
    lookId: z.string().trim().min(1),
    outputPixels: z.array(filmLookColorPipelinePixelSchema).min(1),
    previewHash: hashSchema,
    strength: z.number().int().min(0).max(100),
  })
  .strict()
  .superRefine((slot, context) => {
    if (slot.previewHash !== slot.afterHash) {
      context.addIssue({ code: 'custom', message: 'Preview/export hash parity failed.' });
    }

    if (slot.beforeHash === slot.afterHash) {
      context.addIssue({ code: 'custom', message: 'Applied film look must change rendered output.' });
    }
  });

export const filmLookAbCommandSchema = z
  .object({
    actor: z
      .object({
        id: z.string().trim().min(1),
        kind: z.enum(['agent', 'batch', 'cli', 'test', 'ui']),
        sessionId: z.string().trim().min(1),
      })
      .strict(),
    approval: z
      .object({
        approvalClass: z.literal('edit_apply'),
        reason: z.string().trim().min(1),
        state: z.literal('approved'),
      })
      .strict(),
    colorPipeline: filmLookColorPipelineSchema,
    commandId: z.string().trim().min(1),
    commandType: z.literal('filmLook.applyAbCandidate'),
    correlationId: z.string().trim().min(1),
    expectedGraphRevision: z.string().trim().min(1),
    idempotencyKey: z.string().trim().min(1),
    parameters: z
      .object({
        acceptedSlot: z.enum(['a', 'b']),
        candidates: z
          .object({
            a: filmLookAbSlotSchema,
            b: filmLookAbSlotSchema,
          })
          .strict(),
      })
      .strict(),
    schemaVersion: z.literal(FILM_LOOK_COLOR_PIPELINE_COMMAND_SCHEMA_VERSION),
    target: z
      .object({
        imagePath: z.string().trim().min(1),
        kind: z.literal('image'),
      })
      .strict(),
  })
  .strict();

export type FilmLookColorPipelinePixel = z.infer<typeof filmLookColorPipelinePixelSchema>;
export type FilmLookAbSlot = z.infer<typeof filmLookAbSlotSchema>;
export type FilmLookAbCommand = z.infer<typeof filmLookAbCommandSchema>;

export interface BuildFilmLookAbCommandOptions {
  acceptedSlot: 'a' | 'b';
  actorSessionId: string;
  candidateA: FilmLookBrowserItem;
  candidateB: FilmLookBrowserItem;
  expectedGraphRevision: string;
  imagePath: string;
  operationId: string;
  sourcePixels: ReadonlyArray<FilmLookColorPipelinePixel>;
  strengthA: number;
  strengthB: number;
}

export const DEFAULT_FILM_LOOK_COLOR_PIPELINE = {
  chromaticAdaptation: 'bradford_v1',
  inputDomain: 'camera_linear_rgb',
  operationDomain: 'acescg_linear_v1',
  renderTarget: {
    bitDepth: 16,
    outputProfile: 'display_p3',
    viewTransform: 'rawengine_agx_v1',
  },
  sceneToDisplayTransform: 'rawengine_agx_v1',
  workingSpace: 'acescg_linear_v1',
} satisfies z.infer<typeof filmLookColorPipelineSchema>;

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));
const quantize16 = (value: number) => Math.round(clamp01(value) * 65_535);
const roundChannel = (value: number) => Number(clamp01(value).toFixed(6));

export function applyFilmLookToColorPipelinePixels(
  sourcePixels: ReadonlyArray<FilmLookColorPipelinePixel>,
  look: FilmLookBrowserItem,
  strength: number,
): Array<FilmLookColorPipelinePixel> {
  const patch = buildFilmLookAppliedAdjustmentPatch(look, strength);
  const temperature = (patch.temperature ?? 0) / 100;
  const contrast = (patch.contrast ?? 0) / 100;
  const highlights = (patch.highlights ?? 0) / 100;
  const shadows = (patch.shadows ?? 0) / 100;
  const blacks = (patch.blacks ?? 0) / 100;
  const saturation = (patch.saturation ?? 0) / 100;
  const glow = (patch.glowAmount ?? 0) / 100;

  return sourcePixels.map((pixel) => {
    let r = pixel.r + temperature * 0.08;
    let g = pixel.g + temperature * 0.015;
    let b = pixel.b - temperature * 0.07;
    const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    const highlightMask = clamp01((luma - 0.58) / 0.42);
    const shadowMask = clamp01((0.42 - luma) / 0.42);
    const toneOffset = highlights * highlightMask * 0.18 + shadows * shadowMask * 0.14 + blacks * 0.08;

    r = (r - 0.5) * (1 + contrast) + 0.5 + toneOffset;
    g = (g - 0.5) * (1 + contrast) + 0.5 + toneOffset;
    b = (b - 0.5) * (1 + contrast) + 0.5 + toneOffset;

    const saturatedLuma = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    const glowBoost = glow * highlightMask * 0.08;

    return {
      b: roundChannel(saturatedLuma + (b - saturatedLuma) * (1 + saturation) + glowBoost),
      g: roundChannel(saturatedLuma + (g - saturatedLuma) * (1 + saturation) + glowBoost),
      r: roundChannel(saturatedLuma + (r - saturatedLuma) * (1 + saturation) + glowBoost),
      x: pixel.x,
      y: pixel.y,
    };
  });
}

export function hashFilmLookColorPipelinePixels(pixels: ReadonlyArray<FilmLookColorPipelinePixel>): string {
  const stablePixels = pixels.map(({ b, g, r }) => [quantize16(r), quantize16(g), quantize16(b)]);
  return `rawengine-pixel-hash:${hashStableString(JSON.stringify(stablePixels))}`;
}

function hashStableString(value: string): string {
  let high = 0xcbf2_9ce4;
  let low = 0x8422_2325;

  for (let index = 0; index < value.length; index += 1) {
    low ^= value.charCodeAt(index);
    high = Math.imul(high, 16_777_619) ^ (low >>> 16);
    low = Math.imul(low, 16_777_619);
  }

  const highHex = (high >>> 0).toString(16).padStart(8, '0');
  const lowHex = (low >>> 0).toString(16).padStart(8, '0');
  return `${highHex}${lowHex}`;
}

export function buildFilmLookAbSlot(
  sourcePixels: ReadonlyArray<FilmLookColorPipelinePixel>,
  look: FilmLookBrowserItem,
  strength: number,
): FilmLookAbSlot {
  const outputPixels = applyFilmLookToColorPipelinePixels(sourcePixels, look, strength);
  const beforeHash = hashFilmLookColorPipelinePixels(sourcePixels);
  const afterHash = hashFilmLookColorPipelinePixels(outputPixels);
  const changedPixels = outputPixels.filter((pixel, index) => {
    const before = sourcePixels[index];
    return before === undefined || before.r !== pixel.r || before.g !== pixel.g || before.b !== pixel.b;
  }).length;
  const clippingWarningCount = outputPixels.filter(
    (pixel) => pixel.r <= 0 || pixel.r >= 1 || pixel.g <= 0 || pixel.g >= 1 || pixel.b <= 0 || pixel.b >= 1,
  ).length;

  return filmLookAbSlotSchema.parse({
    afterHash,
    beforeHash,
    changedPixelRatio: Number((changedPixels / outputPixels.length).toFixed(6)),
    clippingWarningCount,
    lookId: look.id,
    outputPixels,
    previewHash: afterHash,
    strength: clampFilmLookStrength(strength),
  });
}

export function buildFilmLookAbCommand(options: BuildFilmLookAbCommandOptions): FilmLookAbCommand {
  return filmLookAbCommandSchema.parse({
    actor: {
      id: 'rapidraw-ui',
      kind: 'ui',
      sessionId: options.actorSessionId,
    },
    approval: {
      approvalClass: 'edit_apply',
      reason: 'Apply accepted A/B film look through the color pipeline.',
      state: 'approved',
    },
    colorPipeline: DEFAULT_FILM_LOOK_COLOR_PIPELINE,
    commandId: `film_look_ab_${options.operationId}`,
    commandType: 'filmLook.applyAbCandidate',
    correlationId: `film_look_ab_corr_${options.operationId}`,
    expectedGraphRevision: options.expectedGraphRevision,
    idempotencyKey: `film_look_ab_idem_${options.operationId}`,
    parameters: {
      acceptedSlot: options.acceptedSlot,
      candidates: {
        a: buildFilmLookAbSlot(options.sourcePixels, options.candidateA, options.strengthA),
        b: buildFilmLookAbSlot(options.sourcePixels, options.candidateB, options.strengthB),
      },
    },
    schemaVersion: FILM_LOOK_COLOR_PIPELINE_COMMAND_SCHEMA_VERSION,
    target: {
      imagePath: options.imagePath,
      kind: 'image',
    },
  });
}

export function applyFilmLookAbCommandToAdjustments(
  baseAdjustments: Adjustments,
  command: unknown,
  looksById: ReadonlyMap<string, FilmLookBrowserItem>,
): Adjustments {
  const parsedCommand = filmLookAbCommandSchema.parse(command);
  const acceptedCandidate = parsedCommand.parameters.candidates[parsedCommand.parameters.acceptedSlot];
  const acceptedLook = looksById.get(acceptedCandidate.lookId);
  if (acceptedLook === undefined) {
    throw new Error(`Accepted film look is missing from registry: ${acceptedCandidate.lookId}`);
  }

  return {
    ...baseAdjustments,
    ...buildFilmLookAppliedAdjustmentPatch(acceptedLook, acceptedCandidate.strength),
    filmLookId: acceptedLook.id,
    filmLookStrength: acceptedCandidate.strength,
  };
}
