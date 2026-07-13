use bytemuck::{Pod, Zeroable};
use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize, Debug, Clone, Copy, Pod, Zeroable, Default)]
#[repr(C)]
pub struct Point {
    pub(crate) x: f32,
    pub(crate) y: f32,
    pub(crate) _pad1: f32,
    pub(crate) _pad2: f32,
}

#[derive(Serialize, Deserialize, Debug, Clone, Copy, Pod, Zeroable, Default)]
#[repr(C)]
pub struct HslColor {
    pub(crate) hue: f32,
    pub(crate) saturation: f32,
    pub(crate) luminance: f32,
    pub(crate) _pad: f32,
}

#[derive(Serialize, Deserialize, Debug, Clone, Copy, Pod, Zeroable, Default)]
#[repr(C)]
pub struct ColorGradeSettings {
    pub hue: f32,
    pub saturation: f32,
    pub luminance: f32,
    pub(crate) _pad: f32,
}

#[derive(Serialize, Deserialize, Debug, Clone, Copy, Pod, Zeroable, Default)]
#[repr(C)]
pub struct ColorCalibrationSettings {
    pub shadows_tint: f32,
    pub red_hue: f32,
    pub red_saturation: f32,
    pub green_hue: f32,
    pub green_saturation: f32,
    pub blue_hue: f32,
    pub blue_saturation: f32,
    pub(crate) _pad1: f32,
}

#[derive(Serialize, Deserialize, Debug, Clone, Copy, Pod, Zeroable, Default)]
#[repr(C)]
pub struct ChannelMixerRow {
    pub(crate) red: f32,
    pub(crate) green: f32,
    pub(crate) blue: f32,
    pub(crate) constant: f32,
}

#[derive(Serialize, Deserialize, Debug, Clone, Copy, Pod, Zeroable, Default)]
#[repr(C)]
pub struct ChannelMixerSettings {
    pub(crate) red: ChannelMixerRow,
    pub(crate) green: ChannelMixerRow,
    pub(crate) blue: ChannelMixerRow,
    pub(crate) enabled: u32,
    pub(crate) preserve_luminance: u32,
    pub(crate) _pad1: u32,
    pub(crate) _pad2: u32,
}

#[derive(Serialize, Deserialize, Debug, Clone, Copy, Pod, Zeroable)]
#[repr(C)]
pub struct LevelsSettings {
    pub(crate) input_black: f32,
    pub(crate) input_white: f32,
    pub(crate) gamma: f32,
    pub(crate) output_black: f32,
    pub(crate) output_white: f32,
    pub(crate) enabled: u32,
    pub(crate) _pad1: u32,
    pub(crate) _pad2: u32,
}

impl Default for LevelsSettings {
    fn default() -> Self {
        Self {
            input_black: 0.0,
            input_white: 1.0,
            gamma: 1.0,
            output_black: 0.0,
            output_white: 1.0,
            enabled: 0,
            _pad1: 0,
            _pad2: 0,
        }
    }
}

#[derive(Serialize, Deserialize, Debug, Clone, Copy, Pod, Zeroable)]
#[repr(C)]
pub struct ColorBalanceRgbSettings {
    pub(crate) shadows: [f32; 4],
    pub(crate) midtones: [f32; 4],
    pub(crate) highlights: [f32; 4],
    pub(crate) enabled: u32,
    pub(crate) preserve_luminance: u32,
    pub(crate) _pad1: u32,
    pub(crate) _pad2: u32,
}

impl Default for ColorBalanceRgbSettings {
    fn default() -> Self {
        Self {
            shadows: [0.0; 4],
            midtones: [0.0; 4],
            highlights: [0.0; 4],
            enabled: 0,
            preserve_luminance: 1,
            _pad1: 0,
            _pad2: 0,
        }
    }
}

#[derive(Serialize, Deserialize, Debug, Clone, Copy, Pod, Zeroable, Default)]
#[repr(C)]
pub struct BlackWhiteMixerSettings {
    pub reds: f32,
    pub oranges: f32,
    pub yellows: f32,
    pub greens: f32,
    pub aquas: f32,
    pub blues: f32,
    pub purples: f32,
    pub magentas: f32,
    pub enabled: u32,
    pub(crate) _pad1: u32,
    pub(crate) _pad2: u32,
    pub(crate) _pad3: u32,
}

#[derive(Serialize, Deserialize, Debug, Clone, Copy, Pod, Zeroable)]
#[repr(C)]
pub struct GpuMat3 {
    pub(crate) col0: [f32; 4],
    pub(crate) col1: [f32; 4],
    pub(crate) col2: [f32; 4],
}

impl Default for GpuMat3 {
    fn default() -> Self {
        Self {
            col0: [1.0, 0.0, 0.0, 0.0],
            col1: [0.0, 1.0, 0.0, 0.0],
            col2: [0.0, 0.0, 1.0, 0.0],
        }
    }
}

