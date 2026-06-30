import { z } from 'zod';

import { aiPeopleMaskFakeAlphaMaskSchema } from './aiMaskingSchemas';

const maskIdSchema = z.string().trim().min(1);
const normalizedScalarSchema = z.number().min(0).max(1);

export const maskComposeModeSchema = z.enum(['add', 'subtract', 'intersect']);

export const maskRenderBrushPointSchema = z
  .object({
    pressure: normalizedScalarSchema,
    x: z.number(),
    y: z.number(),
  })
  .strict();

export const maskRenderOperationSchema = z
  .discriminatedUnion('type', [
    z
      .object({
        brush: z
          .object({
            featherPx: z.number().min(0).max(512),
            flow: normalizedScalarSchema,
            hardness: normalizedScalarSchema,
            points: z.array(maskRenderBrushPointSchema).min(2).max(4096),
            radiusPx: z.number().positive().max(1024),
          })
          .strict(),
        id: maskIdSchema,
        mode: maskComposeModeSchema,
        opacity: normalizedScalarSchema,
        type: z.literal('brush_stroke'),
      })
      .strict(),
    z
      .object({
        gradient: z
          .object({
            end: maskRenderBrushPointSchema.omit({ pressure: true }),
            featherPx: z.number().min(0).max(4096),
            start: maskRenderBrushPointSchema.omit({ pressure: true }),
          })
          .strict(),
        id: maskIdSchema,
        mode: maskComposeModeSchema,
        opacity: normalizedScalarSchema,
        type: z.literal('linear_gradient'),
      })
      .strict(),
    z
      .object({
        id: maskIdSchema,
        mode: maskComposeModeSchema,
        opacity: normalizedScalarSchema,
        radial: z
          .object({
            center: maskRenderBrushPointSchema.omit({ pressure: true }),
            featherPx: z.number().min(0).max(4096),
            radiusXPx: z.number().positive().max(4096),
            radiusYPx: z.number().positive().max(4096),
            rotationDeg: z.number().min(-180).max(180),
          })
          .strict(),
        type: z.literal('radial_gradient'),
      })
      .strict(),
    z
      .object({
        id: maskIdSchema,
        mode: maskComposeModeSchema,
        opacity: normalizedScalarSchema,
        range: z
          .object({
            maxLuma: normalizedScalarSchema,
            minLuma: normalizedScalarSchema,
            softness: normalizedScalarSchema,
          })
          .strict()
          .refine((range) => range.minLuma < range.maxLuma, {
            message: 'Luminance range masks require minLuma below maxLuma.',
            path: ['minLuma'],
          }),
        type: z.literal('luminance_range'),
      })
      .strict(),
    z
      .object({
        id: maskIdSchema,
        mode: maskComposeModeSchema,
        opacity: normalizedScalarSchema,
        peopleMask: aiPeopleMaskFakeAlphaMaskSchema,
        type: z.literal('ai_people_fake'),
      })
      .strict(),
  ])
  .superRefine((operation, context) => {
    if (operation.mode === 'intersect' && operation.opacity === 0) {
      context.addIssue({
        code: 'custom',
        message: 'Intersect mask operations must contribute non-zero opacity.',
        path: ['opacity'],
      });
    }
  });

export const maskRenderLayerSchema = z
  .object({
    blendMode: z.enum(['normal', 'multiply', 'screen', 'overlay', 'soft_light', 'luminosity', 'color']),
    id: maskIdSchema,
    maskOperationIds: z.array(maskIdSchema).min(1),
    name: z.string().trim().min(1),
    opacity: normalizedScalarSchema,
    visible: z.boolean(),
  })
  .strict();

export const maskRenderSceneSchema = z
  .object({
    canvas: z
      .object({
        colorSpace: z.enum(['linear_rec2020', 'display_p3', 'srgb']),
        height: z.number().int().positive().max(100_000),
        width: z.number().int().positive().max(100_000),
      })
      .strict(),
    layers: z.array(maskRenderLayerSchema).min(1).max(256),
    maskOperations: z.array(maskRenderOperationSchema).min(1).max(1024),
    schemaVersion: z.literal(1),
  })
  .strict()
  .superRefine((scene, context) => {
    const operationIds = new Set(scene.maskOperations.map((operation) => operation.id));
    for (const layer of scene.layers) {
      for (const operationId of layer.maskOperationIds) {
        if (!operationIds.has(operationId)) {
          context.addIssue({
            code: 'custom',
            message: `Layer references missing mask operation ${operationId}.`,
            path: ['layers', scene.layers.indexOf(layer), 'maskOperationIds'],
          });
        }
      }
    }
  });

export type MaskRenderLayer = z.infer<typeof maskRenderLayerSchema>;
export type MaskRenderOperation = z.infer<typeof maskRenderOperationSchema>;
export type MaskRenderScene = z.infer<typeof maskRenderSceneSchema>;
export type MaskComposeMode = z.infer<typeof maskComposeModeSchema>;

export function estimateMaskRenderTileCount(scene: MaskRenderScene, tileSizePx: number = 512): number {
  const columns = Math.ceil(scene.canvas.width / tileSizePx);
  const rows = Math.ceil(scene.canvas.height / tileSizePx);
  return columns * rows * scene.layers.length;
}

export function parseMaskRenderScene(value: unknown): MaskRenderScene {
  return maskRenderSceneSchema.parse(value);
}
