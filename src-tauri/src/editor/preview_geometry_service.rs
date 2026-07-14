//! Pure preview geometry rendering owned by the editor.
//!
//! Callers provide an immutable source and adjustment snapshot. The service
//! returns a bounded preview plus a receipt describing the work performed; it
//! never reads or locks application state while transforming pixels.

use std::borrow::Cow;

use image::{DynamicImage, GenericImageView};
use serde_json::Value;

use crate::app_state::{AppState, LoadedImage};
use crate::color::{adjustment_fields, adjustment_utils::apply_all_transformations};
use crate::geometry::{
    Crop, GeometryParams, PREVIEW_GEOMETRY_BAND_ROWS, SourceSampleDecorator,
    get_geometry_params_from_json, is_geometry_identity, warp_image_geometry_mapped,
};
use crate::image_loader::composite_patches_on_image;
use crate::image_processing::{apply_coarse_rotation, apply_flip, downscale_f32_image};
use crate::patch_assets::{PreviewPatchSampler, prepare_preview_patch_sampler};

pub fn generate_transformed_preview(
    state: &tauri::State<AppState>,
    loaded_image: &LoadedImage,
    adjustments: &Value,
    preview_dim: u32,
) -> Result<(DynamicImage, f32, (f32, f32)), String> {
    generate_transformed_preview_cancellable(state, loaded_image, adjustments, preview_dim, None)
}

pub(crate) fn generate_transformed_preview_cancellable(
    _state: &tauri::State<AppState>,
    loaded_image: &LoadedImage,
    adjustments: &Value,
    preview_dim: u32,
    cancellation: Option<&dyn Fn() -> Result<(), String>>,
) -> Result<(DynamicImage, f32, (f32, f32)), String> {
    compute_preview_transformed(
        loaded_image.image.as_ref(),
        adjustments,
        preview_dim,
        cancellation,
    )
}

pub struct PreviewGeometryRequest<'a> {
    pub source: &'a DynamicImage,
    pub adjustments: &'a Value,
    pub target_long_edge: u32,
    pub cancellation: Option<&'a dyn Fn() -> Result<(), String>>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct PreviewGeometryReceipt {
    pub source_pixel_count: u64,
    pub working_pixel_count: u64,
    pub output_pixel_count: u64,
    pub full_resolution_transform_allocations: u32,
    pub direct_crop: bool,
    pub tile_count: u32,
}

pub struct PreviewGeometryResult {
    pub image: DynamicImage,
    pub effective_scale: f32,
    pub unscaled_crop_offset: (f32, f32),
    pub receipt: PreviewGeometryReceipt,
}

#[derive(Debug, Default, Clone, Copy)]
pub struct PreviewGeometryService;

pub type PreviewGeometryPipeline = PreviewGeometryService;

impl PreviewGeometryService {
    pub fn execute(request: PreviewGeometryRequest<'_>) -> Result<PreviewGeometryResult, String> {
        let source = request.source;
        let adjustments = request.adjustments;
        let preview_dim = request.target_long_edge.max(1);
        if let Some(check) = request.cancellation {
            check()?;
        }
        if let Some(result) =
            compute_direct_crop_preview(source, adjustments, preview_dim, request.cancellation)?
        {
            if let Some(check) = request.cancellation {
                check()?;
            }
            return Ok(result);
        }

        let source_scale =
            Self::source_scale(source.width(), source.height(), adjustments, preview_dim);
        let working_source = if source_scale < 1.0 {
            let width = ((source.width() as f32 * source_scale).round() as u32).max(1);
            let height = ((source.height() as f32 * source_scale).round() as u32).max(1);
            Cow::Owned(downscale_f32_image(source, width, height))
        } else {
            Cow::Borrowed(source)
        };
        if let Some(check) = request.cancellation {
            check()?;
        }

        let working_pixel_count =
            u64::from(working_source.width()) * u64::from(working_source.height());
        let preview_adjustments = Self::scale_adjustments(adjustments, source_scale);
        let patched_source =
            composite_patches_on_image(working_source.as_ref(), &preview_adjustments)
                .map_err(|error| format!("Failed to composite preview patches: {error}"))?;
        if let Some(check) = request.cancellation {
            check()?;
        }
        let (transformed, scaled_crop_offset) =
            apply_all_transformations(patched_source, &preview_adjustments);
        if let Some(check) = request.cancellation {
            check()?;
        }

        let (working_width, working_height) = transformed.dimensions();
        let preview = if working_width > preview_dim || working_height > preview_dim {
            downscale_f32_image(&transformed, preview_dim, preview_dim)
        } else {
            transformed.into_owned()
        };
        let post_transform_scale = if working_width > 0 {
            preview.width() as f32 / working_width as f32
        } else {
            1.0
        };
        let unscaled_crop_offset = if source_scale > 0.0 {
            (
                scaled_crop_offset.0 / source_scale,
                scaled_crop_offset.1 / source_scale,
            )
        } else {
            scaled_crop_offset
        };

        Ok(PreviewGeometryResult {
            effective_scale: source_scale * post_transform_scale,
            unscaled_crop_offset,
            receipt: PreviewGeometryReceipt {
                source_pixel_count: u64::from(source.width()) * u64::from(source.height()),
                working_pixel_count,
                output_pixel_count: u64::from(preview.width()) * u64::from(preview.height()),
                full_resolution_transform_allocations: 0,
                direct_crop: false,
                tile_count: 1,
            },
            image: preview,
        })
    }

