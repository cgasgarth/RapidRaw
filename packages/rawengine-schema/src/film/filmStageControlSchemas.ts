import { z } from 'zod';

export const filmDescriptorStageIdV1Schema = z.enum([
  'reference_luminance_shaper_v1',
  'color_response_v1',
  'print_v1',
  'grain_v1',
  'halation_v1',
  'bloom_v1',
  'monochrome_v1',
]);

const jsonScalarSchema = z.union([z.string(), z.number().finite(), z.boolean(), z.null()]);

const filmStageControlSliderV1Schema = z
  .object({
    kind: z.literal('slider'),
    min: z.number().finite(),
    max: z.number().finite(),
    step: z.number().finite().positive(),
    fineStep: z.number().finite().positive(),
    unit: z.string(),
  })
  .strict()
  .superRefine((control, context) => {
    if (control.min >= control.max) {
      context.addIssue({ code: 'custom', message: 'Slider min must be below max.', path: ['min'] });
    }
    if (control.step > control.max - control.min || control.fineStep > control.step) {
      context.addIssue({ code: 'custom', message: 'Slider steps must fit the declared range.', path: ['step'] });
    }
  });

const filmStageControlNumericV1Schema = z
  .object({
    kind: z.literal('numeric'),
    min: z.number().finite(),
    max: z.number().finite(),
    step: z.number().finite().positive(),
    unit: z.string(),
  })
  .strict()
  .superRefine((control, context) => {
    if (control.min >= control.max || control.step > control.max - control.min)
      context.addIssue({ code: 'custom', message: 'Numeric range or step is invalid.', path: ['min'] });
  });

const filmStageControlEnumV1Schema = z
  .object({
    kind: z.literal('enum'),
    options: z.array(z.object({ id: z.string().trim().min(1), labelKey: z.string().trim().min(1) }).strict()).min(1),
  })
  .strict();

const filmStageControlToggleV1Schema = z.object({ kind: z.literal('toggle') }).strict();
const filmStageControlSeedV1Schema = z
  .object({ kind: z.literal('seed'), min: z.number().int().nonnegative(), max: z.number().int().positive() })
  .strict()
  .superRefine((control, context) => {
    if (control.min >= control.max)
      context.addIssue({ code: 'custom', message: 'Seed range is invalid.', path: ['min'] });
  });

export const filmStageControlV1Schema = z.discriminatedUnion('kind', [
  filmStageControlSliderV1Schema,
  filmStageControlNumericV1Schema,
  filmStageControlEnumV1Schema,
  filmStageControlToggleV1Schema,
  filmStageControlSeedV1Schema,
]);

export const filmControlDependencyV1Schema = z
  .object({
    parameterId: z.string().trim().min(1),
    equals: jsonScalarSchema,
    reasonKey: z.string().trim().min(1),
  })
  .strict();

export const filmStageControlDescriptorV1Schema = z
  .object({
    stage: filmDescriptorStageIdV1Schema,
    parameterId: z.string().trim().min(1),
    labelKey: z.string().trim().min(1),
    descriptionKey: z.string().trim().min(1),
    control: filmStageControlV1Schema,
    defaultValue: jsonScalarSchema,
    currentValue: jsonScalarSchema,
    editability: z.enum(['read_only', 'bounded_override', 'profile_variant']),
    evidenceClass: z.enum(['engineered', 'measured', 'licensed']),
    calibratedRange: z.tuple([z.number().finite(), z.number().finite()]).optional(),
    resetScope: z.enum(['parameter', 'stage', 'profile']),
    dependency: filmControlDependencyV1Schema.optional(),
    warningCodes: z.array(z.string().trim().min(1)),
  })
  .strict()
  .superRefine((descriptor, context) => {
    if (descriptor.calibratedRange !== undefined && descriptor.calibratedRange[0] >= descriptor.calibratedRange[1])
      context.addIssue({ code: 'custom', message: 'Calibrated range must be ordered.', path: ['calibratedRange'] });
  });

export const filmStageControlDescriptorListV1Schema = z.array(filmStageControlDescriptorV1Schema);

export type FilmStageIdV1 = z.infer<typeof filmDescriptorStageIdV1Schema>;
export type FilmStageControlV1 = z.infer<typeof filmStageControlV1Schema>;
export type FilmStageControlDescriptorV1 = z.infer<typeof filmStageControlDescriptorV1Schema>;
