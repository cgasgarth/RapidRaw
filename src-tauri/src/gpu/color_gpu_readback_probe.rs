use serde::Serialize;
use sha2::{Digest, Sha256};
use wgpu::util::{DeviceExt, TextureDataOrder};

use crate::app_state::AppState;
use crate::gpu_processing::get_or_init_gpu_context;
use crate::gpu_readback::read_texture_data_roi_with_bytes_per_pixel;

const EXPECTED_RGBA: [u8; 16] = [
    18, 64, 128, 255, 42, 96, 180, 255, 88, 120, 210, 255, 132, 160, 240, 255,
];

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ColorGpuReadbackProbeReport {
    pub byte_hash: String,
    pub does_not_prove: Vec<String>,
    pub height: u32,
    pub issue: u32,
    pub max_byte_delta: u8,
    pub pixel_count: u32,
    pub proof_status: String,
    pub readback_bytes: u32,
    pub runtime_status: String,
    pub texture_format: String,
    pub validation_scope: String,
    pub validation_mode: String,
    pub width: u32,
}

#[tauri::command]
pub async fn run_color_gpu_readback_probe(
    state: tauri::State<'_, AppState>,
    app_handle: tauri::AppHandle,
) -> Result<ColorGpuReadbackProbeReport, String> {
    let context = get_or_init_gpu_context(&state, &app_handle)?;
    run_color_gpu_readback_probe_with_context(&context)
}

fn run_color_gpu_readback_probe_with_context(
    context: &crate::image_processing::GpuContext,
) -> Result<ColorGpuReadbackProbeReport, String> {
    let width = 2;
    let height = 2;
    let size = wgpu::Extent3d {
        width,
        height,
        depth_or_array_layers: 1,
    };
    let texture = context.device.create_texture_with_data(
        &context.queue,
        &wgpu::TextureDescriptor {
            label: Some("Color GPU Readback Probe Texture"),
            size,
            mip_level_count: 1,
            sample_count: 1,
            dimension: wgpu::TextureDimension::D2,
            format: wgpu::TextureFormat::Rgba8Unorm,
            usage: wgpu::TextureUsages::COPY_DST | wgpu::TextureUsages::COPY_SRC,
            view_formats: &[],
        },
        TextureDataOrder::MipMajor,
        &EXPECTED_RGBA,
    );
    let readback = read_texture_data_roi_with_bytes_per_pixel(
        &context.device,
        &context.queue,
        &texture,
        wgpu::Origin3d::ZERO,
        size,
        4,
    )?;

    if readback.len() != EXPECTED_RGBA.len() {
        return Err(format!(
            "Expected {} readback byte(s), got {}.",
            EXPECTED_RGBA.len(),
            readback.len()
        ));
    }

    let max_byte_delta = readback
        .iter()
        .zip(EXPECTED_RGBA.iter())
        .map(|(actual, expected)| actual.abs_diff(*expected))
        .max()
        .unwrap_or(0);
    if max_byte_delta != 0 {
        return Err(format!(
            "GPU readback max byte delta was {max_byte_delta}, expected 0."
        ));
    }

    Ok(ColorGpuReadbackProbeReport {
        byte_hash: format!("sha256:{}", hex::encode(Sha256::digest(&readback))),
        does_not_prove: vec![
            "full_preview_pipeline_parity".to_string(),
            "full_export_pipeline_parity".to_string(),
            "raw_file_color_management_parity".to_string(),
            "shader_function_parity".to_string(),
        ],
        height,
        issue: 2326,
        max_byte_delta,
        pixel_count: width * height,
        proof_status: "runtime_apply_capable".to_string(),
        readback_bytes: readback.len() as u32,
        runtime_status: "validation_harness_gpu_texture_readback_probe".to_string(),
        texture_format: "rgba8unorm".to_string(),
        validation_scope: "gpu_texture_upload_and_readback_probe_only".to_string(),
        validation_mode: "wgpu_copy_texture_to_buffer_readback_probe".to_string(),
        width,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::image_processing::GpuContext;
    use std::sync::Arc;

    const RUN_ENV: &str = "RAWENGINE_RUN_GPU_READBACK_PROBE";
    const PROOF_PATH_ENV: &str = "RAWENGINE_GPU_READBACK_PROOF_PATH";

    fn build_compute_context() -> Result<GpuContext, String> {
        let instance =
            wgpu::Instance::new(wgpu::InstanceDescriptor::new_without_display_handle_from_env());
        let adapter = pollster::block_on(instance.request_adapter(&wgpu::RequestAdapterOptions {
            power_preference: wgpu::PowerPreference::HighPerformance,
            compatible_surface: None,
            ..Default::default()
        }))
        .map_err(|error| format!("Failed to find a wgpu adapter: {}", error))?;

        let mut required_features = wgpu::Features::empty();
        if adapter
            .features()
            .contains(wgpu::Features::TEXTURE_ADAPTER_SPECIFIC_FORMAT_FEATURES)
        {
            required_features |= wgpu::Features::TEXTURE_ADAPTER_SPECIFIC_FORMAT_FEATURES;
        }
        let limits = adapter.limits();
        let (device, queue) = pollster::block_on(adapter.request_device(&wgpu::DeviceDescriptor {
            label: Some("Color GPU Readback Probe Test Device"),
            required_features,
            required_limits: limits.clone(),
            experimental_features: wgpu::ExperimentalFeatures::default(),
            memory_hints: wgpu::MemoryHints::Performance,
            trace: wgpu::Trace::Off,
        }))
        .map_err(|error| error.to_string())?;

        let device = Arc::new(device);
        let queue = Arc::new(queue);
        Ok(GpuContext {
            device: Arc::clone(&device),
            queue: Arc::clone(&queue),
            limits,
            presentation: Arc::new(crate::gpu_display::WgpuPresentationScheduler::new(
                None, device, queue,
            )),
        })
    }

    fn write_runtime_proof(report: &ColorGpuReadbackProbeReport) -> Result<(), String> {
        let Ok(path) = std::env::var(PROOF_PATH_ENV) else {
            return Ok(());
        };
        let path = std::path::PathBuf::from(path);
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).map_err(|error| error.to_string())?;
        }
        let report_json =
            serde_json::to_string_pretty(report).map_err(|error| error.to_string())?;
        std::fs::write(path, format!("{report_json}\n")).map_err(|error| error.to_string())
    }

    #[test]
    fn runtime_smoke_reads_back_gpu_texture_when_enabled() {
        if std::env::var(RUN_ENV).ok().as_deref() != Some("1") {
            return;
        }

        let context = build_compute_context().expect("GPU compute context should initialize");
        let report = run_color_gpu_readback_probe_with_context(&context)
            .expect("GPU readback probe should round-trip bytes");
        assert_eq!(
            report.byte_hash,
            "sha256:be2ed0f28ed5d492dfd4f03c6f6f0ca559819d57f38a474448e57d8da41dc572"
        );
        assert_eq!(report.max_byte_delta, 0);
        assert_eq!(report.proof_status, "runtime_apply_capable");
        write_runtime_proof(&report).expect("runtime proof should be written");
    }
}