    pub fn source_scale(
        source_width: u32,
        source_height: u32,
        adjustments: &Value,
        preview_dim: u32,
    ) -> f32 {
        let orientation_steps = adjustments[adjustment_fields::ORIENTATION_STEPS]
            .as_u64()
            .unwrap_or(0) as u8;
        let (oriented_width, oriented_height) = if orientation_steps % 2 == 1 {
            (source_height, source_width)
        } else {
            (source_width, source_height)
        };
        let target_long_edge =
            serde_json::from_value::<Crop>(adjustments[adjustment_fields::CROP].clone())
                .ok()
                .map(|crop| crop.width.max(crop.height) as f32)
                .filter(|dimension| dimension.is_finite() && *dimension > 0.0)
                .unwrap_or_else(|| oriented_width.max(oriented_height) as f32);

        if target_long_edge <= preview_dim.max(1) as f32 {
            1.0
        } else {
            preview_dim.max(1) as f32 / target_long_edge
        }
    }

    pub fn scale_adjustments(adjustments: &Value, source_scale: f32) -> Value {
        if source_scale >= 1.0 {
            return adjustments.clone();
        }
        let mut scaled = adjustments.clone();
        if let Some(crop_value) = scaled.get_mut(adjustment_fields::CROP)
            && let Ok(mut crop) = serde_json::from_value::<Crop>(crop_value.clone())
        {
            let scale = f64::from(source_scale);
            crop.x *= scale;
            crop.y *= scale;
            crop.width *= scale;
            crop.height *= scale;
            *crop_value = serde_json::to_value(crop).unwrap_or(Value::Null);
        }
        scaled
    }
}

fn compute_preview_transformed(
    source: &DynamicImage,
    adjustments: &Value,
    preview_dim: u32,
    cancellation: Option<&dyn Fn() -> Result<(), String>>,
) -> Result<(DynamicImage, f32, (f32, f32)), String> {
    let result = PreviewGeometryService::execute(PreviewGeometryRequest {
        source,
        adjustments,
        target_long_edge: preview_dim,
        cancellation,
    })?;
    Ok((
        result.image,
        result.effective_scale,
        result.unscaled_crop_offset,
    ))
}

