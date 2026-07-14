use std::sync::Arc;

use image::{DynamicImage, Rgba};
use imageproc::drawing::draw_line_segment_mut;
use imageproc::edges::canny;
use imageproc::hough::{LineDetectionOptions, detect_lines};
use serde::Deserialize;
use tauri::State;

use crate::app::settings::load_settings_or_default;
use crate::app_state::AppState;
use crate::color::adjustment_fields;
use crate::color::adjustment_utils::hydrate_adjustments;
use crate::geometry::GeometryParams;
use crate::gpu::gpu_context::get_or_init_gpu_context;
use crate::gpu::gpu_processing::{EditGraphExecutionAuthority, PreGpuImageIdentity, RenderRequest};
use crate::image_processing::{
    apply_coarse_rotation, apply_flip, downscale_f32_image, warp_image_geometry,
};
use crate::render::render_caches;
use crate::{calculate_transform_hash, calculate_visual_hash, compile_consumer_render_plan};
use crate::{get_or_load_lut, resolve_tonemapper_override_from_handle};

#[derive(Clone, Copy, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub(crate) enum PreviewGeometryQuality {
    Interactive,
    Settled,
}

#[derive(Clone, Copy, Deserialize)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub(crate) enum PreviewGeometryTarget {
    EditorSetting {
        quality: PreviewGeometryQuality,
    },
    LongEdge {
        #[serde(rename = "longEdgePx")]
        long_edge_px: u32,
        quality: PreviewGeometryQuality,
    },
}

impl PreviewGeometryTarget {
    pub(crate) fn resolve_long_edge(self, editor_preview_resolution: u32) -> u32 {
        match self {
            Self::EditorSetting { quality } => match quality {
                PreviewGeometryQuality::Interactive => {
                    (editor_preview_resolution as f32 / 1.5).round() as u32
                }
                PreviewGeometryQuality::Settled => editor_preview_resolution,
            },
            Self::LongEdge {
                long_edge_px,
                quality,
            } => match quality {
                PreviewGeometryQuality::Interactive | PreviewGeometryQuality::Settled => {
                    long_edge_px
                }
            },
        }
        .clamp(64, 8192)
    }
}

