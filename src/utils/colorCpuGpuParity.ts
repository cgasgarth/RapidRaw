import { z } from 'zod';

export const colorParityOperationSchema = z.enum([
  'channel_mixer',
  'linear_exposure',
  'white_balance',
  'legacy_tonemap',
]);

export const colorParityVec3Schema = z.tuple([z.number(), z.number(), z.number()]);

export const colorParityCaseSchema = z
  .object({
    expectedOutput: colorParityVec3Schema,
    id: z.string().regex(/^color\.parity\.[a-z0-9.-]+\.v[0-9]+$/u),
    input: colorParityVec3Schema,
    notes: z.string().trim().min(1),
    operation: colorParityOperationSchema,
    parameters: z.record(z.string(), z.number()).default({}),
    tolerance: z.number().positive().max(0.005),
  })
  .strict();

export const colorParityShaderFunctionSchema = z
  .object({
    name: z.enum(['apply_channel_mixer', 'apply_linear_exposure', 'apply_white_balance', 'legacy_tonemap']),
    sha256: z.string().regex(/^sha256:[a-f0-9]{64}$/u),
  })
  .strict();

export const colorParityManifestSchema = z
  .object({
    $schema: z.url(),
    cases: z.array(colorParityCaseSchema).min(1),
    issue: z.literal(95),
    schemaVersion: z.literal(1),
    shaderFunctions: z.array(colorParityShaderFunctionSchema).min(1),
    snapshotDate: z.iso.date(),
    validationMode: z.literal('wgsl_contract_cpu_mirror'),
  })
  .strict()
  .superRefine((manifest, context) => {
    const caseIds = manifest.cases.map((testCase) => testCase.id);
    if (new Set(caseIds).size !== caseIds.length) {
      context.addIssue({ code: 'custom', message: 'Parity case IDs must be unique.', path: ['cases'] });
    }

    const requiredOperations = new Set(colorParityOperationSchema.options);
    for (const operation of manifest.cases.map((testCase) => testCase.operation)) {
      requiredOperations.delete(operation);
    }
    if (requiredOperations.size > 0) {
      context.addIssue({
        code: 'custom',
        message: `Missing parity cases for: ${[...requiredOperations].join(', ')}.`,
        path: ['cases'],
      });
    }

    const functionNames = manifest.shaderFunctions.map((entry) => entry.name);
    if (new Set(functionNames).size !== functionNames.length) {
      context.addIssue({
        code: 'custom',
        message: 'Shader function entries must be unique.',
        path: ['shaderFunctions'],
      });
    }
  });

export type ColorParityCase = z.infer<typeof colorParityCaseSchema>;
export type ColorParityManifest = z.infer<typeof colorParityManifestSchema>;
export type ColorParityVec3 = z.infer<typeof colorParityVec3Schema>;

const round = (value: number) => Number(value.toFixed(8));
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

const makeVec3 = (red: number, green: number, blue: number): ColorParityVec3 =>
  colorParityVec3Schema.parse([round(red), round(green), round(blue)]);

export const applyColorParityLinearExposure = (
  inputValue: ColorParityVec3,
  parameters: Record<string, number>,
): ColorParityVec3 => {
  const input = colorParityVec3Schema.parse(inputValue);
  const exposure = parameters['exposure'] ?? 0;
  if (exposure === 0) return makeVec3(input[0], input[1], input[2]);
  const multiplier = 2 ** exposure;
  return makeVec3(input[0] * multiplier, input[1] * multiplier, input[2] * multiplier);
};

export const applyColorParityWhiteBalance = (
  inputValue: ColorParityVec3,
  parameters: Record<string, number>,
): ColorParityVec3 => {
  const input = colorParityVec3Schema.parse(inputValue);
  const temperature = parameters['temperature'] ?? 0;
  const tint = parameters['tint'] ?? 0;
  return makeVec3(
    input[0] * (1 + temperature * 0.2) * (1 + tint * 0.25),
    input[1] * (1 + temperature * 0.05) * (1 - tint * 0.25),
    input[2] * (1 - temperature * 0.2) * (1 + tint * 0.25),
  );
};

export const applyColorParityLegacyTonemap = (inputValue: ColorParityVec3): ColorParityVec3 => {
  const input = colorParityVec3Schema.parse(inputValue);
  const tonemap = (channel: number) => {
    const x = Math.max(channel, 0);
    const numerator = x * (2.51 * x + 0.03);
    const denominator = x * (2.43 * x + 0.59) + 0.14;
    const tonemapped = denominator > 0.00001 ? numerator / denominator : 0;
    return clamp(tonemapped, 0, 1);
  };
  return makeVec3(tonemap(input[0]), tonemap(input[1]), tonemap(input[2]));
};

export const applyColorParityChannelMixer = (
  inputValue: ColorParityVec3,
  parameters: Record<string, number>,
): ColorParityVec3 => {
  const input = colorParityVec3Schema.parse(inputValue);
  const mixRow = (prefix: string) =>
    clamp(
      input[0] * (parameters[`${prefix}Red`] ?? (prefix === 'red' ? 1 : 0)) +
        input[1] * (parameters[`${prefix}Green`] ?? (prefix === 'green' ? 1 : 0)) +
        input[2] * (parameters[`${prefix}Blue`] ?? (prefix === 'blue' ? 1 : 0)) +
        (parameters[`${prefix}Constant`] ?? 0),
      0,
      1,
    );

  const mixed = makeVec3(mixRow('red'), mixRow('green'), mixRow('blue'));
  if ((parameters['preserveLuminance'] ?? 0) === 0) return mixed;

  const luma = (color: ColorParityVec3) => color[0] * 0.2126 + color[1] * 0.7152 + color[2] * 0.0722;
  const sourceLuma = luma(input);
  const mixedLuma = luma(mixed);
  if (sourceLuma <= 0 || mixedLuma <= 0) return mixed;

  const scale = sourceLuma / mixedLuma;
  return makeVec3(clamp(mixed[0] * scale, 0, 1), clamp(mixed[1] * scale, 0, 1), clamp(mixed[2] * scale, 0, 1));
};

export const evaluateColorParityCase = (testCaseValue: ColorParityCase): ColorParityVec3 => {
  const testCase = colorParityCaseSchema.parse(testCaseValue);
  switch (testCase.operation) {
    case 'channel_mixer':
      return applyColorParityChannelMixer(testCase.input, testCase.parameters);
    case 'linear_exposure':
      return applyColorParityLinearExposure(testCase.input, testCase.parameters);
    case 'white_balance':
      return applyColorParityWhiteBalance(testCase.input, testCase.parameters);
    case 'legacy_tonemap':
      return applyColorParityLegacyTonemap(testCase.input);
  }
};

export const parseColorParityManifest = (value: unknown): ColorParityManifest => colorParityManifestSchema.parse(value);
