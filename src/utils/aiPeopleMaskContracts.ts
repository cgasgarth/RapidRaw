import {
  aiPeopleMaskProviderCapabilitySchema,
  aiPeopleMaskPartSchema,
  type AiPeopleMaskPart,
  type AiPeopleMaskProviderCapability,
} from '../schemas/aiMaskingSchemas';

export const AI_PEOPLE_MASK_PART_CAPABILITIES: Array<AiPeopleMaskProviderCapability> =
  aiPeopleMaskProviderCapabilitySchema.array().parse([
    {
      notes: 'Whole-person selection is the first runtime target and can back multi-person masks.',
      part: 'full_person',
      providerTier: 'macos_person',
      status: 'supported',
      validationMode: 'runtime_apply',
    },
    {
      notes: 'Background is derived by subtracting people from the full image mask.',
      part: 'background',
      providerTier: 'macos_person',
      status: 'derived',
      validationMode: 'runtime_apply',
    },
    {
      notes: 'Face selection uses macOS Vision face detection as the first runtime portrait-part target.',
      part: 'face',
      providerTier: 'macos_face',
      status: 'supported',
      validationMode: 'runtime_apply',
    },
    {
      notes: 'Skin segmentation needs portrait-specific parsing and confidence warnings.',
      part: 'skin',
      providerTier: 'person_parser',
      status: 'planned',
      validationMode: 'dry_run',
    },
    {
      notes: 'Hair uses the model-backed human parser hair class with dedicated provenance and edge-risk validation.',
      part: 'hair',
      providerTier: 'person_parser',
      status: 'supported',
      validationMode: 'runtime_apply',
    },
    {
      notes: 'Clothing uses the model-backed human parser by merging top-clothes and bottom-clothes classes.',
      part: 'clothing',
      providerTier: 'person_parser',
      status: 'supported',
      validationMode: 'runtime_apply',
    },
    {
      notes: 'Arms require body-part parsing and should not be claimed by whole-person masks.',
      part: 'arms',
      providerTier: 'person_parser',
      status: 'planned',
      validationMode: 'dry_run',
    },
    {
      notes: 'Hands require body-part parsing with low-confidence warnings for occlusion.',
      part: 'hands',
      providerTier: 'person_parser',
      status: 'planned',
      validationMode: 'dry_run',
    },
    {
      notes: 'Legs require body-part parsing and cropped-person coordinate validation.',
      part: 'legs',
      providerTier: 'person_parser',
      status: 'planned',
      validationMode: 'dry_run',
    },
    {
      notes: 'Eyes need face-detail parsing and should stay out of runtime until quality proof exists.',
      part: 'eyes',
      providerTier: 'face_detail',
      status: 'planned',
      validationMode: 'dry_run',
    },
    {
      notes: 'Lips need face-detail parsing with makeup and profile-pose fixtures.',
      part: 'lips',
      providerTier: 'face_detail',
      status: 'planned',
      validationMode: 'dry_run',
    },
    {
      notes: 'Teeth need face-detail parsing and must remain unsupported until confidence is reliable.',
      part: 'teeth',
      providerTier: 'face_detail',
      status: 'unsupported',
      validationMode: 'schema_only',
    },
  ]);

export function getAiPeopleMaskPartCapability(part: AiPeopleMaskPart): AiPeopleMaskProviderCapability {
  const parsedPart = aiPeopleMaskPartSchema.parse(part);
  const capability = AI_PEOPLE_MASK_PART_CAPABILITIES.find((entry) => entry.part === parsedPart);
  if (capability === undefined) {
    throw new Error(`Missing AI people-mask capability contract for ${parsedPart}.`);
  }
  return capability;
}
