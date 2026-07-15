use std::{borrow::Cow, collections::HashMap, fs, io::Cursor, sync::Arc};

use image::codecs::jpeg::JpegEncoder;
use image::{DynamicImage, GenericImageView, ImageBuffer, Luma, RgbImage};
use tauri::ipc::Response;

use crate::{
    AppState, CommunityPreset, Crop, MaskDefinition, RenderRequest, adjustment_fields,
    calculate_transform_hash, compile_consumer_render_plan, downscale_f32_image,
    encode_jpeg_response, generate_mask_bitmap, generate_transformed_preview,
    get_cached_or_generate_mask, get_or_init_gpu_context, get_or_load_lut, is_raw_file,
    load_settings_or_default, normalize_film_look_adjustments_for_render, parse_virtual_path,
    process_and_get_dynamic_image, render_pipeline, resolve_tonemapper_override_from_handle,
};

fn scale_crop_adjustment(adjustments: &serde_json::Value, scale: f32) -> serde_json::Value {
    let mut scaled = adjustments.clone();
    if let Some(crop_value) = scaled.get_mut(adjustment_fields::CROP)
        && let Ok(crop) = serde_json::from_value::<Crop>(crop_value.clone())
    {
        *crop_value = serde_json::to_value(Crop {
            x: crop.x * scale as f64,
            y: crop.y * scale as f64,
            width: crop.width * scale as f64,
            height: crop.height * scale as f64,
        })
        .unwrap_or(serde_json::Value::Null);
    }
    scaled
}

fn compose_community_tiles(mut tiles: Vec<RgbImage>, tile_dimension: u32) -> Option<RgbImage> {
    match tiles.len() {
        1 => tiles.pop(),
        2 => {
            let mut canvas = RgbImage::new(tile_dimension * 2, tile_dimension);
            image::imageops::overlay(&mut canvas, &tiles[0], 0, 0);
            image::imageops::overlay(&mut canvas, &tiles[1], tile_dimension as i64, 0);
            Some(canvas)
        }
        4 => {
            let mut canvas = RgbImage::new(tile_dimension * 2, tile_dimension * 2);
            image::imageops::overlay(&mut canvas, &tiles[0], 0, 0);
            image::imageops::overlay(&mut canvas, &tiles[1], tile_dimension as i64, 0);
            image::imageops::overlay(&mut canvas, &tiles[2], 0, tile_dimension as i64);
            image::imageops::overlay(
                &mut canvas,
                &tiles[3],
                tile_dimension as i64,
                tile_dimension as i64,
            );
            Some(canvas)
        }
        _ => None,
    }
}

