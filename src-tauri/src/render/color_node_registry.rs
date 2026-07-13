//! Executable color-node contract shared by the renderer and conformance laboratory.

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum ColorNodeBackend {
    Cpu,
    Wgpu,
    CpuPostWgpu,
}

#[derive(Clone, Copy, Debug)]
pub(crate) struct ColorNodeContract {
    pub id: &'static str,
    pub version: u32,
    pub order: u16,
    pub input_domain: &'static str,
    pub output_domain: &'static str,
    pub backend: ColorNodeBackend,
    pub tolerance: f64,
}

const SCENE_LINEAR: &str = "acescg_scene_linear_extended_v1";

pub(crate) const COLOR_NODE_REGISTRY: &[ColorNodeContract] = &[
    ColorNodeContract {
        id: "scene_denoise",
        version: 1,
        order: 100,
        input_domain: SCENE_LINEAR,
        output_domain: SCENE_LINEAR,
        backend: ColorNodeBackend::Cpu,
        tolerance: 1.0e-6,
    },
    ColorNodeContract {
        id: "scene_deblur",
        version: 1,
        order: 110,
        input_domain: SCENE_LINEAR,
        output_domain: SCENE_LINEAR,
        backend: ColorNodeBackend::Cpu,
        tolerance: 1.0e-6,
    },
    ColorNodeContract {
        id: "scene_wavelet_detail",
        version: 1,
        order: 120,
        input_domain: SCENE_LINEAR,
        output_domain: SCENE_LINEAR,
        backend: ColorNodeBackend::Cpu,
        tolerance: 1.0e-6,
    },
    ColorNodeContract {
        id: "exposure",
        version: 1,
        order: 200,
        input_domain: SCENE_LINEAR,
        output_domain: SCENE_LINEAR,
        backend: ColorNodeBackend::Wgpu,
        tolerance: 2.0e-3,
    },
    ColorNodeContract {
        id: "basic_tone",
        version: 1,
        order: 210,
        input_domain: SCENE_LINEAR,
        output_domain: SCENE_LINEAR,
        backend: ColorNodeBackend::Wgpu,
        tolerance: 2.0e-3,
    },
    ColorNodeContract {
        id: "white_balance",
        version: 1,
        order: 220,
        input_domain: SCENE_LINEAR,
        output_domain: SCENE_LINEAR,
        backend: ColorNodeBackend::Wgpu,
        tolerance: 2.0e-3,
    },
    ColorNodeContract {
        id: "hue_saturation_vibrance",
        version: 1,
        order: 230,
        input_domain: SCENE_LINEAR,
        output_domain: SCENE_LINEAR,
        backend: ColorNodeBackend::Wgpu,
        tolerance: 2.0e-3,
    },
    ColorNodeContract {
        id: "color_grading",
        version: 1,
        order: 240,
        input_domain: SCENE_LINEAR,
        output_domain: SCENE_LINEAR,
        backend: ColorNodeBackend::Wgpu,
        tolerance: 2.0e-3,
    },
    ColorNodeContract {
        id: "color_calibration",
        version: 1,
        order: 250,
        input_domain: SCENE_LINEAR,
        output_domain: SCENE_LINEAR,
        backend: ColorNodeBackend::Wgpu,
        tolerance: 2.0e-3,
    },
    ColorNodeContract {
        id: "levels",
        version: 1,
        order: 260,
        input_domain: SCENE_LINEAR,
        output_domain: SCENE_LINEAR,
        backend: ColorNodeBackend::Wgpu,
        tolerance: 2.0e-3,
    },
    ColorNodeContract {
        id: "hsl_ranges",
        version: 1,
        order: 270,
        input_domain: SCENE_LINEAR,
        output_domain: SCENE_LINEAR,
        backend: ColorNodeBackend::Wgpu,
        tolerance: 2.0e-3,
    },
    ColorNodeContract {
        id: "rgb_curves",
        version: 1,
        order: 280,
        input_domain: SCENE_LINEAR,
        output_domain: SCENE_LINEAR,
        backend: ColorNodeBackend::Wgpu,
        tolerance: 2.0e-3,
    },
    ColorNodeContract {
        id: "chroma_luma_noise_reduction",
        version: 1,
        order: 290,
        input_domain: SCENE_LINEAR,
        output_domain: SCENE_LINEAR,
        backend: ColorNodeBackend::Wgpu,
        tolerance: 3.0e-3,
    },
    ColorNodeContract {
        id: "sharpness",
        version: 1,
        order: 300,
        input_domain: SCENE_LINEAR,
        output_domain: SCENE_LINEAR,
        backend: ColorNodeBackend::Wgpu,
        tolerance: 3.0e-3,
    },
    ColorNodeContract {
        id: "local_contrast",
        version: 1,
        order: 310,
        input_domain: SCENE_LINEAR,
        output_domain: SCENE_LINEAR,
        backend: ColorNodeBackend::Wgpu,
        tolerance: 3.0e-3,
    },
    ColorNodeContract {
        id: "vignette_grain_aberration",
        version: 1,
        order: 320,
        input_domain: SCENE_LINEAR,
        output_domain: SCENE_LINEAR,
        backend: ColorNodeBackend::Wgpu,
        tolerance: 3.0e-3,
    },
    ColorNodeContract {
        id: "glow_halation_flare",
        version: 1,
        order: 330,
        input_domain: SCENE_LINEAR,
        output_domain: SCENE_LINEAR,
        backend: ColorNodeBackend::Wgpu,
        tolerance: 4.0e-3,
    },
    ColorNodeContract {
        id: "masked_adjustments",
        version: 1,
        order: 340,
        input_domain: SCENE_LINEAR,
        output_domain: SCENE_LINEAR,
        backend: ColorNodeBackend::Wgpu,
        tolerance: 3.0e-3,
    },
    ColorNodeContract {
        id: "lut_3d",
        version: 1,
        order: 350,
        input_domain: SCENE_LINEAR,
        output_domain: SCENE_LINEAR,
        backend: ColorNodeBackend::Wgpu,
        tolerance: 3.0e-3,
    },
    ColorNodeContract {
        id: "color_balance_rgb",
        version: 1,
        order: 400,
        input_domain: SCENE_LINEAR,
        output_domain: SCENE_LINEAR,
        backend: ColorNodeBackend::CpuPostWgpu,
        tolerance: 1.0e-6,
    },
    ColorNodeContract {
        id: "channel_mixer",
        version: 1,
        order: 410,
        input_domain: SCENE_LINEAR,
        output_domain: SCENE_LINEAR,
        backend: ColorNodeBackend::CpuPostWgpu,
        tolerance: 1.0e-6,
    },
    ColorNodeContract {
        id: "black_white_mixer",
        version: 2,
        order: 420,
        input_domain: SCENE_LINEAR,
        output_domain: SCENE_LINEAR,
        backend: ColorNodeBackend::CpuPostWgpu,
        tolerance: 1.0e-6,
    },
    ColorNodeContract {
        id: "clipping_overlay",
        version: 1,
        order: 490,
        input_domain: SCENE_LINEAR,
        output_domain: "display_referred_linear_v1",
        backend: ColorNodeBackend::Wgpu,
        tolerance: 3.0e-3,
    },
    ColorNodeContract {
        id: "tone_mapper",
        version: 1,
        order: 500,
        input_domain: SCENE_LINEAR,
        output_domain: "display_referred_linear_v1",
        backend: ColorNodeBackend::Wgpu,
        tolerance: 3.0e-3,
    },
];

pub(crate) fn update_contract_hash(hasher: &mut blake3::Hasher) {
    hasher.update(b"rapidraw.color-node-registry.v1");
    for node in COLOR_NODE_REGISTRY {
        hasher.update(node.id.as_bytes());
        hasher.update(&node.version.to_le_bytes());
        hasher.update(&node.order.to_le_bytes());
        hasher.update(node.input_domain.as_bytes());
        hasher.update(node.output_domain.as_bytes());
        hasher.update(&[match node.backend {
            ColorNodeBackend::Cpu => 0,
            ColorNodeBackend::Wgpu => 1,
            ColorNodeBackend::CpuPostWgpu => 2,
        }]);
        hasher.update(&node.tolerance.to_bits().to_le_bytes());
    }
}
