use std::borrow::Cow;
use std::collections::hash_map::DefaultHasher;
use std::hash::{Hash, Hasher};
use std::io::Cursor;
use std::time::Instant;

use base64::{Engine as _, engine::general_purpose};
use image::{
    DynamicImage, GenericImageView, GrayImage, ImageFormat, Rgb, RgbImage, Rgba, RgbaImage,
};
use serde_json::Value;

use super::ai_connector;
use crate::adjustment_fields::GEOMETRY_KEYS;
use crate::ai::ai_processing::{
    self, AiDepthMaskParameters, AiForegroundMaskParameters, AiSkyMaskParameters,
    AiSubjectMaskParameters, CachedDepthMap, ImageEmbeddings, acquire_ort_model,
    generate_image_embeddings, run_depth_anything_model, run_sam_decoder, run_sky_seg_model,
    run_u2netp_model,
};
use crate::ai::model_registry::{AiModelId, AiModelRegistryReport};
use crate::app_settings::load_settings_or_default;
use crate::app_state::AppState;
use crate::formats::png_data_url;
use crate::image_loader::composite_patches_on_image;
use crate::image_processing::apply_unwarp_geometry;
use crate::mask_generation::{AiPatchDefinition, MaskDefinition, generate_mask_bitmap};
use crate::{
    get_cached_full_warped_image, get_full_image_for_processing, resolve_warped_image_for_masks,
};

fn encode_to_base64_png(image: &GrayImage) -> Result<String, String> {
    let mut buf = Cursor::new(Vec::new());
    image
        .write_to(&mut buf, ImageFormat::Png)
        .map_err(|e| e.to_string())?;
    let base64_str = general_purpose::STANDARD.encode(buf.get_ref());
    Ok(png_data_url(base64_str))
}

#[tauri::command]
pub fn get_ai_model_registry_report(state: tauri::State<'_, AppState>) -> AiModelRegistryReport {
    state.ai_model_registry.report()
}

#[tauri::command]
pub fn cancel_ai_model_load(id: AiModelId, state: tauri::State<'_, AppState>) -> bool {
    state.ai_model_registry.cancel_load(id)
}

