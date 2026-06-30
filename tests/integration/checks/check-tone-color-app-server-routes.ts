#!/usr/bin/env bun

import { readFileSync } from 'node:fs';

import { rawEngineLocalAppServerBridgeCapabilities } from '../../../packages/rawengine-schema/src/localAppServerBridge.ts';
import {
  toneColorCommandEnvelopeV1Schema,
  toneColorCommandTypeV1Schema,
} from '../../../packages/rawengine-schema/src/rawEngineSchemas.ts';
import {
  sampleToneColorCommandEnvelopeV1,
  sampleToolRegistryV1,
} from '../../../packages/rawengine-schema/src/samplePayloads.ts';
import {
  TONE_COLOR_APP_SERVER_COMMAND_TYPES,
  TONE_COLOR_APP_SERVER_EXECUTION_MODES,
  TONE_COLOR_APP_SERVER_TOOL_NAMES,
  ToneColorAppServerExecutionMode,
  ToneColorAppServerRouteStatus,
} from '../../../src/utils/toneColorAppServerRouteIds.ts';
import { TONE_COLOR_APP_SERVER_ROUTES } from '../../../src/utils/toneColorAppServerRoutes.ts';

const packageJson = JSON.parse(readFileSync('package.json', 'utf8'));
const packageScripts = new Set(Object.keys(packageJson.scripts ?? {}));
const runtimeCheckCommands = new Map<string, [string, ...string[]]>([
  ['check:basic-tone-command-bridge', ['bun', 'tests/integration/checks/check-basic-tone-command-bridge.ts']],
  ['check:black-white-mixer', ['bun', 'tests/integration/checks/check-black-white-mixer.ts']],
  ['check:channel-mixer', ['bun', 'tests/integration/checks/check-channel-mixer.ts']],
  ['check:color-balance-rgb', ['bun', 'tests/integration/checks/check-color-balance-rgb.ts']],
  ['check:color-grading-presets', ['bun', 'tests/integration/checks/check-color-grading-presets.ts']],
  ['check:levels-runtime', ['bun', 'test', '--reporter=dot', 'tests/pure-ts/levels-runtime.test.ts']],
  ['check:profile-tone', ['bun', 'tests/integration/checks/check-profile-tone.ts']],
  ['check:selective-color-ranges', ['bun', 'tests/integration/checks/check-selective-color-ranges.ts']],
  ['check:skin-tone-uniformity', ['bun', 'tests/integration/checks/check-skin-tone-uniformity.ts']],
  ['check:white-balance-picker', ['bun', 'tests/integration/checks/check-white-balance-picker-fixtures.ts']],
]);
const routeToolNames = new Set(TONE_COLOR_APP_SERVER_ROUTES.map((route) => route.toolName));
const expectedCommandTypes = toneColorCommandTypeV1Schema.options;
const expectedCommandTypeSet = new Set<string>(expectedCommandTypes);
const executableCommandTypes = new Set(rawEngineLocalAppServerBridgeCapabilities.commandTypes);
const failures = [];

if (JSON.stringify(TONE_COLOR_APP_SERVER_COMMAND_TYPES) !== JSON.stringify(expectedCommandTypes)) {
  failures.push('Tone-color route command types do not match the package command schema.');
}

for (const expectedToolName of TONE_COLOR_APP_SERVER_TOOL_NAMES) {
  if (!routeToolNames.has(expectedToolName)) failures.push(`${expectedToolName} is missing from route manifest.`);
}

for (const route of TONE_COLOR_APP_SERVER_ROUTES) {
  if (!expectedCommandTypeSet.has(route.commandType)) {
    failures.push(`${route.commandType} is not defined in the tone-color command schema.`);
  }

  const tool = sampleToolRegistryV1.tools.find((candidate) => candidate.toolName === route.toolName);
  if (tool === undefined) {
    failures.push(`${route.toolName} does not exist in the RawEngine tool registry.`);
    continue;
  }

  if (tool.inputSchemaName !== route.inputSchemaName || tool.outputSchemaName !== route.outputSchemaName) {
    failures.push(`${route.toolName} route schemas do not match the RawEngine tool registry.`);
  }

  const expectedMutates = route.executionMode === ToneColorAppServerExecutionMode.ApplyDryRunPlan;
  if (tool.mutates !== expectedMutates) {
    failures.push(`${route.toolName} mutates flag does not match route execution mode.`);
  }

  const executable = executableCommandTypes.has(route.commandType);
  if (executable && route.status !== ToneColorAppServerRouteStatus.Mapped) {
    failures.push(`${route.commandType} has an executable bridge handler but is not marked mapped.`);
  }
  if (!executable && route.status !== ToneColorAppServerRouteStatus.MappedUnavailable) {
    failures.push(`${route.commandType} lacks an executable bridge handler but is not marked unavailable.`);
  }

  if (!packageScripts.has(route.runtimeCheckScript) && !runtimeCheckCommands.has(route.runtimeCheckScript)) {
    failures.push(`${route.toolName} references missing runtime check ${route.runtimeCheckScript}.`);
  }
}

