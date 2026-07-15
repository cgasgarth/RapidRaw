use std::borrow::Cow;
use std::fs;
use std::sync::Arc;

use image::{DynamicImage, GenericImageView, ImageBuffer, Luma};
use serde_json::Value;
use tauri::ipc::Response;

use crate::app_settings::load_settings_or_default;
use crate::cache_utils::calculate_transform_hash;
use crate::file_management::{parse_virtual_path, read_file_mapped};
use crate::film_look_render::normalize_film_look_adjustments_for_render;
use crate::formats::is_raw_file;
use crate::image_loader::load_and_composite;
use crate::image_processing::{
    RenderRequest, apply_geometry_warp, get_or_init_gpu_context, process_and_get_dynamic_image,
    resolve_tonemapper_override,
};
use crate::mask_generation::{MaskDefinition, generate_mask_bitmap};
use crate::{
    AppState, apply_all_transformations, compile_consumer_render_plan, encode_jpeg_response,
    get_or_load_lut,
};

#[tauri::command]
pub(crate) fn generate_preview_for_path(
    path: String,
    js_adjustments: Value,
    target_resolution: Option<u32>,
    jpeg_quality: Option<u8>,
    state: tauri::State<AppState>,
    app_handle: tauri::AppHandle,
) -> Result<Response, String> {
    let context = get_or_init_gpu_context(&state, &app_handle)?;
    let (source_path, _) = parse_virtual_path(&path);
    let source_path_str = source_path.to_string_lossy().to_string();
    let is_raw = is_raw_file(&source_path_str);
    let settings = load_settings_or_default(&app_handle);

    let base_image = match read_file_mapped(&source_path) {
        Ok(mmap) => load_and_composite(
            &mmap,
            &source_path_str,
            &js_adjustments,
            false,
            &settings,
            None,
        )
        .map_err(|error| error.to_string())?,
        Err(error) => {
            log::warn!(
                "Failed to memory-map file '{}': {}. Falling back to standard read.",
                source_path_str,
                error
            );
            let bytes = fs::read(&source_path).map_err(|io_error| io_error.to_string())?;
            load_and_composite(
                &bytes,
                &source_path_str,
                &js_adjustments,
                false,
                &settings,
                None,
            )
            .map_err(|error| error.to_string())?
        }
    };

    let mask_definitions: Vec<MaskDefinition> = js_adjustments
        .get("masks")
        .and_then(|masks| serde_json::from_value(masks.clone()).ok())
        .unwrap_or_default();
    let warped_image = resolve_path_warped_image(&base_image, &js_adjustments, &mask_definitions);
    let (transformed_image, unscaled_crop_offset) =
        apply_all_transformations(Cow::Borrowed(&base_image), &js_adjustments);
    let (image_width, image_height) = transformed_image.dimensions();
    let mask_bitmaps: Vec<ImageBuffer<Luma<u8>, Vec<u8>>> = mask_definitions
        .iter()
        .filter_map(|definition| {
            generate_mask_bitmap(
                definition,
                image_width,
                image_height,
                1.0,
                unscaled_crop_offset,
                warped_image.as_deref(),
            )
        })
        .collect();

    let tonemapper_override = resolve_tonemapper_override(&settings, is_raw);
    let render_adjustments = normalize_film_look_adjustments_for_render(&js_adjustments);
    let lut = render_adjustments["lutPath"]
        .as_str()
        .and_then(|path| get_or_load_lut(&state, path).ok());
    let render_plan = compile_consumer_render_plan(
        render_adjustments.as_ref(),
        &source_path_str,
        is_raw,
        tonemapper_override,
        lut,
    )?;
    let pre_gpu_stage_hash = calculate_transform_hash(render_adjustments.as_ref());
    let source_revision = crate::render::artifact_identity::stable_hash(&(
        crate::gpu_processing::PreGpuImageIdentity::source_revision(&source_path_str),
        crate::image_loader::raw_processing_profile_key(&settings),
    ));
    let detail_stage = crate::render_pipeline::apply_pre_gpu_detail_stages(
        transformed_image.as_ref(),
        pre_gpu_stage_hash,
        render_adjustments.as_ref(),
        is_raw,
    );
    let mut gpu_adjustments = render_plan.adjustments;
    crate::render_pipeline::suppress_legacy_global_denoise(&mut gpu_adjustments);
    crate::render_pipeline::suppress_legacy_global_detail(
        &mut gpu_adjustments,
        detail_stage.owns_legacy_global_detail,
    );
    let final_image = process_and_get_dynamic_image(
        &context,
        &state,
        detail_stage.image.as_ref(),
        crate::gpu_processing::PreGpuImageIdentity::for_stage(
            detail_stage.image.as_ref(),
            source_revision,
            detail_stage.render_hash,
            detail_stage.render_hash,
        ),
        RenderRequest {
            adjustments: gpu_adjustments,
            mask_bitmaps: &mask_bitmaps,
            lut: render_plan.lut.clone(),
            roi: None,
            edit_graph: crate::gpu_processing::EditGraphExecutionAuthority::Compiled(Arc::clone(
                &render_plan.edit_graph,
            )),
        },
        "generate_preview_for_path",
    )?;
    let preview_image = match target_resolution {
        Some(max_edge) => final_image.resize(
            max_edge.clamp(256, 4096),
            max_edge.clamp(256, 4096),
            image::imageops::FilterType::Lanczos3,
        ),
        None => final_image,
    };
    encode_jpeg_response(&preview_image, jpeg_quality.unwrap_or(92).clamp(50, 95))
}

