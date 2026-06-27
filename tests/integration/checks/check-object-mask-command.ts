#!/usr/bin/env bun

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const files = {
  commands: readFileSync(resolve('src/tauri/commands.ts'), 'utf8'),
  aiCommands: readFileSync(resolve('src-tauri/src/ai_commands.rs'), 'utf8'),
  controls: readFileSync(resolve('src/components/panel/right/ObjectPromptControls.tsx'), 'utf8'),
  lib: readFileSync(resolve('src-tauri/src/lib.rs'), 'utf8'),
  panel: readFileSync(resolve('src/components/panel/right/MasksPanel.tsx'), 'utf8'),
};

const requiredSnippets = [
  [files.commands, "GenerateAiObjectMaskProposal = 'generate_ai_object_mask_proposal'"],
  [files.aiCommands, 'pub struct AiObjectMaskProposal'],
  [files.aiCommands, 'pub async fn generate_ai_object_mask_proposal'],
  [files.aiCommands, 'provider_id: "rapidraw-sam-vit-b-onnx-v1".to_string()'],
  [files.aiCommands, 'model_id: "sam_vit_b_01ec64".to_string()'],
  [files.aiCommands, 'click_to_mask_latency_ms'],
  [files.lib, 'ai_commands::generate_ai_object_mask_proposal'],
  [files.panel, 'ObjectPromptControls'],
  [files.controls, 'data-testid="object-prompt-controls"'],
  [files.controls, 'data-object-prompt-command-ready'],
  [files.controls, 'data-testid="object-prompt-generate-proposal"'],
  [files.controls, 'data-testid="object-prompt-replay-receipt"'],
] as const;

for (const [content, snippet] of requiredSnippets) {
  if (!content.includes(snippet)) {
    console.error(`object mask command missing: ${snippet}`);
    process.exit(1);
  }
}

console.log('object mask command ok');