const parsedCommand = toneColorCommandEnvelopeV1Schema.safeParse(sampleToneColorCommandEnvelopeV1);
if (!parsedCommand.success || parsedCommand.data.commandType !== 'toneColor.setBasicTone') {
  failures.push('Sample tone-color command does not validate the basic tone command route type.');
}

const parsedToneCurveCommand = toneColorCommandEnvelopeV1Schema.safeParse({
  ...sampleToneColorCommandEnvelopeV1,
  commandId: 'command_tone_color_tone_curve_preview_sample',
  commandType: 'toneColor.setToneCurve',
  correlationId: 'corr_tone_color_tone_curve_preview_sample',
  idempotencyKey: 'idem_tone_color_tone_curve_preview_sample',
  parameters: {
    channel: 'luma',
    interpolation: 'monotone_cubic',
    points: [
      { input: 0, output: 0 },
      { input: 0.25, output: 0.22 },
      { input: 0.75, output: 0.8 },
      { input: 1, output: 1 },
    ],
  },
});
if (!parsedToneCurveCommand.success || parsedToneCurveCommand.data.commandType !== 'toneColor.setToneCurve') {
  failures.push('Tone-color tone curve command does not validate the ordered curve route type.');
}

const parsedWhiteBalanceCommand = toneColorCommandEnvelopeV1Schema.safeParse({
  ...sampleToneColorCommandEnvelopeV1,
  commandId: 'command_tone_color_white_balance_preview_sample',
  commandType: 'toneColor.setWhiteBalance',
  correlationId: 'corr_tone_color_white_balance_preview_sample',
  idempotencyKey: 'idem_tone_color_white_balance_preview_sample',
  parameters: {
    mode: 'custom_kelvin_tint',
    temperatureKelvin: 5500,
    tint: 8,
  },
});
if (!parsedWhiteBalanceCommand.success || parsedWhiteBalanceCommand.data.commandType !== 'toneColor.setWhiteBalance') {
  failures.push('Tone-color white balance command does not validate the custom Kelvin/tint route type.');
}

const parsedHslCommand = toneColorCommandEnvelopeV1Schema.safeParse({
  ...sampleToneColorCommandEnvelopeV1,
  commandId: 'command_tone_color_hsl_preview_sample',
  commandType: 'toneColor.adjustHsl',
  correlationId: 'corr_tone_color_hsl_preview_sample',
  idempotencyKey: 'idem_tone_color_hsl_preview_sample',
  parameters: {
    band: 'orange',
    hueShiftDegrees: -4,
    luminance: 6,
    saturation: 10,
  },
});
if (!parsedHslCommand.success || parsedHslCommand.data.commandType !== 'toneColor.adjustHsl') {
  failures.push('Tone-color HSL command does not validate the color-mixer route type.');
}

const parsedSkinToneCommand = toneColorCommandEnvelopeV1Schema.safeParse({
  ...sampleToneColorCommandEnvelopeV1,
  commandId: 'command_tone_color_skin_uniformity_preview_sample',
  commandType: 'toneColor.adjustSkinToneUniformity',
  correlationId: 'corr_tone_color_skin_uniformity_preview_sample',
  idempotencyKey: 'idem_tone_color_skin_uniformity_preview_sample',
  parameters: {
    experimental: true,
    hueUniformity: 0.45,
    luminanceUniformity: 0.25,
    maxHueShiftDegrees: 18,
    saturationUniformity: 0.35,
    targetHueDegrees: 22,
    targetLuminance: 0.58,
    targetSaturation: 0.36,
  },
});
if (!parsedSkinToneCommand.success || parsedSkinToneCommand.data.commandType !== 'toneColor.adjustSkinToneUniformity') {
  failures.push('Tone-color skin-tone uniformity command does not validate the experimental route type.');
}

const parsedColorGradingCommand = toneColorCommandEnvelopeV1Schema.safeParse({
  ...sampleToneColorCommandEnvelopeV1,
  commandId: 'command_tone_color_color_grading_preview_sample',
  commandType: 'toneColor.setColorGrading',
  correlationId: 'corr_tone_color_color_grading_preview_sample',
  idempotencyKey: 'idem_tone_color_color_grading_preview_sample',
  parameters: {
    balance: -8,
    blend: 45,
    global: { hueDegrees: 28, luminance: 0, saturation: 6 },
    highlights: { hueDegrees: 38, luminance: 4, saturation: 12 },
    midtones: { hueDegrees: 30, luminance: 0, saturation: 8 },
    shadows: { hueDegrees: 220, luminance: -3, saturation: 10 },
  },
});
if (!parsedColorGradingCommand.success || parsedColorGradingCommand.data.commandType !== 'toneColor.setColorGrading') {
  failures.push('Tone-color color grading command does not validate the wheel/blend route type.');
}

