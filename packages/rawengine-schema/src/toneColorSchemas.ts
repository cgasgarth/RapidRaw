import { z } from 'zod';

import { artifactHandleV1Schema } from './artifactSchemas.js';

export type ToneColorSchemaDependenciesV1 = {
  approvalClass: {
    EditApply: 'edit_apply';
    PreviewOnly: 'preview_only';
  };
  approvalRequirementSchema: z.ZodType<{ approvalClass: string; state: string }>;
  rawEngineActorSchema: z.ZodType<object>;
  rawEngineColorPipelineContextV1Schema: z.ZodType<object>;
  schemaVersion: 1;
  toneColorTargetSchema: z.ZodType<{ kind: 'image' | 'virtual_copy' }>;
};

export function createToneColorSchemasV1(dependencies: ToneColorSchemaDependenciesV1) {
  const toneColorCommandTypeV1Schema = z.enum([
    'toneColor.setBasicTone',
    'toneColor.setToneCurve',
    'toneColor.setWhiteBalance',
    'toneColor.adjustHsl',
    'toneColor.adjustSkinToneUniformity',
    'toneColor.setColorGrading',
    'toneColor.setLevels',
    'toneColor.setChannelMixer',
    'toneColor.setColorBalanceRgb',
    'toneColor.setBlackWhiteMixer',
  ]);

  const toneColorChannelV1Schema = z.enum(['luma', 'red', 'green', 'blue', 'rgb']);

  const toneColorHslBandV1Schema = z.enum(['red', 'orange', 'yellow', 'green', 'aqua', 'blue', 'purple', 'magenta']);

  const toneColorSelectiveColorRangeControlV1Schema = z
    .object({
      centerHueDegrees: z.number().min(0).max(360),
      falloffSmoothness: z.number().min(0.25).max(4),
      widthDegrees: z.number().min(10).max(180),
    })
    .strict();

  const toneColorCurvePointV1Schema = z
    .object({
      input: z.number().min(0).max(1),
      output: z.number().min(0).max(1),
    })
    .strict();

  const toneColorWheelV1Schema = z
    .object({
      hueDegrees: z.number().min(0).lt(360),
      luminance: z.number().min(-100).max(100),
      saturation: z.number().min(0).max(100),
    })
    .strict();

  const toneColorChannelMixerRowV1Schema = z
    .object({
      blue: z.number().min(-200).max(200),
      constant: z.number().min(-100).max(100),
      green: z.number().min(-200).max(200),
      red: z.number().min(-200).max(200),
    })
    .strict();

  const toneColorBalanceRgbRangeV1Schema = z
    .object({
      blue: z.number().min(-100).max(100),
      green: z.number().min(-100).max(100),
      red: z.number().min(-100).max(100),
    })
    .strict();

  const toneColorBlackWhiteMixerWeightsV1Schema = z
    .object({
      aquas: z.number().min(-100).max(100),
      blues: z.number().min(-100).max(100),
      greens: z.number().min(-100).max(100),
      magentas: z.number().min(-100).max(100),
      oranges: z.number().min(-100).max(100),
      purples: z.number().min(-100).max(100),
      reds: z.number().min(-100).max(100),
      yellows: z.number().min(-100).max(100),
    })
    .strict();

  const toneColorCommandBaseV1Schema = z.object({
    actor: dependencies.rawEngineActorSchema,
    approval: dependencies.approvalRequirementSchema,
    commandId: z.string().trim().min(1),
    correlationId: z.string().trim().min(1),
    colorPipeline: dependencies.rawEngineColorPipelineContextV1Schema,
    dryRun: z.boolean(),
    expectedGraphRevision: z.string().trim().min(1),
    idempotencyKey: z.string().trim().min(1).optional(),
    schemaVersion: z.literal(dependencies.schemaVersion),
    target: dependencies.toneColorTargetSchema,
  });

  const toneColorCommandEnvelopeV1Schema = z
    .discriminatedUnion('commandType', [
      toneColorCommandBaseV1Schema
        .extend({
          commandType: z.literal('toneColor.setBasicTone'),
          parameters: z
            .object({
              blackPoint: z.number().min(-100).max(100),
              clarity: z.number().min(-100).max(100),
              contrast: z.number().min(-100).max(100),
              exposureEv: z.number().min(-10).max(10),
              acceptedDryRunPlanHash: z.string().trim().min(1).optional(),
              acceptedDryRunPlanId: z.string().trim().min(1).optional(),
              highlights: z.number().min(-100).max(100),
              saturation: z.number().min(-100).max(100),
              shadows: z.number().min(-100).max(100),
              whitePoint: z.number().min(-100).max(100),
            })
            .strict(),
        })
        .strict(),
      toneColorCommandBaseV1Schema
        .extend({
          commandType: z.literal('toneColor.setToneCurve'),
          parameters: z
            .object({
              channel: toneColorChannelV1Schema,
              interpolation: z.enum(['linear', 'monotone_cubic']),
              points: z.array(toneColorCurvePointV1Schema).min(2).max(32),
            })
            .strict()
            .superRefine((parameters, context) => {
              let previousInput = -Infinity;
              for (const [index, point] of parameters.points.entries()) {
                if (point.input <= previousInput) {
                  context.addIssue({
                    code: 'custom',
                    message: 'Tone curve points must be strictly ordered by input value.',
                    path: ['points', index, 'input'],
                  });
                }
                previousInput = point.input;
              }
            }),
        })
        .strict(),
      toneColorCommandBaseV1Schema
        .extend({
          commandType: z.literal('toneColor.setWhiteBalance'),
          parameters: z
            .object({
              mode: z.enum(['as_shot', 'auto', 'custom_kelvin_tint']),
              temperatureKelvin: z.number().min(1500).max(50000).optional(),
              tint: z.number().min(-150).max(150).optional(),
            })
            .strict()
            .superRefine((parameters, context) => {
              if (parameters.mode === 'custom_kelvin_tint') {
                if (parameters.temperatureKelvin === undefined) {
                  context.addIssue({
                    code: 'custom',
                    message: 'Custom white balance requires temperatureKelvin.',
                    path: ['temperatureKelvin'],
                  });
                }

                if (parameters.tint === undefined) {
                  context.addIssue({
                    code: 'custom',
                    message: 'Custom white balance requires tint.',
                    path: ['tint'],
                  });
                }
              }
            }),
        })
        .strict(),
      toneColorCommandBaseV1Schema
        .extend({
          commandType: z.literal('toneColor.adjustHsl'),
          parameters: z
            .object({
              band: toneColorHslBandV1Schema,
              hueShiftDegrees: z.number().min(-180).max(180),
              luminance: z.number().min(-100).max(100),
              rangeControl: toneColorSelectiveColorRangeControlV1Schema.optional(),
              saturation: z.number().min(-100).max(100),
            })
            .strict(),
        })
        .strict(),
      toneColorCommandBaseV1Schema
        .extend({
          commandType: z.literal('toneColor.adjustSkinToneUniformity'),
          parameters: z
            .object({
              experimental: z.literal(true),
              hueUniformity: z.number().min(0).max(0.75),
              luminanceUniformity: z.number().min(0).max(0.75),
              maxHueShiftDegrees: z.number().min(0).max(30),
              saturationUniformity: z.number().min(0).max(0.75),
              targetHueDegrees: z.number().min(0).lt(360),
              targetLuminance: z.number().min(0).max(1),
              targetSaturation: z.number().min(0).max(1),
            })
            .strict(),
        })
        .strict(),
      toneColorCommandBaseV1Schema
        .extend({
          commandType: z.literal('toneColor.setColorGrading'),
          parameters: z
            .object({
              balance: z.number().min(-100).max(100),
              blend: z.number().min(0).max(100),
              global: toneColorWheelV1Schema,
              highlights: toneColorWheelV1Schema,
              midtones: toneColorWheelV1Schema,
              shadows: toneColorWheelV1Schema,
            })
            .strict(),
        })
        .strict(),
      toneColorCommandBaseV1Schema
        .extend({
          commandType: z.literal('toneColor.setLevels'),
          parameters: z
            .object({
              channel: z.literal('luma'),
              enabled: z.boolean(),
              gamma: z.number().min(0.1).max(5),
              inputBlack: z.number().min(0).max(1),
              inputWhite: z.number().min(0).max(1),
              outputBlack: z.number().min(0).max(1),
              outputWhite: z.number().min(0).max(1),
            })
            .strict()
            .superRefine((parameters, context) => {
              if (parameters.inputBlack >= parameters.inputWhite) {
                context.addIssue({
                  code: 'custom',
                  message: 'Levels input black must be below input white.',
                  path: ['inputBlack'],
                });
              }
              if (parameters.outputBlack >= parameters.outputWhite) {
                context.addIssue({
                  code: 'custom',
                  message: 'Levels output black must be below output white.',
                  path: ['outputBlack'],
                });
              }
            }),
        })
        .strict(),
      toneColorCommandBaseV1Schema
        .extend({
          commandType: z.literal('toneColor.setChannelMixer'),
          parameters: z
            .object({
              blue: toneColorChannelMixerRowV1Schema,
              enabled: z.boolean(),
              green: toneColorChannelMixerRowV1Schema,
              preserveLuminance: z.boolean(),
              red: toneColorChannelMixerRowV1Schema,
            })
            .strict()
            .superRefine((parameters, context) => {
              const rows = [parameters.red, parameters.green, parameters.blue];
              const changed = rows.some(
                (row, index) =>
                  row.red !== (index === 0 ? 100 : 0) ||
                  row.green !== (index === 1 ? 100 : 0) ||
                  row.blue !== (index === 2 ? 100 : 0) ||
                  row.constant !== 0,
              );
              if (parameters.enabled && !changed) {
                context.addIssue({
                  code: 'custom',
                  message: 'Enabled channel mixer requires at least one non-identity output row.',
                  path: ['enabled'],
                });
              }
            }),
        })
        .strict(),
      toneColorCommandBaseV1Schema
        .extend({
          commandType: z.literal('toneColor.setColorBalanceRgb'),
          parameters: z
            .object({
              enabled: z.boolean(),
              highlights: toneColorBalanceRgbRangeV1Schema,
              midtones: toneColorBalanceRgbRangeV1Schema,
              preserveLuminance: z.boolean(),
              shadows: toneColorBalanceRgbRangeV1Schema,
            })
            .strict()
            .superRefine((parameters, context) => {
              const values = [parameters.shadows, parameters.midtones, parameters.highlights].flatMap((range) =>
                Object.values(range),
              );
              if (parameters.enabled && values.every((value) => value === 0)) {
                context.addIssue({
                  code: 'custom',
                  message: 'Enabled RGB color balance requires at least one non-zero channel.',
                  path: ['enabled'],
                });
              }
            }),
        })
        .strict(),
      toneColorCommandBaseV1Schema
        .extend({
          commandType: z.literal('toneColor.setBlackWhiteMixer'),
          parameters: z
            .object({
              enabled: z.boolean(),
              weights: toneColorBlackWhiteMixerWeightsV1Schema,
            })
            .strict()
            .superRefine((parameters, context) => {
              const hasAdjustment = Object.values(parameters.weights).some((value) => value !== 0);
              if (parameters.enabled && !hasAdjustment) {
                context.addIssue({
                  code: 'custom',
                  message: 'Enabled black and white mixer requires at least one non-zero channel weight.',
                  path: ['weights'],
                });
              }
            }),
        })
        .strict(),
    ])
    .superRefine((command, context) => {
      if (command.dryRun) {
        if (command.approval.approvalClass !== dependencies.approvalClass.PreviewOnly) {
          context.addIssue({
            code: 'custom',
            message: 'Dry-run tone/color commands require preview-only approval classification.',
            path: ['approval', 'approvalClass'],
          });
        }

        return;
      }

      if (command.commandType === 'toneColor.setBasicTone') {
        if (command.parameters.acceptedDryRunPlanId === undefined) {
          context.addIssue({
            code: 'custom',
            message: 'Applied basic tone commands require acceptedDryRunPlanId from a matching dry-run.',
            path: ['parameters', 'acceptedDryRunPlanId'],
          });
        }

        if (command.parameters.acceptedDryRunPlanHash === undefined) {
          context.addIssue({
            code: 'custom',
            message: 'Applied basic tone commands require acceptedDryRunPlanHash from a matching dry-run.',
            path: ['parameters', 'acceptedDryRunPlanHash'],
          });
        }
      }

      if (command.approval.approvalClass !== dependencies.approvalClass.EditApply) {
        context.addIssue({
          code: 'custom',
          message: 'Applied tone/color commands require edit-apply approval classification.',
          path: ['approval', 'approvalClass'],
        });
      }

      if (command.approval.state !== 'approved') {
        context.addIssue({
          code: 'custom',
          message: 'Applied tone/color commands require approved user approval before execution.',
          path: ['approval', 'state'],
        });
      }
    });

  const toneColorParameterDiffV1Schema = z
    .object({
      module: z.enum([
        'basic_tone',
        'tone_curve',
        'white_balance',
        'hsl',
        'skin_tone_uniformity',
        'color_grading',
        'levels',
        'channel_mixer',
        'color_balance_rgb',
        'black_white_mixer',
      ]),
      path: z.string().trim().min(1),
      previousValue: z.unknown().optional(),
      value: z.unknown().optional(),
    })
    .strict();

  const toneColorDryRunResultV1Schema = z
    .object({
      commandId: z.string().trim().min(1),
      commandType: toneColorCommandTypeV1Schema,
      correlationId: z.string().trim().min(1),
      dryRunPlanHash: z.string().trim().min(1).optional(),
      dryRunPlanId: z.string().trim().min(1).optional(),
      dryRun: z.literal(true),
      mutates: z.literal(false),
      parameterDiff: z.array(toneColorParameterDiffV1Schema),
      predictedGraphRevision: z.string().trim().min(1),
      previewArtifacts: z.array(artifactHandleV1Schema),
      colorPipeline: dependencies.rawEngineColorPipelineContextV1Schema,
      schemaVersion: z.literal(dependencies.schemaVersion),
      sourceGraphRevision: z.string().trim().min(1),
      warnings: z.array(z.string().trim().min(1)),
    })
    .strict();

  const toneColorMutationResultV1Schema = z
    .object({
      appliedGraphRevision: z.string().trim().min(1),
      changedNodeIds: z.array(z.string().trim().min(1)),
      commandId: z.string().trim().min(1),
      commandType: toneColorCommandTypeV1Schema,
      correlationId: z.string().trim().min(1),
      colorPipeline: dependencies.rawEngineColorPipelineContextV1Schema,
      dryRun: z.literal(false),
      mutates: z.literal(true),
      schemaVersion: z.literal(dependencies.schemaVersion),
      sourceGraphRevision: z.string().trim().min(1),
      undoRevision: z.string().trim().min(1),
      warnings: z.array(z.string().trim().min(1)),
    })
    .strict();

  return {
    toneColorBalanceRgbRangeV1Schema,
    toneColorBlackWhiteMixerWeightsV1Schema,
    toneColorChannelMixerRowV1Schema,
    toneColorChannelV1Schema,
    toneColorCommandEnvelopeV1Schema,
    toneColorCommandTypeV1Schema,
    toneColorCurvePointV1Schema,
    toneColorDryRunResultV1Schema,
    toneColorHslBandV1Schema,
    toneColorMutationResultV1Schema,
    toneColorParameterDiffV1Schema,
    toneColorWheelV1Schema,
  };
}
