import type { ComputationalPrivateProofRunnerConfig } from './computational-private-proof-runner.ts';

export type ComputationalPrivateProofFamily = 'focus' | 'hdr' | 'panorama' | 'sr';

export const computationalPrivateProofConfigs = {
  focus: {
    featureLabel: 'focus',
    fixtureId: 'validation.computational-merge.focus-plane-transition.v1',
    privateStep: {
      command: [
        'cargo',
        'test',
        '--quiet',
        '--locked',
        '--no-default-features',
        '--features',
        'required-ci,tauri-test',
        'focus_real_raw_proof::private_stack_artifact_smoke_generates_focus_real_raw_report_when_enabled',
        '--',
        '--nocapture',
      ],
      cwd: 'src-tauri',
      env: {
        RAWENGINE_RUN_PRIVATE_FOCUS_REAL_RAW_STACK_PROOF: '1',
      },
      label: 'focus real RAW Rust stack proof',
    },
    proofChecks: [
      ['bun', 'run', 'check:focus-runtime-plan-smoke'],
      ['bun', 'run', 'check:focus-app-server-runtime'],
      ['bun', 'run', 'check:focus-ui-runtime-bridge'],
    ],
    postPrivateChecks: [
      ['bun', 'run', 'check:focus-real-raw-private-app-server-proof'],
      ['bun', 'run', 'check:focus-private-raw-ui-smoke'],
    ],
    skipLabel: 'focus real RAW private proof',
  },
  hdr: {
    featureLabel: 'hdr',
    fixtureId: 'validation.computational-merge.hdr-bracket-alignment.v1',
    privateStep: {
      command: [
        'cargo',
        'test',
        '--quiet',
        '--locked',
        '--no-default-features',
        '--features',
        'required-ci,tauri-test',
        'hdr_real_raw_proof::private_runtime_smoke_generates_hdr_real_raw_report_when_enabled',
        '--',
        '--nocapture',
      ],
      cwd: 'src-tauri',
      env: {
        RAWENGINE_RUN_PRIVATE_HDR_REAL_RAW_PROOF: '1',
      },
      label: 'hdr real RAW Rust proof',
    },
    proofChecks: [
      ['bun', 'run', 'check:hdr-runtime-plan-smoke'],
      ['bun', 'run', 'check:hdr-app-server-runtime'],
      ['bun', 'run', 'check:hdr-ui-runtime-bridge'],
    ],
    postPrivateChecks: [
      ['bun', 'run', 'check:hdr-real-raw-private-app-server-proof'],
      ['bun', 'run', 'check:hdr-private-raw-ui-smoke'],
    ],
    skipLabel: 'hdr real RAW private proof',
  },
  panorama: {
    featureLabel: 'panorama',
    fixtureId: 'validation.computational-merge.panorama-overlap.v1',
    privateStep: {
      command: [
        'cargo',
        'test',
        '--quiet',
        '--locked',
        '--no-default-features',
        '--features',
        'required-ci,tauri-test',
        'panorama_real_raw_proof::private_preview_export_smoke_generates_panorama_real_raw_report_when_enabled',
        '--',
        '--nocapture',
      ],
      cwd: 'src-tauri',
      env: {
        RAWENGINE_RUN_PRIVATE_PANORAMA_REAL_RAW_PREVIEW_EXPORT_PROOF: '1',
      },
      label: 'panorama real RAW Rust preview/export proof',
    },
    proofChecks: [
      ['bun', 'run', 'check:panorama-runtime-plan-smoke'],
      ['bun', 'run', 'check:panorama-app-server-runtime'],
      ['bun', 'run', 'check:panorama-ui-runtime-bridge'],
    ],
    postPrivateChecks: [
      ['bun', 'run', 'check:panorama-real-raw-private-app-server-proof'],
      ['bun', 'run', 'check:panorama-private-raw-ui-smoke'],
    ],
    skipLabel: 'panorama real RAW private proof',
  },
  sr: {
    featureLabel: 'SR',
    fixtureId: 'validation.computational-merge.super-resolution-subpixel.v1',
    privateStep: {
      command: [
        'cargo',
        'test',
        '--quiet',
        '--locked',
        '--no-default-features',
        '--features',
        'required-ci,tauri-test',
        'sr_real_raw_proof::private_reconstruction_artifact_smoke_generates_sr_real_raw_report_when_enabled',
        '--',
        '--nocapture',
      ],
      cwd: 'src-tauri',
      env: {
        RAWENGINE_RUN_PRIVATE_SR_REAL_RAW_ARTIFACT_PROOF: '1',
      },
      label: 'SR real RAW Rust artifact proof',
    },
    proofChecks: [
      ['bun', 'run', 'check:sr-runtime-plan-smoke'],
      ['bun', 'run', 'check:sr-app-server-runtime'],
      ['bun', 'run', 'check:sr-ui-runtime-bridge'],
    ],
    postPrivateChecks: [
      ['bun', 'run', 'check:sr-real-raw-private-app-server-proof'],
      ['bun', 'run', 'check:sr-private-raw-ui-smoke'],
      ['bun', 'run', 'check:sr-private-raw-modal-review-smoke'],
    ],
    skipLabel: 'SR real RAW private proof',
  },
} satisfies Record<ComputationalPrivateProofFamily, ComputationalPrivateProofRunnerConfig>;

export function getComputationalPrivateProofConfig(
  family: ComputationalPrivateProofFamily,
): ComputationalPrivateProofRunnerConfig {
  return computationalPrivateProofConfigs[family];
}