#[tauri::command]
pub(crate) async fn preview_geometry_transform(
    params: GeometryParams,
    js_adjustments: serde_json::Value,
    show_lines: bool,
    target: Option<PreviewGeometryTarget>,
    state: State<'_, AppState>,
    app_handle: tauri::AppHandle,
) -> Result<String, String> {
    let (loaded_image_path, loaded_source_revision, is_raw) = {
        let guard = state.original_image.lock().unwrap();
        let loaded = guard.as_ref().ok_or("No image loaded")?;
        (
            loaded.path.clone(),
            loaded.artifact_source.source_fingerprint(),
            loaded.is_raw,
        )
    };

    let settings = load_settings_or_default(&app_handle);
    let target = target.unwrap_or(PreviewGeometryTarget::EditorSetting {
        quality: PreviewGeometryQuality::Interactive,
    });
    let target_dim = target.resolve_long_edge(settings.editor_preview_resolution.unwrap_or(1920));
    let visual_hash = calculate_visual_hash(&loaded_image_path, &js_adjustments)
        .wrapping_mul(31)
        .wrapping_add(u64::from(target_dim));

    let base_image_to_warp = {
        let maybe_cached_image = state.geometry_cache.get(&visual_hash);

        if let Some(cached_image) = maybe_cached_image {
            cached_image.as_ref().clone()
        } else {
            let context = get_or_init_gpu_context(&state, &app_handle)?;

            let original_image = {
                let guard = state.original_image.lock().unwrap();
                let loaded = guard.as_ref().ok_or("No image loaded")?;
                loaded.image.clone()
            };

            let preview_base = tokio::task::spawn_blocking(move || -> DynamicImage {
                downscale_f32_image(&original_image, target_dim, target_dim)
            })
            .await
            .map_err(|e| e.to_string())?;

            let mut temp_adjustments = js_adjustments.clone();
            hydrate_adjustments(&state, &mut temp_adjustments);

            if let Some(obj) = temp_adjustments.as_object_mut() {
                obj.insert(adjustment_fields::CROP.to_string(), serde_json::Value::Null);
                obj.insert(
                    adjustment_fields::ROTATION.to_string(),
                    serde_json::json!(0.0),
                );
                obj.insert(
                    adjustment_fields::ORIENTATION_STEPS.to_string(),
                    serde_json::json!(0),
                );
                obj.insert(
                    adjustment_fields::FLIP_HORIZONTAL.to_string(),
                    serde_json::json!(false),
                );
                obj.insert(
                    adjustment_fields::FLIP_VERTICAL.to_string(),
                    serde_json::json!(false),
                );
                for key in adjustment_fields::GEOMETRY_KEYS {
                    match *key {
                        adjustment_fields::TRANSFORM_SCALE
                        | adjustment_fields::LENS_DISTORTION_AMOUNT
                        | adjustment_fields::LENS_VIGNETTE_AMOUNT
                        | adjustment_fields::LENS_TCA_AMOUNT => {
                            obj.insert(key.to_string(), serde_json::json!(100.0));
                        }
                        adjustment_fields::LENS_DISTORTION_PARAMS
                        | adjustment_fields::LENS_MAKER
                        | adjustment_fields::LENS_MODEL => {
                            obj.insert(key.to_string(), serde_json::Value::Null);
                        }
                        adjustment_fields::LENS_DISTORTION_ENABLED
                        | adjustment_fields::LENS_TCA_ENABLED
                        | adjustment_fields::LENS_VIGNETTE_ENABLED => {
                            obj.insert(key.to_string(), serde_json::json!(true));
                        }
                        _ => {
                            obj.insert(key.to_string(), serde_json::json!(0.0));
                        }
                    }
                }
            }

            let tm_override = resolve_tonemapper_override_from_handle(&app_handle, is_raw);
            let lut_path = temp_adjustments["lutPath"].as_str();
            let lut = lut_path.and_then(|p| get_or_load_lut(&state, p).ok());
            let render_plan = compile_consumer_render_plan(
                &temp_adjustments,
                &loaded_image_path,
                is_raw,
                tm_override,
                lut,
            )?;
            let mask_bitmaps = Vec::new();
            let pre_gpu_revision = calculate_transform_hash(&temp_adjustments);

            let processed_base = crate::image_processing::process_and_get_dynamic_image(
                &context,
                &state,
                &preview_base,
                PreGpuImageIdentity::for_stage(
                    &preview_base,
                    loaded_source_revision,
                    pre_gpu_revision,
                    pre_gpu_revision,
                ),
                RenderRequest {
                    adjustments: render_plan.adjustments,
                    mask_bitmaps: &mask_bitmaps,
                    lut: render_plan.lut.clone(),
                    roi: None,
                    edit_graph: EditGraphExecutionAuthority::Compiled(Arc::clone(
                        &render_plan.edit_graph,
                    )),
                },
                "preview_geometry_transform_base_gen",
            )?;

            render_caches::RenderCaches::new(&state).insert_geometry_cache_entry(
                visual_hash,
                processed_base.clone(),
                5,
            );

            processed_base
        }
    };

    let final_image = tokio::task::spawn_blocking(move || -> DynamicImage {
        let mut adjusted_params = params;
        if is_raw {
            adjusted_params.lens_vignette_amount *= 0.4;
        } else {
            adjusted_params.lens_vignette_amount *= 0.8;
        }

        let warped_image = warp_image_geometry(&base_image_to_warp, adjusted_params);
        let orientation_steps = js_adjustments[adjustment_fields::ORIENTATION_STEPS]
            .as_u64()
            .unwrap_or(0) as u8;
        let flip_horizontal = js_adjustments[adjustment_fields::FLIP_HORIZONTAL]
            .as_bool()
            .unwrap_or(false);
        let flip_vertical = js_adjustments[adjustment_fields::FLIP_VERTICAL]
            .as_bool()
            .unwrap_or(false);

        let coarse_rotated_image =
            apply_coarse_rotation(std::borrow::Cow::Owned(warped_image), orientation_steps);
        let flipped_image =
            apply_flip(coarse_rotated_image, flip_horizontal, flip_vertical).into_owned();

        if show_lines {
            let gray_image = flipped_image.to_luma8();
            let mut visualization = flipped_image.to_rgba8();
            let edges = canny(&gray_image, 50.0, 100.0);
            let min_dim = gray_image.width().min(gray_image.height());
            let options = LineDetectionOptions {
                vote_threshold: (min_dim as f32 * 0.24) as u32,
                suppression_radius: 15,
            };
            let lines = detect_lines(&edges, options);
            for line in lines {
                let angle_deg = line.angle_in_degrees as f32;
                let angle_norm = angle_deg % 180.0;
                let is_vertical = !(0.5..=(180.0 - 0.5)).contains(&angle_norm);
                let is_horizontal = (angle_norm - 90.0).abs() < 0.5;
                let color = if is_vertical || is_horizontal {
                    Rgba([0, 255, 0, 255])
                } else {
                    Rgba([255, 0, 0, 255])
                };
                let r = line.r;
                let theta_rad = angle_deg.to_radians();
                let a = theta_rad.cos();
                let b = theta_rad.sin();
                let x0 = a * r;
                let y0 = b * r;
                let dist = (visualization.width().max(visualization.height()) * 2) as f32;
                let x1 = x0 + dist * (-b);
                let y1 = y0 + dist * a;
                let x2 = x0 - dist * (-b);
                let y2 = y0 - dist * a;
                draw_line_segment_mut(&mut visualization, (x1, y1), (x2, y2), color);
                draw_line_segment_mut(
                    &mut visualization,
                    (x1 + a, y1 + b),
                    (x2 + a, y2 + b),
                    color,
                );
            }
            DynamicImage::ImageRgba8(visualization)
        } else {
            flipped_image
        }
    })
    .await
    .map_err(|e| e.to_string())?;

    crate::image_codecs::encode_jpeg_data_url(&final_image, 75)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn target_resolution_is_clamped_and_quality_aware() {
        assert_eq!(
            PreviewGeometryTarget::LongEdge {
                long_edge_px: 1,
                quality: PreviewGeometryQuality::Settled
            }
            .resolve_long_edge(1920),
            64
        );
        assert_eq!(
            PreviewGeometryTarget::LongEdge {
                long_edge_px: 20_000,
                quality: PreviewGeometryQuality::Interactive
            }
            .resolve_long_edge(1920),
            8192
        );
        assert_eq!(
            PreviewGeometryTarget::EditorSetting {
                quality: PreviewGeometryQuality::Interactive
            }
            .resolve_long_edge(1920),
            1280
        );
    }
}
