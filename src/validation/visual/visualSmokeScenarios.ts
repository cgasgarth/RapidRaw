export const VISUAL_SMOKE_SCENARIOS = [
  {
    marker: 'Editor Preview',
    mode: 'empty-library',
    outputFile: 'empty-library.png',
    sectionMinimum: 4,
  },
  {
    marker: 'Command Palette Workflows',
    mode: 'command-palette-workflows',
    outputFile: 'command-palette-workflows.png',
    sectionMinimum: 1,
  },
  {
    marker: 'Agent chat UI smoke',
    mode: 'agent-chat-ui',
    outputFile: 'agent-chat-ui.png',
    sectionMinimum: 1,
  },
  {
    marker: 'Panorama setup',
    mode: 'panorama-ui',
    outputFile: 'panorama-ui.png',
    sectionMinimum: 1,
  },
  {
    marker: 'Focus-stack plan',
    mode: 'focus-ui',
    outputFile: 'focus-ui.png',
    sectionMinimum: 1,
  },
  {
    marker: 'HDR merge setup',
    mode: 'hdr-ui',
    outputFile: 'hdr-ui.png',
    sectionMinimum: 1,
  },
  {
    marker: 'Super-resolution plan',
    mode: 'sr-ui',
    outputFile: 'sr-ui.png',
    sectionMinimum: 1,
  },
  {
    marker: 'Negative Conversion',
    mode: 'negative-lab-workspace',
    outputFile: 'negative-lab-workspace.png',
    sectionMinimum: 1,
  },
  {
    appMode: 'negative-lab-workspace',
    marker: 'Negative Conversion',
    mode: 'negative-lab-batch-color-workspace',
    outputFile: 'negative-lab-batch-color-workspace.png',
    sectionMinimum: 1,
  },
  {
    marker: 'Film Looks',
    mode: 'film-look-browser',
    outputFile: 'film-look-browser.png',
    sectionMinimum: 2,
  },
  {
    marker: 'Color Workflow',
    mode: 'color-workflow',
    outputFile: 'color-workflow.png',
    sectionMinimum: 2,
  },
  {
    marker: 'Local Adjustment Stack',
    mode: 'layer-stack-workflow',
    outputFile: 'layer-stack-workflow.png',
    sectionMinimum: 3,
  },
  {
    marker: 'Cull Session',
    mode: 'library-workflow',
    outputFile: 'library-workflow.png',
    sectionMinimum: 3,
  },
  {
    marker: 'Zoom detail workspace',
    mode: 'detail-workspace',
    outputFile: 'detail-workspace.png',
    sectionMinimum: 3,
  },
] as const;

export type VisualSmokeScenario = (typeof VISUAL_SMOKE_SCENARIOS)[number];
export type VisualSmokeMode = VisualSmokeScenario['mode'];

export const VISUAL_SMOKE_MODES = VISUAL_SMOKE_SCENARIOS.map((scenario) => scenario.mode);