fn compute_direct_crop_preview(
    source: &DynamicImage,
    adjustments: &Value,
    preview_dim: u32,
    cancellation: Option<&dyn Fn() -> Result<(), String>>,
) -> Result<Option<PreviewGeometryResult>, String> {
    let Ok(crop) = serde_json::from_value::<Crop>(adjustments[adjustment_fields::CROP].clone())
    else {
        return Ok(None);
    };
    let rotation = adjustments[adjustment_fields::ROTATION]
        .as_f64()
        .unwrap_or(0.0);
    let orientation = adjustments[adjustment_fields::ORIENTATION_STEPS]
        .as_u64()
        .unwrap_or(0);
    let patch_sampler = prepare_preview_patch_sampler(adjustments, source.width(), source.height())
        .map_err(|error| format!("Failed to prepare preview patches: {error}"))?;
    let geometry = get_geometry_params_from_json(adjustments);
    let has_geometry = !is_geometry_identity(&geometry);

    let (oriented_width, oriented_height) = if orientation % 2 == 1 {
        (source.height(), source.width())
    } else {
        source.dimensions()
    };
    let mut x = crop.x.round().max(0.0) as u32;
    let mut y = crop.y.round().max(0.0) as u32;
    if x >= oriented_width || y >= oriented_height {
        return Ok(None);
    }
    let mut width = (crop.width.round().max(1.0) as u32).min(oriented_width - x);
    let mut height = (crop.height.round().max(1.0) as u32).min(oriented_height - y);
    if rotation.rem_euclid(360.0).abs() > f64::EPSILON || has_geometry || patch_sampler.is_some() {
        return render_mapped_crop_preview(
            source,
            MappedCropPreviewPlan {
                crop,
                crop_bounds: (x, y, width, height),
                orientation: orientation as u8,
                flip_horizontal: adjustments[adjustment_fields::FLIP_HORIZONTAL]
                    .as_bool()
                    .unwrap_or(false),
                flip_vertical: adjustments[adjustment_fields::FLIP_VERTICAL]
                    .as_bool()
                    .unwrap_or(false),
                rotation_degrees: rotation as f32,
                preview_dim,
                geometry,
                cancellation,
                patch_sampler,
            },
        );
    }
    if adjustments[adjustment_fields::FLIP_HORIZONTAL]
        .as_bool()
        .unwrap_or(false)
    {
        x = oriented_width - x - width;
    }
    if adjustments[adjustment_fields::FLIP_VERTICAL]
        .as_bool()
        .unwrap_or(false)
    {
        y = oriented_height - y - height;
    }
    let (source_x, source_y, source_crop_width, source_crop_height) = match orientation % 4 {
        1 => (y, source.height() - x - width, height, width),
        2 => (
            source.width() - x - width,
            source.height() - y - height,
            width,
            height,
        ),
        3 => (source.width() - y - height, x, height, width),
        _ => (x, y, width, height),
    };
    let cropped = source.crop_imm(source_x, source_y, source_crop_width, source_crop_height);
    let oriented = apply_coarse_rotation(Cow::Owned(cropped), orientation as u8);
    let transformed_crop = apply_flip(
        oriented,
        adjustments[adjustment_fields::FLIP_HORIZONTAL]
            .as_bool()
            .unwrap_or(false),
        adjustments[adjustment_fields::FLIP_VERTICAL]
            .as_bool()
            .unwrap_or(false),
    )
    .into_owned();
    width = transformed_crop.width();
    height = transformed_crop.height();
    let preview = if width > preview_dim || height > preview_dim {
        downscale_f32_image(&transformed_crop, preview_dim, preview_dim)
    } else {
        transformed_crop
    };
    let effective_scale = preview.width() as f32 / width as f32;

    Ok(Some(PreviewGeometryResult {
        effective_scale,
        unscaled_crop_offset: (crop.x as f32, crop.y as f32),
        receipt: PreviewGeometryReceipt {
            source_pixel_count: u64::from(source.width()) * u64::from(source.height()),
            working_pixel_count: u64::from(source_crop_width) * u64::from(source_crop_height),
            output_pixel_count: u64::from(preview.width()) * u64::from(preview.height()),
            full_resolution_transform_allocations: 0,
            direct_crop: true,
            tile_count: 1,
        },
        image: preview,
    }))
}

struct MappedCropPreviewPlan<'a> {
    crop: Crop,
    crop_bounds: (u32, u32, u32, u32),
    orientation: u8,
    flip_horizontal: bool,
    flip_vertical: bool,
    rotation_degrees: f32,
    preview_dim: u32,
    geometry: GeometryParams,
    cancellation: Option<&'a dyn Fn() -> Result<(), String>>,
    patch_sampler: Option<PreviewPatchSampler>,
}

