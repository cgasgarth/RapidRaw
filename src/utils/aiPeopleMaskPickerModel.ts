import {
  type AiPeopleMaskPart,
  type AiPeopleMaskPickerModel,
  type AiPeopleMaskProviderCapability,
  aiPeopleMaskPickerModelSchema,
} from '../schemas/aiMaskingSchemas';
import { AI_PEOPLE_MASK_PART_CAPABILITIES } from './aiPeopleMaskContracts';

const PART_LABELS: Record<AiPeopleMaskPart, string> = {
  arms: 'Arms',
  background: 'Background excluding people',
  clothing: 'Clothing',
  eyes: 'Eyes',
  face: 'Face',
  full_person: 'Full person',
  hair: 'Hair',
  hands: 'Hands',
  legs: 'Legs',
  lips: 'Lips',
  skin: 'Skin',
  teeth: 'Teeth',
};

const GROUPS: Array<{ id: 'body_parts' | 'core' | 'portrait_parts'; parts: Array<AiPeopleMaskPart>; title: string }> = [
  { id: 'core', parts: ['full_person', 'background'], title: 'People' },
  { id: 'portrait_parts', parts: ['face', 'skin', 'hair', 'eyes', 'lips', 'teeth'], title: 'Portrait parts' },
  { id: 'body_parts', parts: ['clothing', 'arms', 'hands', 'legs'], title: 'Body and wardrobe' },
];

const toDisabledReason = (capability: AiPeopleMaskProviderCapability): string | null => {
  if (capability.status === 'unsupported') {
    return capability.notes;
  }

  if (capability.status === 'planned') {
    return `Planned runtime target: ${capability.notes}`;
  }

  if (capability.validationMode === 'schema_only') {
    return 'Schema-only capability; runtime and dry-run output are not available yet.';
  }

  return null;
};

export function buildAiPeopleMaskPickerModel(
  capabilities: Array<AiPeopleMaskProviderCapability> = AI_PEOPLE_MASK_PART_CAPABILITIES,
): AiPeopleMaskPickerModel {
  const byPart = new Map(capabilities.map((capability) => [capability.part, capability]));

  return aiPeopleMaskPickerModelSchema.parse({
    groups: GROUPS.map((group) => ({
      id: group.id,
      options: group.parts.map((part) => {
        const capability = byPart.get(part);
        if (capability === undefined) {
          throw new Error(`Missing people-mask picker capability for ${part}.`);
        }

        return {
          disabledReason: toDisabledReason(capability),
          label: PART_LABELS[part],
          part,
          recommendedDefault: part === 'full_person' || part === 'background',
          status: capability.status,
          validationMode: capability.validationMode,
        };
      }),
      title: group.title,
    })),
    schemaVersion: 1,
  });
}