fn resolve_path_warped_image(
    source: &DynamicImage,
    adjustments: &Value,
    masks: &[MaskDefinition],
) -> Option<Arc<DynamicImage>> {
    masks
        .iter()
        .any(MaskDefinition::requires_warped_image)
        .then(|| Arc::new(apply_geometry_warp(Cow::Borrowed(source), adjustments).into_owned()))
}

#[cfg(test)]
mod tests {
    use image::{Rgba, RgbaImage};

    use crate::mask_generation::{SubMask, SubMaskMode};

    use super::*;

    fn luminance_range_mask() -> MaskDefinition {
        MaskDefinition {
            id: "range".into(),
            name: "Range".into(),
            visible: true,
            invert: false,
            blend_mode: "normal".into(),
            opacity: 100.0,
            adjustments: serde_json::json!({}),
            sub_masks: vec![SubMask {
                id: "luma".into(),
                mask_type: "luminance_range".into(),
                visible: true,
                invert: false,
                opacity: 100.0,
                mode: SubMaskMode::Additive,
                parameters: serde_json::json!({
                    "minLuma": 0.2,
                    "maxLuma": 0.8,
                    "feather": 0.1
                }),
            }],
        }
    }

    #[test]
    fn path_preview_range_masks_are_derived_from_the_requested_source() {
        let mask = luminance_range_mask();
        let dark = DynamicImage::ImageRgba8(RgbaImage::from_pixel(3, 1, Rgba([8, 8, 8, 255])));
        let midtone =
            DynamicImage::ImageRgba8(RgbaImage::from_pixel(3, 1, Rgba([128, 128, 128, 255])));

        let dark_warp =
            resolve_path_warped_image(&dark, &serde_json::json!({}), std::slice::from_ref(&mask))
                .unwrap();
        let midtone_warp = resolve_path_warped_image(
            &midtone,
            &serde_json::json!({}),
            std::slice::from_ref(&mask),
        )
        .unwrap();
        let dark_mask =
            generate_mask_bitmap(&mask, 3, 1, 1.0, (0.0, 0.0), Some(&dark_warp)).unwrap();
        let midtone_mask =
            generate_mask_bitmap(&mask, 3, 1, 1.0, (0.0, 0.0), Some(&midtone_warp)).unwrap();

        assert_eq!(dark_mask.get_pixel(1, 0)[0], 0);
        assert_eq!(midtone_mask.get_pixel(1, 0)[0], 255);
    }

    #[test]
    fn path_preview_skips_warp_work_for_geometry_only_masks() {
        let mut mask = luminance_range_mask();
        mask.sub_masks[0].mask_type = "all".into();
        let source = DynamicImage::new_rgba8(4, 3);

        assert!(
            resolve_path_warped_image(&source, &serde_json::json!({}), std::slice::from_ref(&mask))
                .is_none()
        );
    }
}