#[tauri::command]
pub fn evict_ai_model_session(id: AiModelId, state: tauri::State<'_, AppState>) -> bool {
    state.ai_model_registry.evict_idle(id)
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiObjectMaskProposal {
    pub mask_data_base64: String,
    pub provider_id: String,
    pub model_id: String,
    pub image_width: u32,
    pub image_height: u32,
    pub prompt_count: usize,
    pub prompt_kind: String,
    pub embedding_latency_ms: Option<f64>,
    pub decoder_latency_ms: f64,
    pub click_to_mask_latency_ms: f64,
}

struct SamPromptGeometry {
    rotation: f32,
    flip_horizontal: bool,
    flip_vertical: bool,
    orientation_steps: u8,
    image_width: u32,
    image_height: u32,
}

fn sam_path_hash(path: &str, js_adjustments: &Value) -> String {
    let mut hasher = blake3::Hasher::new();
    hasher.update(b"sam-vit-b-01ec64:preprocess-v1");
    hasher.update(path.as_bytes());
    let mut geo_hasher = DefaultHasher::new();
    for key in GEOMETRY_KEYS {
        if let Some(val) = js_adjustments.get(key) {
            key.hash(&mut geo_hasher);
            val.to_string().hash(&mut geo_hasher);
        }
    }
    hasher.update(&geo_hasher.finish().to_le_bytes());
    hasher.finalize().to_hex().to_string()
}

fn unwarp_sam_prompt(
    start_point: (f64, f64),
    end_point: (f64, f64),
    geometry: &SamPromptGeometry,
) -> ((f64, f64), (f64, f64)) {
    let (coarse_rotated_w, coarse_rotated_h) = if geometry.orientation_steps % 2 == 1 {
        (geometry.image_height as f64, geometry.image_width as f64)
    } else {
        (geometry.image_width as f64, geometry.image_height as f64)
    };

    let center = (coarse_rotated_w / 2.0, coarse_rotated_h / 2.0);
    let p1 = start_point;
    let p2 = (start_point.0, end_point.1);
    let p3 = end_point;
    let p4 = (end_point.0, start_point.1);

    let angle_rad = (geometry.rotation as f64).to_radians();
    let cos_a = angle_rad.cos();
    let sin_a = angle_rad.sin();

    let unrotate = |p: (f64, f64)| {
        let px = p.0 - center.0;
        let py = p.1 - center.1;
        let new_px = px * cos_a + py * sin_a + center.0;
        let new_py = -px * sin_a + py * cos_a + center.1;
        (new_px, new_py)
    };

    let unflip = |p: (f64, f64)| {
        let mut new_px = p.0;
        let mut new_py = p.1;
        if geometry.flip_horizontal {
            new_px = coarse_rotated_w - p.0;
        }
        if geometry.flip_vertical {
            new_py = coarse_rotated_h - p.1;
        }
        (new_px, new_py)
    };

    let un_coarse_rotate = |p: (f64, f64)| -> (f64, f64) {
        match geometry.orientation_steps {
            0 => p,
            1 => (p.1, geometry.image_height as f64 - p.0),
            2 => (
                geometry.image_width as f64 - p.0,
                geometry.image_height as f64 - p.1,
            ),
            3 => (geometry.image_width as f64 - p.1, p.0),
            _ => p,
        }
    };

    let transformed = [p1, p2, p3, p4].map(|point| un_coarse_rotate(unflip(unrotate(point))));
    let min_x = transformed
        .iter()
        .map(|point| point.0)
        .fold(f64::INFINITY, f64::min);
    let min_y = transformed
        .iter()
        .map(|point| point.1)
        .fold(f64::INFINITY, f64::min);
    let max_x = transformed
        .iter()
        .map(|point| point.0)
        .fold(f64::NEG_INFINITY, f64::max);
    let max_y = transformed
        .iter()
        .map(|point| point.1)
        .fold(f64::NEG_INFINITY, f64::max);

    ((min_x, min_y), (max_x, max_y))
}

fn get_cached_or_generate_sam_embeddings(
    state: &tauri::State<'_, AppState>,
    sam_encoder: &std::sync::Mutex<ort::session::Session>,
    js_adjustments: &Value,
    path_hash: &str,
) -> Result<(ImageEmbeddings, Option<f64>), String> {
    let mut embeddings_cache = state.ai_embeddings.lock().unwrap();

    if let Some(cached_embeddings) = embeddings_cache.as_ref()
        && cached_embeddings.path_hash == path_hash
    {
        return Ok((cached_embeddings.clone(), None));
    }

    let embedding_start = Instant::now();
    let warped_image = get_cached_full_warped_image(state, js_adjustments)?;
    let mut new_embeddings =
        generate_image_embeddings(warped_image.as_ref(), sam_encoder).map_err(|e| e.to_string())?;
    new_embeddings.path_hash = path_hash.to_string();
    let embedding_latency_ms = embedding_start.elapsed().as_secs_f64() * 1000.0;
    *embeddings_cache = Some(new_embeddings.clone());
    Ok((new_embeddings, Some(embedding_latency_ms)))
}

#[tauri::command]
pub async fn generate_ai_foreground_mask(
    js_adjustments: serde_json::Value,
    rotation: f32,
    flip_horizontal: bool,
    flip_vertical: bool,
    orientation_steps: u8,
    state: tauri::State<'_, AppState>,
    app_handle: tauri::AppHandle,
) -> Result<AiForegroundMaskParameters, String> {
    let model = acquire_ort_model(
        &app_handle,
        &state.ai_model_registry,
        AiModelId::ForegroundU2Net,
    )
    .await
    .map_err(|e| e.to_string())?;
    let session = model.ort()?;

    let warped_image = get_cached_full_warped_image(&state, &js_adjustments)?;

    let full_mask_image =
        run_u2netp_model(warped_image.as_ref(), &session).map_err(|e| e.to_string())?;
    let base64_data = encode_to_base64_png(&full_mask_image)?;

    Ok(AiForegroundMaskParameters {
        mask_data_base64: Some(base64_data),
        rotation: Some(rotation),
        flip_horizontal: Some(flip_horizontal),
        flip_vertical: Some(flip_vertical),
        orientation_steps: Some(orientation_steps),
        ..Default::default()
    })
}

#[tauri::command]
pub async fn generate_ai_sky_mask(
    js_adjustments: serde_json::Value,
    rotation: f32,
    flip_horizontal: bool,
    flip_vertical: bool,
    orientation_steps: u8,
    state: tauri::State<'_, AppState>,
    app_handle: tauri::AppHandle,
) -> Result<AiSkyMaskParameters, String> {
    let model = acquire_ort_model(&app_handle, &state.ai_model_registry, AiModelId::SkyU2Net)
        .await
        .map_err(|e| e.to_string())?;
    let session = model.ort()?;

    let warped_image = get_cached_full_warped_image(&state, &js_adjustments)?;

    let full_mask_image =
        run_sky_seg_model(warped_image.as_ref(), &session).map_err(|e| e.to_string())?;
    let base64_data = encode_to_base64_png(&full_mask_image)?;

    Ok(AiSkyMaskParameters {
        mask_data_base64: Some(base64_data),
        rotation: Some(rotation),
        flip_horizontal: Some(flip_horizontal),
        flip_vertical: Some(flip_vertical),
        orientation_steps: Some(orientation_steps),
    })
}

#[tauri::command]
pub async fn generate_ai_whole_person_mask(
    js_adjustments: serde_json::Value,
    rotation: f32,
    flip_horizontal: bool,
    flip_vertical: bool,
    orientation_steps: u8,
    state: tauri::State<'_, AppState>,
) -> Result<AiForegroundMaskParameters, String> {
    let warped_image = get_cached_full_warped_image(&state, &js_adjustments)?;
    let full_mask_image =
        crate::ai::person_segmentation::generate_whole_person_mask(warped_image.as_ref())?;
    let base64_data = encode_to_base64_png(&full_mask_image)?;

    Ok(AiForegroundMaskParameters {
        mask_data_base64: Some(base64_data),
        rotation: Some(rotation),
        flip_horizontal: Some(flip_horizontal),
        flip_vertical: Some(flip_vertical),
        orientation_steps: Some(orientation_steps),
        ..Default::default()
    })
}

#[allow(clippy::too_many_arguments)]
#[tauri::command]
pub async fn generate_ai_person_part_mask(
    js_adjustments: serde_json::Value,
    part: String,
    rotation: f32,
    flip_horizontal: bool,
    flip_vertical: bool,
    orientation_steps: u8,
    state: tauri::State<'_, AppState>,
    app_handle: tauri::AppHandle,
) -> Result<AiForegroundMaskParameters, String> {
    let warped_image = get_cached_full_warped_image(&state, &js_adjustments)?;
    let mut provenance = None;
    let mask_image = match part.as_str() {
        "face" => crate::ai::person_segmentation::generate_face_mask(warped_image.as_ref())?,
        "full_person" => {
            crate::ai::person_segmentation::generate_whole_person_mask(warped_image.as_ref())?
        }
        "clothing" | "hair" => {
            let parser_lease = acquire_ort_model(
                &app_handle,
                &state.ai_model_registry,
                AiModelId::PersonPartParser,
            )
            .await
            .map_err(|error| error.to_string())?;
            let parser = parser_lease.ort()?;
            let target = if part == "hair" {
                crate::ai::person_part_parser::PersonPartMaskTarget::Hair
            } else {
                crate::ai::person_part_parser::PersonPartMaskTarget::Clothing
            };
            provenance = Some(crate::ai::person_part_parser::person_part_parser_provenance(target));
            crate::ai::person_part_parser::run_person_part_parser_model(
                warped_image.as_ref(),
                &parser,
                target,
            )
            .map_err(|error| error.to_string())?
        }
        unsupported => {
            return Err(format!(
                "Unsupported person mask part '{unsupported}'. Supported runtime parts: face, full_person, clothing, hair"
            ));
        }
    };
    let base64_data = encode_to_base64_png(&mask_image)?;

    Ok(AiForegroundMaskParameters {
        mask_data_base64: Some(base64_data),
        class_ids: provenance.as_ref().map(|entry| entry.class_ids.clone()),
        rotation: Some(rotation),
        flip_horizontal: Some(flip_horizontal),
        flip_vertical: Some(flip_vertical),
        orientation_steps: Some(orientation_steps),
        model_id: provenance.as_ref().map(|entry| entry.model_id.to_string()),
        model_sha256: provenance
            .as_ref()
            .map(|entry| entry.model_sha256.to_string()),
        provider_id: provenance
            .as_ref()
            .map(|_| "deeplabv3p-human-parser".to_string()),
        target_part: provenance
            .as_ref()
            .map(|entry| entry.target_part.to_string()),
    })
}

#[allow(clippy::too_many_arguments)]
#[tauri::command]
pub async fn generate_ai_depth_mask(
    js_adjustments: serde_json::Value,
    path: String,
    min_depth: f32,
    max_depth: f32,
    min_fade: f32,
    max_fade: f32,
    feather: f32,
    rotation: f32,
    flip_horizontal: bool,
    flip_vertical: bool,
    orientation_steps: u8,
    state: tauri::State<'_, AppState>,
    app_handle: tauri::AppHandle,
) -> Result<AiDepthMaskParameters, String> {
    let depth_lease = acquire_ort_model(
        &app_handle,
        &state.ai_model_registry,
        AiModelId::DepthAnything,
    )
    .await
    .map_err(|e| e.to_string())?;
    let depth_session = depth_lease.ort()?;

    let path_hash = {
        let mut hasher = blake3::Hasher::new();
        hasher.update(b"depth-anything-v2-vits:preprocess-v1");
        hasher.update(path.as_bytes());
        let mut geo_hasher = DefaultHasher::new();
        for key in GEOMETRY_KEYS {
            if let Some(val) = js_adjustments.get(key) {
                key.hash(&mut geo_hasher);
                val.to_string().hash(&mut geo_hasher);
            }
        }
        hasher.update(&geo_hasher.finish().to_le_bytes());
        hasher.finalize().to_hex().to_string()
    };

    let cached_depth = {
        let mut depth_cache = state.ai_depth_map.lock().unwrap();

        if let Some(cached) = depth_cache.as_ref() {
            if cached.path_hash == path_hash {
                cached.clone()
            } else {
                let warped_image = get_cached_full_warped_image(&state, &js_adjustments)?;
                let depth_img = run_depth_anything_model(warped_image.as_ref(), &depth_session)
                    .map_err(|e| e.to_string())?;
                let new_cache = CachedDepthMap {
                    path_hash,
                    depth_image: depth_img,
                    original_size: (warped_image.width(), warped_image.height()),
                };
                *depth_cache = Some(new_cache.clone());
                new_cache
            }
        } else {
            let warped_image = get_cached_full_warped_image(&state, &js_adjustments)?;
            let depth_img = run_depth_anything_model(warped_image.as_ref(), &depth_session)
                .map_err(|e| e.to_string())?;
            let new_cache = CachedDepthMap {
                path_hash,
                depth_image: depth_img,
                original_size: (warped_image.width(), warped_image.height()),
            };
            *depth_cache = Some(new_cache.clone());
            new_cache
        }
    };

    let raw_depth_fullres = image::imageops::resize(
        &cached_depth.depth_image,
        cached_depth.original_size.0,
        cached_depth.original_size.1,
        image::imageops::FilterType::Triangle,
    );

    let base64_data = encode_to_base64_png(&raw_depth_fullres)?;

    Ok(AiDepthMaskParameters {
        min_depth,
        max_depth,
        min_fade,
        max_fade,
        feather,
        mask_data_base64: Some(base64_data),
        rotation: Some(rotation),
        flip_horizontal: Some(flip_horizontal),
        flip_vertical: Some(flip_vertical),
        orientation_steps: Some(orientation_steps),
    })
}

#[allow(clippy::too_many_arguments)]
#[tauri::command]
pub async fn generate_ai_subject_mask(
    js_adjustments: serde_json::Value,
    path: String,
    start_point: (f64, f64),
    end_point: (f64, f64),
    rotation: f32,
    flip_horizontal: bool,
    flip_vertical: bool,
    orientation_steps: u8,
    state: tauri::State<'_, AppState>,
    app_handle: tauri::AppHandle,
) -> Result<AiSubjectMaskParameters, String> {
    let encoder_lease =
        acquire_ort_model(&app_handle, &state.ai_model_registry, AiModelId::SamEncoder)
            .await
            .map_err(|e| e.to_string())?;
    let decoder_lease =
        acquire_ort_model(&app_handle, &state.ai_model_registry, AiModelId::SamDecoder)
            .await
            .map_err(|e| e.to_string())?;
    let encoder = encoder_lease.ort()?;
    let decoder = decoder_lease.ort()?;

    let path_hash = sam_path_hash(&path, &js_adjustments);
    let (embeddings, _) =
        get_cached_or_generate_sam_embeddings(&state, &encoder, &js_adjustments, &path_hash)?;
    let (img_w, img_h) = embeddings.original_size;
    let (unrotated_start_point, unrotated_end_point) = unwarp_sam_prompt(
        start_point,
        end_point,
        &SamPromptGeometry {
            rotation,
            flip_horizontal,
            flip_vertical,
            orientation_steps,
            image_width: img_w,
            image_height: img_h,
        },
    );

    let mask_bitmap = run_sam_decoder(
        &decoder,
        &embeddings,
        unrotated_start_point,
        unrotated_end_point,
    )
    .map_err(|e| e.to_string())?;
    let base64_data = encode_to_base64_png(&mask_bitmap)?;

    Ok(AiSubjectMaskParameters {
        start_x: start_point.0,
        start_y: start_point.1,
        end_x: end_point.0,
        end_y: end_point.1,
        mask_data_base64: Some(base64_data),
        rotation: Some(rotation),
        flip_horizontal: Some(flip_horizontal),
        flip_vertical: Some(flip_vertical),
        orientation_steps: Some(orientation_steps),
    })
}

#[allow(clippy::too_many_arguments)]
#[tauri::command]
pub async fn generate_ai_object_mask_proposal(
    js_adjustments: serde_json::Value,
    path: String,
    start_point: (f64, f64),
    end_point: (f64, f64),
    rotation: f32,
    flip_horizontal: bool,
    flip_vertical: bool,
    orientation_steps: u8,
    state: tauri::State<'_, AppState>,
    app_handle: tauri::AppHandle,
) -> Result<AiObjectMaskProposal, String> {
    let total_start = Instant::now();
    let encoder_lease =
        acquire_ort_model(&app_handle, &state.ai_model_registry, AiModelId::SamEncoder)
            .await
            .map_err(|e| e.to_string())?;
    let decoder_lease =
        acquire_ort_model(&app_handle, &state.ai_model_registry, AiModelId::SamDecoder)
            .await
            .map_err(|e| e.to_string())?;
    let encoder = encoder_lease.ort()?;
    let decoder = decoder_lease.ort()?;
    let path_hash = sam_path_hash(&path, &js_adjustments);
    let (embeddings, embedding_latency_ms) =
        get_cached_or_generate_sam_embeddings(&state, &encoder, &js_adjustments, &path_hash)?;
    let (image_width, image_height) = embeddings.original_size;
    let (unrotated_start_point, unrotated_end_point) = unwarp_sam_prompt(
        start_point,
        end_point,
        &SamPromptGeometry {
            rotation,
            flip_horizontal,
            flip_vertical,
            orientation_steps,
            image_width,
            image_height,
        },
    );

    let decoder_start = Instant::now();
    let mask_bitmap = run_sam_decoder(
        &decoder,
        &embeddings,
        unrotated_start_point,
        unrotated_end_point,
    )
    .map_err(|e| e.to_string())?;
    let decoder_latency_ms = decoder_start.elapsed().as_secs_f64() * 1000.0;
    let prompt_kind = if (start_point.0 - end_point.0).abs() < 1e-6
        && (start_point.1 - end_point.1).abs() < 1e-6
    {
        "point"
    } else {
        "box"
    };

    Ok(AiObjectMaskProposal {
        mask_data_base64: encode_to_base64_png(&mask_bitmap)?,
        provider_id: "rapidraw-sam-vit-b-onnx-v1".to_string(),
        model_id: "sam_vit_b_01ec64".to_string(),
        image_width,
        image_height,
        prompt_count: if prompt_kind == "point" { 1 } else { 2 },
        prompt_kind: prompt_kind.to_string(),
        embedding_latency_ms,
        decoder_latency_ms,
        click_to_mask_latency_ms: total_start.elapsed().as_secs_f64() * 1000.0,
    })
}

#[tauri::command]
pub async fn precompute_ai_subject_mask(
    js_adjustments: serde_json::Value,
    path: String,
    state: tauri::State<'_, AppState>,
    app_handle: tauri::AppHandle,
) -> Result<(), String> {
    let encoder_lease =
        acquire_ort_model(&app_handle, &state.ai_model_registry, AiModelId::SamEncoder)
            .await
            .map_err(|e| e.to_string())?;
    let encoder = encoder_lease.ort()?;

    let path_hash = sam_path_hash(&path, &js_adjustments);

    let mut embeddings_cache = state.ai_embeddings.lock().unwrap();

    if let Some(cached_embeddings) = embeddings_cache.as_ref()
        && cached_embeddings.path_hash == path_hash
    {
        return Ok(());
    }

    let warped_image = get_cached_full_warped_image(&state, &js_adjustments)?;
    let mut new_embeddings =
        generate_image_embeddings(warped_image.as_ref(), &encoder).map_err(|e| e.to_string())?;

    new_embeddings.path_hash = path_hash;
    *embeddings_cache = Some(new_embeddings);

    Ok(())
}

#[tauri::command]
pub async fn check_ai_connector_status(app_handle: tauri::AppHandle) {
    let settings = load_settings_or_default(&app_handle);
    let is_connected = if let Some(address) = settings.ai_connector_address {
        ai_connector::check_status(&address).await.unwrap_or(false)
    } else {
        false
    };
    use tauri::Emitter;
    let _ = app_handle.emit(
        crate::events::AI_CONNECTOR_STATUS_UPDATE,
        serde_json::json!({ "connected": is_connected }),
    );
}

#[tauri::command]
pub async fn test_ai_connector_connection(address: String) -> Result<(), String> {
    match ai_connector::check_status(&address).await {
        Ok(true) => Ok(()),
        Ok(false) => Err("Server reachable but returned bad health status".to_string()),
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
pub async fn invoke_generative_replace_with_mask_def(
    path: String,
    patch_definition: AiPatchDefinition,
    current_adjustments: Value,
    use_fast_inpaint: bool,
    token: Option<String>,
    app_handle: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
) -> Result<String, String> {
    let settings = load_settings_or_default(&app_handle);

    let mut source_image_adjustments = current_adjustments.clone();
    if let Some(patches) = source_image_adjustments
        .get_mut("aiPatches")
        .and_then(|v| v.as_array_mut())
    {
        patches.retain(|p| p.get("id").and_then(|id| id.as_str()) != Some(&patch_definition.id));
    }

    let (base_image, _) = get_full_image_for_processing(&state)?;
    let source_image = composite_patches_on_image(&base_image, &source_image_adjustments)
        .map_err(|e| format!("Failed to prepare source image: {}", e))?;

    let (img_w, img_h) = source_image.dimensions();
    let mask_def_for_generation = MaskDefinition {
        id: patch_definition.id.clone(),
        name: patch_definition.name.clone(),
        visible: patch_definition.visible,
        invert: patch_definition.invert,
        blend_mode: "normal".to_string(),
        opacity: 100.0,
        adjustments: serde_json::Value::Null,
        sub_masks: patch_definition.sub_masks,
    };

    let warped_image = resolve_warped_image_for_masks(
        &state,
        &current_adjustments,
        std::slice::from_ref(&mask_def_for_generation),
    );

    let mask_bitmap = generate_mask_bitmap(
        &mask_def_for_generation,
        img_w,
        img_h,
        1.0,
        (0.0, 0.0),
        warped_image.as_deref(),
    )
    .ok_or("Failed to generate mask bitmap for AI replace")?;

    let mask_dynamic = DynamicImage::ImageLuma8(mask_bitmap);
    let unwarped_dynamic =
        apply_unwarp_geometry(Cow::Borrowed(&mask_dynamic), &current_adjustments).into_owned();
    let mask_bitmap = unwarped_dynamic.to_luma8();

    let patch_rgba = if use_fast_inpaint {
        let lama_lease = ai_processing::acquire_ort_model(
            &app_handle,
            &state.ai_model_registry,
            AiModelId::Lama,
        )
        .await
        .map_err(|e| e.to_string())?;
        let lama_model = lama_lease.ort()?;

        ai_processing::run_lama_inpainting(&source_image, &mask_bitmap, &lama_model)
            .map_err(|e| e.to_string())?
    } else if settings.ai_provider.as_deref() == Some("cloud")
        && let Some(auth_token) = token
    {
        let base_url = "https://getrapidraw.com/api";

        let mut rgba_mask = RgbaImage::new(img_w, img_h);
        for (x, y, luma_pixel) in mask_bitmap.enumerate_pixels() {
            let intensity = luma_pixel[0];
            rgba_mask.put_pixel(x, y, Rgba([intensity, intensity, intensity, 255]));
        }
        let mask_image_dynamic = DynamicImage::ImageRgba8(rgba_mask);

        let (real_path_buf, _) = crate::file_management::parse_virtual_path(&path);

        ai_connector::process_inpainting(
            base_url,
            &real_path_buf.to_string_lossy(),
            &source_image,
            &mask_image_dynamic,
            patch_definition.prompt,
            Some(&auth_token),
        )
        .await
        .map_err(|e| e.to_string())?
    } else if settings.ai_provider.as_deref() == Some("ai-connector")
        && let Some(address) = settings.ai_connector_address
    {
        let base_url = format!("http://{}", address);

        let mut rgba_mask = RgbaImage::new(img_w, img_h);
        for (x, y, luma_pixel) in mask_bitmap.enumerate_pixels() {
            let intensity = luma_pixel[0];
            rgba_mask.put_pixel(x, y, Rgba([intensity, intensity, intensity, 255]));
        }
        let mask_image_dynamic = DynamicImage::ImageRgba8(rgba_mask);

        let (real_path_buf, _) = crate::file_management::parse_virtual_path(&path);

        ai_connector::process_inpainting(
            &base_url,
            &real_path_buf.to_string_lossy(),
            &source_image,
            &mask_image_dynamic,
            patch_definition.prompt,
            None,
        )
        .await
        .map_err(|e| e.to_string())?
    } else {
        return Err(
            "No generative backend configured or connection invalid. Please check your AI settings."
                .to_string(),
        );
    };

    let (patch_w, patch_h) = patch_rgba.dimensions();
    let scaled_mask_bitmap = image::imageops::resize(
        &mask_bitmap,
        patch_w,
        patch_h,
        image::imageops::FilterType::Lanczos3,
    );
    let mut color_image = RgbImage::new(patch_w, patch_h);
    let mask_image = scaled_mask_bitmap.clone();

    for y in 0..patch_h {
        for x in 0..patch_w {
            let mask_value = scaled_mask_bitmap.get_pixel(x, y)[0];

            if mask_value > 0 {
                let patch_pixel = patch_rgba.get_pixel(x, y);
                color_image.put_pixel(x, y, Rgb([patch_pixel[0], patch_pixel[1], patch_pixel[2]]));
            } else {
                color_image.put_pixel(x, y, Rgb([0, 0, 0]));
            }
        }
    }

    let quality = 92;

    let mut color_buf = Cursor::new(Vec::new());
    color_image
        .write_with_encoder(image::codecs::jpeg::JpegEncoder::new_with_quality(
            &mut color_buf,
            quality,
        ))
        .map_err(|e| e.to_string())?;
    let color_base64 = general_purpose::STANDARD.encode(color_buf.get_ref());

    let mut mask_buf = Cursor::new(Vec::new());
    mask_image
        .write_with_encoder(image::codecs::jpeg::JpegEncoder::new_with_quality(
            &mut mask_buf,
            quality,
        ))
        .map_err(|e| e.to_string())?;
    let mask_base64 = general_purpose::STANDARD.encode(mask_buf.get_ref());

    let result_json = serde_json::json!({
        "color": color_base64,
        "mask": mask_base64
    })
    .to_string();

    Ok(result_json)
}
