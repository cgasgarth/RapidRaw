#![cfg_attr(not(feature = "ai"), allow(dead_code))]

#[cfg(not(all(target_os = "windows", target_arch = "aarch64")))]
use mimalloc::MiMalloc;

#[cfg(not(all(target_os = "windows", target_arch = "aarch64")))]
#[global_allocator]
static GLOBAL: MiMalloc = MiMalloc;

mod adjustments;
mod ai;
mod album_management;
mod android_integration;
mod app;
mod app_settings;
mod app_state;
mod color;
mod community_presets;
mod computational;
mod detail;
mod editor;
mod events;
mod export;
mod geometry;
mod gpu;
mod io;
mod layers;
mod library;
mod merge;
mod negative_lab_profiles;
mod preset_converter;
mod presets;
mod proofs;
#[cfg(all(feature = "validation-harness", unix))]
mod qa_control;
mod raw;
mod render;
mod tagging;
pub mod tone;
#[cfg(test)]
mod validation;
mod window_customizer;

pub(crate) use color::*;
pub use community_presets::CommunityPreset;
pub(crate) use computational::*;
pub use computational::{deblur_cpu_reference, denoise_cpu_reference};
pub(crate) use gpu::*;
pub(crate) use io::*;
pub(crate) use library::*;
pub(crate) use merge::*;
pub(crate) use raw::*;
pub use render::resample::{
    AxisPlan, AxisSpan, CancellationProbe, ResampleCacheMetrics, ResampleError, ResampleKey,
    ResamplePlan, ResampledImage, cache_metrics as resample_cache_metrics, downscale_f32_image_cow,
};
pub(crate) use render::*;

pub use adjustment_utils::*;
pub use android_integration::*;
pub use app::commands::wgpu_presentation::WgpuTransformPayload;
pub use app::runtime::register_exit_handler;
pub use app_settings::*;
pub use app_state::*;
pub use editor::preview_geometry_service::{
    PreviewGeometryPipeline, PreviewGeometryReceipt, PreviewGeometryRequest, PreviewGeometryResult,
    PreviewGeometryService,
};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    app::runtime::run();
}
