use serde::Serialize;
use sha2::{Digest, Sha256};
use wgpu::util::{DeviceExt, TextureDataOrder};

use crate::app_state::AppState;
use crate::gpu_processing::{get_or_init_gpu_context, read_texture_data_roi};

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
    pub readback_bytes: u32,
    pub runtime_status: String,
    pub texture_format: String,
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
    let readback = read_texture_data_roi(
        &context.device,
        &context.queue,
        &texture,
        wgpu::Origin3d::ZERO,
        size,
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
        readback_bytes: readback.len() as u32,
        runtime_status: "validation_harness_gpu_texture_readback_probe".to_string(),
        texture_format: "rgba8unorm".to_string(),
        validation_mode: "wgpu_copy_texture_to_buffer_readback_probe".to_string(),
        width,
    })
}