const parsedLevelsCommand = toneColorCommandEnvelopeV1Schema.safeParse({
  ...sampleToneColorCommandEnvelopeV1,
  commandId: 'command_tone_color_levels_preview_sample',
  commandType: 'toneColor.setLevels',
  correlationId: 'corr_tone_color_levels_preview_sample',
  idempotencyKey: 'idem_tone_color_levels_preview_sample',
  parameters: {
    channel: 'luma',
    enabled: true,
    gamma: 1.1,
    inputBlack: 0.03,
    inputWhite: 0.98,
    outputBlack: 0,
    outputWhite: 1,
  },
});
if (!parsedLevelsCommand.success || parsedLevelsCommand.data.commandType !== 'toneColor.setLevels') {
  failures.push('Tone-color levels command does not validate the luma levels command route type.');
}

const parsedChannelMixerCommand = toneColorCommandEnvelopeV1Schema.safeParse({
  ...sampleToneColorCommandEnvelopeV1,
  commandId: 'command_tone_color_channel_mixer_preview_sample',
  commandType: 'toneColor.setChannelMixer',
  correlationId: 'corr_tone_color_channel_mixer_preview_sample',
  idempotencyKey: 'idem_tone_color_channel_mixer_preview_sample',
  parameters: {
    blue: { blue: 100, constant: 0, green: 0, red: 0 },
    enabled: true,
    green: { blue: 0, constant: 0, green: 100, red: 0 },
    preserveLuminance: true,
    red: { blue: -5, constant: 0, green: 10, red: 95 },
  },
});
if (!parsedChannelMixerCommand.success || parsedChannelMixerCommand.data.commandType !== 'toneColor.setChannelMixer') {
  failures.push('Tone-color channel mixer command does not validate the RGB mixer route type.');
}

const parsedColorBalanceCommand = toneColorCommandEnvelopeV1Schema.safeParse({
  ...sampleToneColorCommandEnvelopeV1,
  commandId: 'command_tone_color_color_balance_rgb_preview_sample',
  commandType: 'toneColor.setColorBalanceRgb',
  correlationId: 'corr_tone_color_color_balance_rgb_preview_sample',
  idempotencyKey: 'idem_tone_color_color_balance_rgb_preview_sample',
  parameters: {
    enabled: true,
    highlights: { blue: -8, green: 2, red: 10 },
    midtones: { blue: -2, green: 0, red: 2 },
    preserveLuminance: true,
    shadows: { blue: 12, green: 0, red: -8 },
  },
});
if (
  !parsedColorBalanceCommand.success ||
  parsedColorBalanceCommand.data.commandType !== 'toneColor.setColorBalanceRgb'
) {
  failures.push('Tone-color RGB color balance command does not validate the range-weighted route type.');
}

const parsedBlackWhiteMixerCommand = toneColorCommandEnvelopeV1Schema.safeParse({
  ...sampleToneColorCommandEnvelopeV1,
  commandId: 'command_tone_color_black_white_mixer_preview_sample',
  commandType: 'toneColor.setBlackWhiteMixer',
  correlationId: 'corr_tone_color_black_white_mixer_preview_sample',
  idempotencyKey: 'idem_tone_color_black_white_mixer_preview_sample',
  parameters: {
    enabled: true,
    weights: {
      aquas: -4,
      blues: -10,
      greens: 8,
      magentas: 0,
      oranges: 12,
      purples: 0,
      reds: 18,
      yellows: 10,
    },
  },
});
if (
  !parsedBlackWhiteMixerCommand.success ||
  parsedBlackWhiteMixerCommand.data.commandType !== 'toneColor.setBlackWhiteMixer'
) {
  failures.push('Tone-color black and white mixer command does not validate the hue-weighted route type.');
}

for (const commandType of expectedCommandTypes) {
  const routeModeCounts = new Map<string, number>();
  for (const route of TONE_COLOR_APP_SERVER_ROUTES.filter((candidate) => candidate.commandType === commandType)) {
    routeModeCounts.set(route.executionMode, (routeModeCounts.get(route.executionMode) ?? 0) + 1);
  }

  for (const mode of TONE_COLOR_APP_SERVER_EXECUTION_MODES) {
    const count = routeModeCounts.get(mode) ?? 0;
    if (count === 0) failures.push(`${commandType} missing ${mode} route.`);
    if (count > 1) failures.push(`${commandType} has duplicate ${mode} routes.`);
  }
}

for (const runtimeCheckScript of new Set(TONE_COLOR_APP_SERVER_ROUTES.map((route) => route.runtimeCheckScript))) {
  runRuntimeCheck(runtimeCheckScript);
}

if (failures.length > 0) {
  console.error('Tone-color app-server route validation failed:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`tone-color app-server routes ok (${TONE_COLOR_APP_SERVER_ROUTES.length})`);

function runRuntimeCheck(scriptName: string): void {
  const command = runtimeCheckCommands.get(scriptName) ?? ['bun', 'run', scriptName];
  const result = Bun.spawnSync(command, {
    stderr: 'pipe',
    stdout: 'pipe',
  });

  if (result.exitCode === 0) return;

  const output = [new TextDecoder().decode(result.stdout), new TextDecoder().decode(result.stderr)]
    .join('\n')
    .split('\n')
    .filter(Boolean)
    .slice(-20)
    .join('\n');
  failures.push(`${scriptName} failed:\n${output}`);
}