#[tauri::command]
pub(crate) fn generate_preset_preview(
    js_adjustments: serde_json::Value,
    state: tauri::State<AppState>,
    app_handle: tauri::AppHandle,
) -> Result<Response, String> {
    let context = get_or_init_gpu_context(&state, &app_handle)?;

    let loaded_image = state
        .original_image
        .lock()
        .unwrap()
        .clone()
        .ok_or("No original image loaded for preset preview")?;
    let is_raw = loaded_image.is_raw;

    const PRESET_PREVIEW_DIM: u32 = 400;

    let (preview_image, scale_for_gpu, unscaled_crop_offset) =
        generate_transformed_preview(&state, &loaded_image, &js_adjustments, PRESET_PREVIEW_DIM)?;

    let (img_w, img_h) = preview_image.dimensions();

    let mask_definitions: Vec<MaskDefinition> = js_adjustments
        .get("masks")
        .and_then(|m| serde_json::from_value(m.clone()).ok())
        .unwrap_or_default();

    let scaled_crop_offset = (
        unscaled_crop_offset.0 * scale_for_gpu,
        unscaled_crop_offset.1 * scale_for_gpu,
    );

    let mask_bitmaps: Vec<ImageBuffer<Luma<u8>, Vec<u8>>> = mask_definitions
        .iter()
        .filter_map(|def| {
            get_cached_or_generate_mask(
                &state,
                def,
                img_w,
                img_h,
                scale_for_gpu,
                scaled_crop_offset,
                &js_adjustments,
            )
        })
        .collect();

    let tm_override = resolve_tonemapper_override_from_handle(&app_handle, is_raw);
    let render_adjustments = normalize_film_look_adjustments_for_render(&js_adjustments);
    let lut_path = render_adjustments["lutPath"].as_str();
    let lut = lut_path.and_then(|p| get_or_load_lut(&state, p).ok());
    let render_plan = compile_consumer_render_plan(
        render_adjustments.as_ref(),
        &loaded_image.path,
        is_raw,
        tm_override,
        lut,
    )?;
    let detail_stage = render_pipeline::apply_pre_gpu_detail_stages(
        &preview_image,
        calculate_transform_hash(render_adjustments.as_ref()),
        render_adjustments.as_ref(),
        is_raw,
    );
    let mut gpu_adjustments = render_plan.adjustments;
    render_pipeline::suppress_legacy_global_denoise(&mut gpu_adjustments);
    render_pipeline::suppress_legacy_global_detail(
        &mut gpu_adjustments,
        detail_stage.owns_legacy_global_detail,
    );
    let processed_image = process_and_get_dynamic_image(
        &context,
        &state,
        detail_stage.image.as_ref(),
        crate::gpu_processing::PreGpuImageIdentity::for_stage(
            detail_stage.image.as_ref(),
            loaded_image.artifact_source.source_fingerprint(),
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
        "generate_preset_preview",
    )?;

    encode_jpeg_response(&processed_image, 80)
}

#[tauri::command]
pub(crate) async fn generate_all_community_previews(
    image_paths: Vec<String>,
    presets: Vec<CommunityPreset>,
    state: tauri::State<'_, AppState>,
    app_handle: tauri::AppHandle,
) -> Result<HashMap<String, Vec<u8>>, String> {
    let context = get_or_init_gpu_context(&state, &app_handle)?;
    let mut results: HashMap<String, Vec<u8>> = HashMap::new();

    const TILE_DIM: u32 = 360;
    const PROCESSING_DIM: u32 = TILE_DIM * 2;

    let settings = load_settings_or_default(&app_handle);

    let mut base_thumbnails: Vec<(DynamicImage, bool, f32, u64)> = Vec::new();
    for image_path in image_paths.iter() {
        let (source_path, _) = parse_virtual_path(image_path);
        let source_path_str = source_path.to_string_lossy().to_string();
        let image_bytes = fs::read(&source_path).map_err(|e| e.to_string())?;
        let original_image = crate::image_loader::load_base_image_from_bytes(
            &image_bytes,
            &source_path_str,
            true,
            &settings,
            None,
        )
        .map_err(|e| e.to_string())?;

        let is_raw = is_raw_file(&source_path_str);
        let (orig_w, orig_h) = original_image.dimensions();
        let (base_image, base_scale) = if orig_w > PROCESSING_DIM || orig_h > PROCESSING_DIM {
            let downscaled = downscale_f32_image(&original_image, PROCESSING_DIM, PROCESSING_DIM);
            let scale = downscaled.width() as f32 / orig_w as f32;
            (downscaled, scale)
        } else {
            (original_image, 1.0)
        };

        base_thumbnails.push((
            base_image,
            is_raw,
            base_scale,
            crate::render::artifact_identity::stable_hash(&(
                crate::gpu_processing::PreGpuImageIdentity::source_revision(image_path),
                crate::image_loader::raw_processing_profile_key(&settings),
            )),
        ));
    }

    for preset in presets.iter() {
        let mut processed_tiles: Vec<RgbImage> = Vec::new();
        let js_adjustments = &preset.adjustments;

        for (base_image, is_raw, base_scale, source_revision) in &base_thumbnails {
            let scaled_adjustments = scale_crop_adjustment(js_adjustments, *base_scale);

            let (transformed_image, _scaled_crop_offset) =
                crate::apply_all_transformations(Cow::Borrowed(base_image), &scaled_adjustments);
            let (img_w, img_h) = transformed_image.dimensions();

            let mask_definitions: Vec<MaskDefinition> = scaled_adjustments
                .get("masks")
                .and_then(|m| serde_json::from_value(m.clone()).ok())
                .unwrap_or_default();

            let unscaled_crop_offset = js_adjustments
                .get(adjustment_fields::CROP)
                .and_then(|c| serde_json::from_value::<Crop>(c.clone()).ok())
                .map_or((0.0, 0.0), |c| (c.x as f32, c.y as f32));
            let actual_scaled_crop_offset = (
                unscaled_crop_offset.0 * base_scale,
                unscaled_crop_offset.1 * base_scale,
            );

            let mask_bitmaps: Vec<ImageBuffer<Luma<u8>, Vec<u8>>> = mask_definitions
                .iter()
                .filter_map(|def| {
                    generate_mask_bitmap(
                        def,
                        img_w,
                        img_h,
                        *base_scale,
                        actual_scaled_crop_offset,
                        None,
                    )
                })
                .collect();

            let tm_override = resolve_tonemapper_override_from_handle(&app_handle, *is_raw);
            let render_adjustments =
                normalize_film_look_adjustments_for_render(&scaled_adjustments);
            let lut_path = render_adjustments["lutPath"].as_str();
            let lut = lut_path.and_then(|p| get_or_load_lut(&state, p).ok());
            let render_plan = compile_consumer_render_plan(
                render_adjustments.as_ref(),
                &preset.name,
                *is_raw,
                tm_override,
                lut,
            )?;
            let pre_gpu_revision = calculate_transform_hash(&scaled_adjustments);

            let processed_image_dynamic = crate::image_processing::process_and_get_dynamic_image(
                &context,
                &state,
                transformed_image.as_ref(),
                crate::gpu_processing::PreGpuImageIdentity::for_stage(
                    transformed_image.as_ref(),
                    *source_revision,
                    pre_gpu_revision,
                    pre_gpu_revision,
                ),
                RenderRequest {
                    adjustments: render_plan.adjustments,
                    mask_bitmaps: &mask_bitmaps,
                    lut: render_plan.lut.clone(),
                    roi: None,
                    edit_graph: crate::gpu_processing::EditGraphExecutionAuthority::Compiled(
                        Arc::clone(&render_plan.edit_graph),
                    ),
                },
                "generate_all_community_previews",
            )?;

            let processed_image = processed_image_dynamic.to_rgb8();

            let (proc_w, proc_h) = processed_image.dimensions();
            let size = proc_w.min(proc_h);
            let cropped_processed_image = image::imageops::crop_imm(
                &processed_image,
                (proc_w - size) / 2,
                (proc_h - size) / 2,
                size,
                size,
            )
            .to_image();

            let final_tile = image::imageops::resize(
                &cropped_processed_image,
                TILE_DIM,
                TILE_DIM,
                image::imageops::FilterType::Lanczos3,
            );
            processed_tiles.push(final_tile);
        }

        let Some(final_image_buffer) = compose_community_tiles(processed_tiles, TILE_DIM) else {
            continue;
        };

        let mut buf = Cursor::new(Vec::new());
        if final_image_buffer
            .write_with_encoder(JpegEncoder::new_with_quality(&mut buf, 75))
            .is_ok()
        {
            results.insert(preset.name.clone(), buf.into_inner());
        }
    }

    Ok(results)
}

#[cfg(test)]
mod tests {
    use image::{Rgb, RgbImage};

    use super::{compose_community_tiles, scale_crop_adjustment};
    use crate::{Crop, adjustment_fields};

    #[test]
    fn crop_geometry_scales_with_the_thumbnail() {
        let adjustments = serde_json::json!({
            adjustment_fields::CROP: Crop {
                x: 10.0,
                y: 20.0,
                width: 300.0,
                height: 200.0,
            },
            "exposure": 0.5,
        });
        let scaled = scale_crop_adjustment(&adjustments, 0.25);
        let crop: Crop = serde_json::from_value(scaled[adjustment_fields::CROP].clone()).unwrap();
        assert_eq!(
            (crop.x, crop.y, crop.width, crop.height),
            (2.5, 5.0, 75.0, 50.0)
        );
        assert_eq!(scaled["exposure"], 0.5);
    }

    #[test]
    fn community_four_tile_layout_preserves_source_order() {
        let colors = [
            Rgb([255, 0, 0]),
            Rgb([0, 255, 0]),
            Rgb([0, 0, 255]),
            Rgb([255, 255, 0]),
        ];
        let tiles = colors
            .iter()
            .map(|color| RgbImage::from_pixel(2, 2, *color))
            .collect();
        let composed = compose_community_tiles(tiles, 2).unwrap();
        assert_eq!(composed.dimensions(), (4, 4));
        assert_eq!(*composed.get_pixel(0, 0), colors[0]);
        assert_eq!(*composed.get_pixel(2, 0), colors[1]);
        assert_eq!(*composed.get_pixel(0, 2), colors[2]);
        assert_eq!(*composed.get_pixel(2, 2), colors[3]);
    }

    #[test]
    fn community_layout_rejects_unsupported_tile_counts() {
        let tile = RgbImage::new(2, 2);
        assert!(compose_community_tiles(Vec::new(), 2).is_none());
        assert!(compose_community_tiles(vec![tile.clone(), tile.clone(), tile], 2).is_none());
    }
}