#[derive(Serialize, Deserialize, Debug, Clone, Copy, Pod, Zeroable, Default)]
#[repr(C)]
pub struct GlobalAdjustments {
    pub exposure: f32,
    pub brightness: f32,
    pub contrast: f32,
    pub highlights: f32,
    pub shadows: f32,
    pub whites: f32,
    pub blacks: f32,
    pub saturation: f32,
    pub temperature: f32,
    pub tint: f32,
    pub vibrance: f32,
    pub hue: f32,
    pub(crate) _pad_color1: f32,
    pub(crate) _pad_color2: f32,
    pub(crate) _pad_color3: f32,
    pub(crate) _pad_color4: f32,
    pub technical_white_balance: GpuMat3,
    pub sharpness: f32,
    pub luma_noise_reduction: f32,
    pub color_noise_reduction: f32,
    pub clarity: f32,
    pub dehaze: f32,
    pub structure: f32,
    pub centré: f32,
    pub vignette_amount: f32,
    pub vignette_midpoint: f32,
    pub vignette_roundness: f32,
    pub vignette_feather: f32,
    pub grain_amount: f32,
    pub grain_size: f32,
    pub grain_roughness: f32,
    pub chromatic_aberration_red_cyan: f32,
    pub chromatic_aberration_blue_yellow: f32,
    pub show_clipping: u32,
    pub is_raw_image: u32,
    pub(crate) _pad_ca1: f32,
    pub has_lut: u32,
    pub lut_intensity: f32,
    pub tonemapper_mode: u32,
    pub(crate) _pad_lut2: f32,
    pub(crate) _pad_lut3: f32,
    pub(crate) _pad_lut4: f32,
    pub(crate) _pad_lut5: f32,
    pub(crate) _pad_agx1: f32,
    pub(crate) _pad_agx2: f32,
    pub(crate) _pad_agx3: f32,
    pub agx_pipe_to_rendering_matrix: GpuMat3,
    pub agx_rendering_to_pipe_matrix: GpuMat3,
    pub(crate) _pad_cg1: f32,
    pub(crate) _pad_cg2: f32,
    pub(crate) _pad_cg3: f32,
    pub(crate) _pad_cg4: f32,
    pub color_grading_shadows: ColorGradeSettings,
    pub color_grading_midtones: ColorGradeSettings,
    pub color_grading_highlights: ColorGradeSettings,
    pub color_grading_global: ColorGradeSettings,
    pub color_grading_blending: f32,
    pub color_grading_balance: f32,
    pub(crate) _pad2: f32,
    pub(crate) _pad3: f32,
    pub color_calibration: ColorCalibrationSettings,
    pub color_balance_rgb: ColorBalanceRgbSettings,
    pub channel_mixer: ChannelMixerSettings,
    pub black_white_mixer: BlackWhiteMixerSettings,
    pub levels: LevelsSettings,
    pub hsl: [HslColor; 8],
    pub luma_curve: [Point; 16],
    pub red_curve: [Point; 16],
    pub green_curve: [Point; 16],
    pub blue_curve: [Point; 16],
    pub luma_curve_count: u32,
    pub red_curve_count: u32,
    pub green_curve_count: u32,
    pub blue_curve_count: u32,
    pub(crate) _pad_end1: f32,
    pub(crate) _pad_end2: f32,
    pub(crate) _pad_end3: f32,
    pub(crate) _pad_end4: f32,
    pub glow_amount: f32,
    pub halation_amount: f32,
    pub flare_amount: f32,
    pub sharpness_threshold: f32,
    /// Explicit Rust representation of WGSL's implicit 16-byte struct tail alignment.
    pub(crate) _pad_wgsl_tail1: f32,
    pub(crate) _pad_wgsl_tail2: f32,
    pub(crate) _pad_wgsl_tail3: f32,
}

#[derive(Serialize, Deserialize, Debug, Clone, Copy, Pod, Zeroable, Default)]
#[repr(C)]
pub struct MaskAdjustments {
    pub exposure: f32,
    pub brightness: f32,
    pub contrast: f32,
    pub highlights: f32,
    pub shadows: f32,
    pub whites: f32,
    pub blacks: f32,
    pub saturation: f32,
    pub temperature: f32,
    pub tint: f32,
    pub vibrance: f32,
    pub sharpness: f32,
    pub luma_noise_reduction: f32,
    pub color_noise_reduction: f32,
    pub clarity: f32,
    pub dehaze: f32,
    pub structure: f32,
    pub glow_amount: f32,
    pub halation_amount: f32,
    pub flare_amount: f32,
    pub sharpness_threshold: f32,
    pub hue: f32,
    pub blend_mode: f32,
    pub(crate) _pad_cg2: f32,
    pub color_grading_shadows: ColorGradeSettings,
    pub color_grading_midtones: ColorGradeSettings,
    pub color_grading_highlights: ColorGradeSettings,
    pub color_grading_global: ColorGradeSettings,
    pub color_grading_blending: f32,
    pub color_grading_balance: f32,
    pub(crate) _pad5: f32,
    pub(crate) _pad6: f32,
    pub hsl: [HslColor; 8],
    pub luma_curve: [Point; 16],
    pub red_curve: [Point; 16],
    pub green_curve: [Point; 16],
    pub blue_curve: [Point; 16],
    pub luma_curve_count: u32,
    pub red_curve_count: u32,
    pub green_curve_count: u32,
    pub blue_curve_count: u32,
    pub(crate) _pad_end4: f32,
    pub(crate) _pad_end5: f32,
    pub(crate) _pad_end6: f32,
    pub(crate) _pad_end7: f32,
}

pub const MAX_MASKS: usize = 32;

#[derive(Debug, Clone, Copy, Pod, Zeroable, Default)]
#[repr(C)]
pub struct AllAdjustments {
    pub global: GlobalAdjustments,
    pub mask_adjustments: [MaskAdjustments; MAX_MASKS],
    pub mask_count: u32,
    pub tile_offset_x: u32,
    pub tile_offset_y: u32,
    pub mask_atlas_cols: u32,
    pub blur_pass_flags: u32,
    pub(crate) _pad_blur_flags1: u32,
    pub(crate) _pad_blur_flags2: u32,
    pub(crate) _pad_blur_flags3: u32,
}
