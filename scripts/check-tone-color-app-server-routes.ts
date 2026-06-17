#!/usr/bin/env bun

import { readFileSync } from 'node:fs';

import {
  sampleToolRegistryV1,
  sampleToneColorCommandEnvelopeV1,
} from '../packages/rawengine-schema/src/samplePayloads.ts';
import { toneColorCommandEnvelopeV1Schema } from '../packages/rawengine-schema/src/rawEngineSchemas.ts';
import { TONE_COLOR_APP_SERVER_ROUTES } from '../src/utils/toneColorAppServerRoutes.ts';

const packageJson = JSON.parse(readFileSync('package.json', 'utf8'));
const packageScripts = new Set(Object.keys(packageJson.scripts ?? {}));
const routeToolNames = new Set(TONE_COLOR_APP_SERVER_ROUTES.map((route) => route.toolName));
const failures = [];

for (const expectedToolName of ['tonecolor.dry_run_command', 'tonecolor.apply_command']) {
  if (!routeToolNames.has(expectedToolName)) failures.push(`${expectedToolName} is missing from route manifest.`);
}

for (const route of TONE_COLOR_APP_SERVER_ROUTES) {
  const tool = sampleToolRegistryV1.tools.find((candidate) => candidate.toolName === route.toolName);
  if (tool === undefined) {
    failures.push(`${route.toolName} does not exist in the RawEngine tool registry.`);
    continue;
  }

  if (tool.inputSchemaName !== route.inputSchemaName || tool.outputSchemaName !== route.outputSchemaName) {
    failures.push(`${route.toolName} route schemas do not match the RawEngine tool registry.`);
  }

  const expectedMutates = route.executionMode === 'apply_dry_run_plan';
  if (tool.mutates !== expectedMutates) {
    failures.push(`${route.toolName} mutates flag does not match route execution mode.`);
  }

  if (!packageScripts.has(route.runtimeCheckScript)) {
    failures.push(`${route.toolName} references missing runtime check ${route.runtimeCheckScript}.`);
  }
}

const parsedCommand = toneColorCommandEnvelopeV1Schema.safeParse(sampleToneColorCommandEnvelopeV1);
if (!parsedCommand.success || parsedCommand.data.commandType !== 'toneColor.setBasicTone') {
  failures.push('Sample tone-color command does not validate the basic tone command route type.');
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

for (const commandType of ['toneColor.setLevels', 'toneColor.setChannelMixer']) {
  const routeModes = new Set(
    TONE_COLOR_APP_SERVER_ROUTES.filter((route) => route.commandType === commandType).map(
      (route) => route.executionMode,
    ),
  );
  for (const mode of ['dry_run_command', 'apply_dry_run_plan']) {
    if (!routeModes.has(mode)) failures.push(`${commandType} missing ${mode} route.`);
  }
}

if (failures.length > 0) {
  console.error('Tone-color app-server route validation failed:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`tone-color app-server routes ok (${TONE_COLOR_APP_SERVER_ROUTES.length})`);
