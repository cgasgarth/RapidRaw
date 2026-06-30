import {
  type AiMaskCapability,
  type AiMaskCapabilityAuditEntry,
  aiMaskCapabilityAuditSchema,
  aiMaskCapabilitySchema,
} from '../schemas/aiMaskingSchemas';

export const AI_MASK_CAPABILITY_AUDIT: Array<AiMaskCapabilityAuditEntry> = aiMaskCapabilityAuditSchema.parse([
  {
    capability: 'subject',
    invokeCommand: 'generate_ai_subject_mask',
    renderMaskType: 'ai-subject',
    status: 'native',
  },
  {
    capability: 'sky',
    invokeCommand: 'generate_ai_sky_mask',
    renderMaskType: 'ai-sky',
    status: 'native',
  },
  {
    capability: 'foreground',
    invokeCommand: 'generate_ai_foreground_mask',
    renderMaskType: 'ai-foreground',
    status: 'native',
  },
  {
    capability: 'person',
    invokeCommand: 'generate_ai_whole_person_mask',
    renderMaskType: 'ai-person',
    status: 'native',
  },
  {
    capability: 'background',
    derivedFrom: 'foreground',
    invokeCommand: null,
    renderMaskType: 'ai-foreground',
    status: 'derived',
  },
  {
    capability: 'depth',
    invokeCommand: 'generate_ai_depth_mask',
    renderMaskType: 'ai-depth',
    status: 'native',
  },
]);

export function getAiMaskCapabilityAudit(capability: AiMaskCapability): AiMaskCapabilityAuditEntry {
  const parsedCapability = aiMaskCapabilitySchema.parse(capability);
  const entry = AI_MASK_CAPABILITY_AUDIT.find((candidate) => candidate.capability === parsedCapability);
  if (entry === undefined) {
    throw new Error(`Missing AI mask capability audit entry for ${parsedCapability}.`);
  }
  return entry;
}