fn render_mapped_crop_preview(
    source: &DynamicImage,
    plan: MappedCropPreviewPlan<'_>,
) -> Result<Option<PreviewGeometryResult>, String> {
    let (crop_x, crop_y, crop_width, crop_height) = plan.crop_bounds;
    let output_scale = (plan.preview_dim as f32 / crop_width.max(crop_height) as f32).min(1.0);
    let output_width = ((crop_width as f32 * output_scale).round() as u32).max(1);
    let output_height = ((crop_height as f32 * output_scale).round() as u32).max(1);
    let (coarse_width, coarse_height) = if plan.orientation % 2 == 1 {
        (source.height(), source.width())
    } else {
        source.dimensions()
    };
    let center_x = coarse_width as f32 / 2.0;
    let center_y = coarse_height as f32 / 2.0;
    let (sin, cos) = plan.rotation_degrees.to_radians().sin_cos();
    let orientation = plan.orientation;
    let flip_horizontal = plan.flip_horizontal;
    let flip_vertical = plan.flip_vertical;
    let crop_offset = (plan.crop.x as f32, plan.crop.y as f32);
    let patch_sampler = plan.patch_sampler;
    let decorate_source = |source_x, source_y, pixel: &mut [f32]| {
        if let Some(sampler) = patch_sampler.as_ref() {
            sampler.blend_at(source_x, source_y, pixel);
        }
    };
    let source_decorator = patch_sampler
        .as_ref()
        .map(|_| &decorate_source as &SourceSampleDecorator<'_>);

    let output = warp_image_geometry_mapped(
        source,
        plan.geometry,
        output_width,
        output_height,
        move |output_x, output_y| {
            let rotated_x = crop_x as f32 + output_x / output_scale;
            let rotated_y = crop_y as f32 + output_y / output_scale;
            let dx = rotated_x - center_x;
            let dy = rotated_y - center_y;
            let mut coarse_x = center_x + cos * dx + sin * dy;
            let mut coarse_y = center_y - sin * dx + cos * dy;
            if flip_horizontal {
                coarse_x = coarse_width as f32 - 1.0 - coarse_x;
            }
            if flip_vertical {
                coarse_y = coarse_height as f32 - 1.0 - coarse_y;
            }
            match orientation % 4 {
                1 => (coarse_y, source.height() as f32 - 1.0 - coarse_x),
                2 => (
                    source.width() as f32 - 1.0 - coarse_x,
                    source.height() as f32 - 1.0 - coarse_y,
                ),
                3 => (source.width() as f32 - 1.0 - coarse_y, coarse_x),
                _ => (coarse_x, coarse_y),
            }
        },
        source_decorator,
        plan.cancellation,
    )?;
    let output_pixel_count = u64::from(output_width) * u64::from(output_height);
    Ok(Some(PreviewGeometryResult {
        image: output,
        effective_scale: output_scale,
        unscaled_crop_offset: crop_offset,
        receipt: PreviewGeometryReceipt {
            source_pixel_count: u64::from(source.width()) * u64::from(source.height()),
            working_pixel_count: output_pixel_count,
            output_pixel_count,
            full_resolution_transform_allocations: 0,
            direct_crop: true,
            tile_count: output_height.div_ceil(PREVIEW_GEOMETRY_BAND_ROWS),
        },
    }))
}

#[cfg(test)]
mod tests {
    use std::io::Cursor;
    use std::sync::atomic::Ordering;
    use std::time::Duration;

    use base64::{Engine as _, engine::general_purpose};
    use image::{GrayImage, ImageFormat, Luma, RgbImage};
    use serde_json::json;

    use super::*;
    use crate::app_settings::AppSettings;
    use crate::editor::preview_geometry::{PreviewGeometryQuality, PreviewGeometryTarget};
    use crate::image_loader::load_base_image_from_bytes;

    fn encoded_preview_fixture(image: DynamicImage) -> String {
        let mut bytes = Cursor::new(Vec::new());
        image.write_to(&mut bytes, ImageFormat::Png).unwrap();
        general_purpose::STANDARD.encode(bytes.into_inner())
    }

    #[test]
    fn preview_geometry_scale_is_crop_aware_without_undersampling_narrow_crops() {
        assert_eq!(
            PreviewGeometryService::source_scale(10_000, 8_000, &json!({}), 2_000),
            0.2
        );
        assert_eq!(
            PreviewGeometryService::source_scale(
                10_000,
                8_000,
                &json!({"crop": {"x": 4_000.0, "y": 3_000.0, "width": 2_000.0, "height": 1_500.0}}),
                2_000,
            ),
            1.0
        );
        assert_eq!(
            PreviewGeometryService::source_scale(
                10_000,
                8_000,
                &json!({"crop": {"x": 2_000.0, "y": 2_000.0, "width": 4_000.0, "height": 3_000.0}}),
                2_000,
            ),
            0.5
        );
        let hundred_mp_scale =
            PreviewGeometryService::source_scale(12_500, 8_000, &json!({}), 1_920);
        let hundred_mp_working_pixels = (12_500.0 * hundred_mp_scale).round() as u64
            * (8_000.0 * hundred_mp_scale).round() as u64;
        assert!((hundred_mp_scale - 0.1536).abs() < 1e-6);
        assert!(hundred_mp_working_pixels < 2_400_000);
        assert!(hundred_mp_working_pixels * 40 < 100_000_000);
    }

    #[test]
    fn preview_geometry_target_resolves_interactive_and_explicit_long_edges() {
        assert_eq!(
            PreviewGeometryTarget::EditorSetting {
                quality: PreviewGeometryQuality::Interactive,
            }
            .resolve_long_edge(3000),
            2000
        );
        assert_eq!(
            PreviewGeometryTarget::LongEdge {
                long_edge_px: 4096,
                quality: PreviewGeometryQuality::Settled,
            }
            .resolve_long_edge(1920),
            4096
        );
    }

    #[test]
    fn preview_geometry_samples_plain_narrow_crop_without_transforming_full_source() {
        let source = DynamicImage::ImageRgb32F(image::ImageBuffer::from_fn(1000, 800, |x, y| {
            image::Rgb([x as f32 / 999.0, y as f32 / 799.0, 0.25])
        }));
        let adjustments = json!({
            "crop": {"x": 400.0, "y": 300.0, "width": 200.0, "height": 100.0},
        });
        let result = compute_direct_crop_preview(&source, &adjustments, 100, None)
            .unwrap()
            .unwrap();
        let preview = result.image;

        assert_eq!(preview.dimensions(), (100, 50));
        assert!((result.effective_scale - 0.5).abs() < 1e-6);
        assert_eq!(result.unscaled_crop_offset, (400.0, 300.0));
        assert_eq!(result.receipt.source_pixel_count, 800_000);
        assert_eq!(result.receipt.working_pixel_count, 20_000);
        assert_eq!(result.receipt.output_pixel_count, 5_000);
        assert_eq!(result.receipt.full_resolution_transform_allocations, 0);
        assert!(result.receipt.direct_crop);
        let center = preview.to_rgb32f().get_pixel(50, 25).0;
        assert!((center[0] - 0.5).abs() < 0.01);
        assert!((center[1] - 0.438).abs() < 0.01);
    }

    #[test]
    fn direct_crop_maps_orientation_and_flip_back_to_source_roi() {
        let source = DynamicImage::ImageRgb32F(image::ImageBuffer::from_fn(300, 200, |x, y| {
            image::Rgb([x as f32 / 299.0, y as f32 / 199.0, 0.5])
        }));
        let adjustments = json!({
            "orientationSteps": 1,
            "flipHorizontal": true,
            "crop": {"x": 40.0, "y": 80.0, "width": 100.0, "height": 120.0},
        });
        let (full, _) = apply_all_transformations(&source, &adjustments);
        let reference = downscale_f32_image(&full, 50, 50).to_rgb32f();
        let result = compute_direct_crop_preview(&source, &adjustments, 50, None)
            .unwrap()
            .unwrap();
        let preview = result.image.to_rgb32f();

        assert_eq!(preview.dimensions(), reference.dimensions());
        assert_eq!(result.receipt.working_pixel_count, 12_000);
        let max_error = preview
            .as_raw()
            .iter()
            .zip(reference.as_raw())
            .map(|(actual, expected)| (actual - expected).abs())
            .fold(0.0_f32, f32::max);
        assert!(max_error < 1e-5, "orientation/flip max error {max_error}");
    }

    #[test]
    fn rotated_narrow_crop_inverse_samples_source_into_preview_only() {
        let source = DynamicImage::ImageRgb32F(image::ImageBuffer::from_fn(600, 400, |x, y| {
            image::Rgb([x as f32 / 599.0, y as f32 / 399.0, 0.5])
        }));
        let adjustments = json!({
            "rotation": 7.0,
            "orientationSteps": 1,
            "flipVertical": true,
            "crop": {"x": 100.0, "y": 160.0, "width": 200.0, "height": 240.0},
        });
        let (full, _) = apply_all_transformations(&source, &adjustments);
        let reference = downscale_f32_image(&full, 100, 100).to_rgb32f();
        let result = compute_direct_crop_preview(&source, &adjustments, 100, None)
            .unwrap()
            .unwrap();
        let preview = result.image.to_rgb32f();

        assert_eq!(preview.dimensions(), reference.dimensions());
        assert_eq!(result.receipt.working_pixel_count, 8_300);
        assert_eq!(result.receipt.full_resolution_transform_allocations, 0);
        let mean_error = preview
            .as_raw()
            .iter()
            .zip(reference.as_raw())
            .map(|(actual, expected)| (actual - expected).abs() as f64)
            .sum::<f64>()
            / preview.as_raw().len() as f64;
        assert!(mean_error < 0.01, "rotated crop mean error {mean_error}");
    }

    #[test]
    fn nonlinear_geometry_narrow_crop_samples_directly_into_preview() {
        let source = DynamicImage::ImageRgb32F(image::ImageBuffer::from_fn(600, 400, |x, y| {
            image::Rgb([x as f32 / 599.0, y as f32 / 399.0, (x + y) as f32 / 998.0])
        }));
        let adjustments = json!({
            "transformVertical": 12.0,
            "transformHorizontal": -7.0,
            "transformDistortion": 4.0,
            "rotation": -3.0,
            "crop": {"x": 180.0, "y": 120.0, "width": 240.0, "height": 160.0},
        });
        let (full, _) = apply_all_transformations(&source, &adjustments);
        let reference = downscale_f32_image(&full, 120, 120).to_rgb32f();
        let result = compute_direct_crop_preview(&source, &adjustments, 120, None)
            .unwrap()
            .unwrap();
        let preview = result.image.to_rgb32f();

        assert_eq!(preview.dimensions(), reference.dimensions());
        assert_eq!(result.receipt.working_pixel_count, 9_600);
        assert_eq!(result.receipt.full_resolution_transform_allocations, 0);
        let mean_error = preview
            .as_raw()
            .iter()
            .zip(reference.as_raw())
            .map(|(actual, expected)| (actual - expected).abs() as f64)
            .sum::<f64>()
            / preview.as_raw().len() as f64;
        assert!(mean_error < 0.015, "nonlinear crop mean error {mean_error}");
    }

    #[test]
    fn nonlinear_preview_cancellation_stops_between_fixed_output_bands() {
        let source = DynamicImage::new_rgb32f(600, 400);
        let adjustments = json!({
            "transformDistortion": 4.0,
            "crop": {"x": 180.0, "y": 120.0, "width": 240.0, "height": 240.0},
        });
        let checks = std::sync::atomic::AtomicUsize::new(0);
        let cancellation = || {
            if checks.fetch_add(1, Ordering::Relaxed) >= 2 {
                Err("preview_cancelled:Geometry".to_string())
            } else {
                Ok(())
            }
        };
        let error = compute_direct_crop_preview(&source, &adjustments, 128, Some(&cancellation))
            .err()
            .expect("third 32-row band checkpoint should cancel the preview");

        assert_eq!(error, "preview_cancelled:Geometry");
        assert_eq!(checks.load(Ordering::Relaxed), 3);
    }

    #[test]
    fn private_raw_preview_geometry_is_target_bounded_when_enabled() {
        if std::env::var("RAWENGINE_RUN_PRIVATE_PREVIEW_GEOMETRY_PROOF").as_deref() != Ok("1") {
            return;
        }
        let source_path = std::env::var("RAWENGINE_PRIVATE_RAW_SOURCE")
            .expect("RAWENGINE_PRIVATE_RAW_SOURCE must select a private RAW");
        let bytes = std::fs::read(&source_path).expect("read private RAW bytes");
        let decoded =
            load_base_image_from_bytes(&bytes, &source_path, false, &AppSettings::default(), None)
                .expect("decode private RAW");
        let (width, height) = decoded.dimensions();
        let crop_width = (width / 3).max(1);
        let crop_height = (height / 3).max(1);
        let adjustments = json!({
            "transformVertical": 11.0,
            "transformHorizontal": -6.0,
            "transformDistortion": 4.0,
            "rotation": 2.5,
            "crop": {
                "x": (width - crop_width) / 2,
                "y": (height - crop_height) / 2,
                "width": crop_width,
                "height": crop_height,
            },
        });
        let started = std::time::Instant::now();
        let result = PreviewGeometryPipeline::execute(PreviewGeometryRequest {
            source: &decoded,
            adjustments: &adjustments,
            target_long_edge: 1920,
            cancellation: None,
        })
        .expect("render private RAW preview geometry");
        let elapsed = started.elapsed();
        eprintln!(
            "private_raw_preview_geometry_proof source={}x{} output={}x{} source_pixels={} working_pixels={} tiles={} elapsed_ms={}",
            width,
            height,
            result.image.width(),
            result.image.height(),
            result.receipt.source_pixel_count,
            result.receipt.working_pixel_count,
            result.receipt.tile_count,
            elapsed.as_millis(),
        );

        assert_eq!(result.image.width().max(result.image.height()), 1920);
        assert_eq!(result.receipt.full_resolution_transform_allocations, 0);
        assert_eq!(
            result.receipt.working_pixel_count,
            result.receipt.output_pixel_count
        );
        assert!(result.receipt.tile_count > 1);
        assert!(
            result.receipt.working_pixel_count * 8 < result.receipt.source_pixel_count,
            "preview work should be far below decoded RAW area: {:?} vs {:?}",
            result.receipt.working_pixel_count,
            result.receipt.source_pixel_count
        );
        assert!(elapsed < Duration::from_secs(10));
    }

    #[test]
    fn normal_preview_does_not_invoke_full_resolution_transform() {
        let source = DynamicImage::new_rgb32f(400, 300);
        let full_transform_count = crate::FULL_TRANSFORM_INVOCATIONS.load(Ordering::Relaxed);
        let result = PreviewGeometryService::execute(PreviewGeometryRequest {
            source: &source,
            adjustments: &json!({}),
            target_long_edge: 100,
            cancellation: None,
        })
        .unwrap();

        assert_eq!(result.image.dimensions(), (100, 75));
        assert_eq!(
            crate::FULL_TRANSFORM_INVOCATIONS.load(Ordering::Relaxed),
            full_transform_count
        );
    }

    #[test]
    fn preview_geometry_receipt_proves_work_scales_with_target_not_source_area() {
        let source = DynamicImage::new_rgb32f(1000, 800);
        let result = PreviewGeometryPipeline::execute(PreviewGeometryRequest {
            source: &source,
            adjustments: &json!({}),
            target_long_edge: 100,
            cancellation: None,
        })
        .unwrap();

        assert_eq!(result.image.dimensions(), (100, 80));
        assert_eq!(result.receipt.source_pixel_count, 800_000);
        assert_eq!(result.receipt.working_pixel_count, 8_000);
        assert_eq!(result.receipt.output_pixel_count, 8_000);
        assert_eq!(result.receipt.full_resolution_transform_allocations, 0);
        assert!(!result.receipt.direct_crop);
    }

    #[test]
    fn preview_geometry_cancels_between_bounded_pipeline_stages() {
        let source = DynamicImage::new_rgb32f(1000, 800);
        let checks = std::sync::atomic::AtomicUsize::new(0);
        let cancellation = || {
            if checks.fetch_add(1, Ordering::Relaxed) >= 1 {
                Err("preview_cancelled:Geometry".to_string())
            } else {
                Ok(())
            }
        };
        let error = PreviewGeometryPipeline::execute(PreviewGeometryRequest {
            source: &source,
            adjustments: &json!({}),
            target_long_edge: 100,
            cancellation: Some(&cancellation),
        })
        .err()
        .expect("second checkpoint should stop obsolete preview work");

        assert_eq!(error, "preview_cancelled:Geometry");
        assert_eq!(checks.load(Ordering::Relaxed), 2);
    }

    #[test]
    fn preview_geometry_scales_pixel_crop_coordinates_once() {
        let adjustments = json!({
            "crop": {"x": 1200.0, "y": 800.0, "width": 4000.0, "height": 3000.0},
            "rotation": 1.5,
            "transformVertical": 12.0,
        });
        let scaled = PreviewGeometryService::scale_adjustments(&adjustments, 0.25);
        assert_eq!(
            scaled["crop"],
            json!({"x": 300.0, "y": 200.0, "width": 1000.0, "height": 750.0})
        );
        assert_eq!(scaled["rotation"], adjustments["rotation"]);
        assert_eq!(
            scaled["transformVertical"],
            adjustments["transformVertical"]
        );
    }

    #[test]
    fn preview_geometry_matches_full_transform_reference_with_bounded_working_output() {
        let source = DynamicImage::ImageRgb32F(image::ImageBuffer::from_fn(400, 300, |x, y| {
            image::Rgb([x as f32 / 399.0, y as f32 / 299.0, (x + y) as f32 / 698.0])
        }));
        let adjustments = json!({
            "rotation": 2.0,
            "flipHorizontal": true,
            "crop": {"x": 100.0, "y": 75.0, "width": 200.0, "height": 150.0},
        });

        let (full, offset) = apply_all_transformations(&source, &adjustments);
        let reference = downscale_f32_image(&full, 100, 100).to_rgb32f();
        let (preview, effective_scale, preview_offset) =
            compute_preview_transformed(&source, &adjustments, 100, None).unwrap();
        let preview = preview.to_rgb32f();

        assert_eq!(preview.dimensions(), reference.dimensions());
        assert!(preview.width() <= 100 && preview.height() <= 100);
        assert!((effective_scale - 0.5).abs() < 1e-6);
        assert_eq!(preview_offset, offset);

        let mean_absolute_error = preview
            .as_raw()
            .iter()
            .zip(reference.as_raw())
            .map(|(actual, expected)| (actual - expected).abs() as f64)
            .sum::<f64>()
            / preview.as_raw().len() as f64;
        assert!(
            mean_absolute_error < 0.015,
            "preview/reference mean absolute error {mean_absolute_error} exceeded tolerance"
        );
    }

    #[test]
    fn preview_geometry_prepares_patch_assets_at_preview_resolution() {
        let source = DynamicImage::new_rgb32f(400, 300);
        let mask = GrayImage::from_pixel(400, 300, Luma([255]));
        let color = RgbImage::from_pixel(400, 300, image::Rgb([255, 0, 0]));
        let adjustments = json!({
            "aiPatches": [{
                "id": "preview-patch",
                "revision": 1,
                "visible": true,
                "patchData": {
                    "mask": encoded_preview_fixture(DynamicImage::ImageLuma8(mask)),
                    "color": encoded_preview_fixture(DynamicImage::ImageRgb8(color)),
                },
                "subMasks": [],
            }],
        });

        let (preview, effective_scale, _) =
            compute_preview_transformed(&source, &adjustments, 100, None).unwrap();
        let preview = preview.to_rgb32f();
        let center = preview.get_pixel(preview.width() / 2, preview.height() / 2);

        assert_eq!(preview.dimensions(), (100, 75));
        assert!((effective_scale - 0.25).abs() < 1e-6);
        assert!(center[0] > 0.99 && center[1] < 0.01 && center[2] < 0.01);
    }

    #[test]
    fn narrow_crop_blends_source_anchored_patch_in_preview_space() {
        let source = DynamicImage::ImageRgb32F(image::ImageBuffer::from_pixel(
            400,
            300,
            image::Rgb([0.1, 0.2, 0.3]),
        ));
        let mask = GrayImage::from_fn(400, 300, |x, _| {
            Luma([((x as f32 / 399.0) * 255.0).round() as u8])
        });
        let color = RgbImage::from_pixel(400, 300, image::Rgb([255, 0, 0]));
        let adjustments = json!({
            "rotation": 3.0,
            "crop": {"x": 100.0, "y": 75.0, "width": 200.0, "height": 150.0},
            "aiPatches": [{
                "id": "mapped-preview-patch",
                "revision": 1,
                "visible": true,
                "patchData": {
                    "mask": encoded_preview_fixture(DynamicImage::ImageLuma8(mask)),
                    "color": encoded_preview_fixture(DynamicImage::ImageRgb8(color)),
                },
                "subMasks": [],
            }],
        });
        let patched = composite_patches_on_image(&source, &adjustments).unwrap();
        let (full, _) = apply_all_transformations(patched, &adjustments);
        let reference = downscale_f32_image(&full, 100, 100).to_rgb32f();
        let result = compute_direct_crop_preview(&source, &adjustments, 100, None)
            .unwrap()
            .unwrap();
        let preview = result.image.to_rgb32f();

        assert_eq!(preview.dimensions(), reference.dimensions());
        assert_eq!(result.receipt.working_pixel_count, 7_500);
        assert_eq!(result.receipt.full_resolution_transform_allocations, 0);
        let mean_error = preview
            .as_raw()
            .iter()
            .zip(reference.as_raw())
            .map(|(actual, expected)| (actual - expected).abs() as f64)
            .sum::<f64>()
            / preview.as_raw().len() as f64;
        assert!(mean_error < 0.02, "mapped patch mean error {mean_error}");
    }
}
