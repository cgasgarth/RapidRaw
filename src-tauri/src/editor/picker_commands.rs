use std::sync::Arc;

use image::DynamicImage;
use serde::{Deserialize, Serialize};

use crate::{AppState, apply_srgb_to_linear, compile_consumer_render_plan, hydrate_adjustments};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ToneEqualizerPlacementResponse {
    source_identity: String,
    source_fingerprint: String,
    pivot_ev: f32,
    range_ev: f32,
    scene_black_ev: f32,
    scene_white_ev: f32,
    confidence: f32,
    histogram: [u32; 32],
}

#[tauri::command]
pub(crate) fn analyze_tone_equalizer_placement(
    expected_source_identity: String,
    state: tauri::State<'_, AppState>,
) -> Result<ToneEqualizerPlacementResponse, String> {
    let (image, source_identity, source_fingerprint, is_raw) = {
        let loaded = state.original_image.lock().unwrap();
        let loaded = loaded.as_ref().ok_or("tone_equalizer.no_source")?;
        if loaded.path != expected_source_identity {
            return Err("tone_equalizer.stale_source".to_string());
        }
        (
            Arc::clone(&loaded.image),
            loaded.path.clone(),
            loaded.artifact_source.source_fingerprint(),
            loaded.is_raw,
        )
    };
    let sample = image.thumbnail(256, 256);
    let sample = if is_raw {
        sample
    } else {
        apply_srgb_to_linear(sample)
    }
    .to_rgba32f();
    let luminance = sample
        .pixels()
        .map(|pixel| crate::tone::tone_equalizer::scene_luminance([pixel[0], pixel[1], pixel[2]]))
        .collect::<Vec<_>>();
    let placement = crate::tone::tone_equalizer::auto_place_from_luminance(&luminance, 0.18)
        .ok_or("tone_equalizer.insufficient_scene_samples")?;
    let histogram = tone_equalizer_histogram(luminance);
    let current_source = state.original_image.lock().unwrap().as_ref().map(|loaded| {
        (
            loaded.path.clone(),
            loaded.artifact_source.source_fingerprint(),
        )
    });
    if current_source != Some((source_identity.clone(), source_fingerprint)) {
        return Err("tone_equalizer.stale_source".to_string());
    }
    Ok(ToneEqualizerPlacementResponse {
        source_identity,
        source_fingerprint: format!("{source_fingerprint:016x}"),
        pivot_ev: placement.pivot_ev,
        range_ev: placement.range_ev,
        scene_black_ev: placement.scene_black_ev,
        scene_white_ev: placement.scene_white_ev,
        confidence: placement.confidence,
        histogram,
    })
}

fn tone_equalizer_histogram(luminance: impl IntoIterator<Item = f32>) -> [u32; 32] {
    let mut histogram = [0_u32; 32];
    for value in luminance {
        if !value.is_finite() || value <= 1.0e-8 {
            continue;
        }
        let ev = (value / 0.18).log2();
        let bin = (((ev + 12.0) / 24.0) * histogram.len() as f32)
            .floor()
            .clamp(0.0, (histogram.len() - 1) as f32) as usize;
        histogram[bin] += 1;
    }
    histogram
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
struct ViewerSamplePoint {
    x: f64,
    y: f64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ToneEqualizerPickerRequest {
    graph_revision: String,
    source_identity: String,
    normalized_image_point: ViewerSamplePoint,
    js_adjustments: serde_json::Value,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ToneEqualizerPickerResponse {
    source_identity: String,
    source_fingerprint: String,
    graph_fingerprint: String,
    graph_revision: String,
    exposure_ev: f32,
    contributing_weights: [f32; crate::tone::tone_equalizer::TONE_EQ_BANDS],
    primary_band: u32,
}

#[tauri::command]
pub(crate) fn sample_tone_equalizer_picker(
    request: ToneEqualizerPickerRequest,
    state: tauri::State<'_, AppState>,
) -> Result<ToneEqualizerPickerResponse, String> {
    if request.graph_revision.trim().is_empty() {
        return Err("tone_equalizer.picker_missing_graph_revision".to_string());
    }
    let loaded = state
        .original_image
        .lock()
        .unwrap()
        .clone()
        .ok_or("tone_equalizer.no_source")?;
    if loaded.path != request.source_identity {
        return Err("tone_equalizer.stale_source".to_string());
    }
    let source_fingerprint = loaded.artifact_source.source_fingerprint();
    let mut adjustments = request.js_adjustments;
    hydrate_adjustments(&state, &mut adjustments);
    let render_plan =
        compile_consumer_render_plan(&adjustments, &loaded.path, loaded.is_raw, None, None)?;
    let sample = crate::render::cpu_edit_graph::sample_tone_equalizer_coordinate(
        loaded.image.as_ref(),
        &render_plan.edit_graph,
        request.normalized_image_point.x,
        request.normalized_image_point.y,
    )
    .map_err(str::to_string)?;
    ensure_current_source(
        &state,
        &request.source_identity,
        source_fingerprint,
        "tone_equalizer",
    )?;
    Ok(ToneEqualizerPickerResponse {
        source_identity: request.source_identity,
        source_fingerprint: format!("{source_fingerprint:016x}"),
        graph_fingerprint: format!("{:016x}", render_plan.edit_graph.fingerprint),
        graph_revision: request.graph_revision,
        exposure_ev: sample.exposure_ev,
        contributing_weights: sample.contributing_weights,
        primary_band: sample.primary_band,
    })
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PointColorPickerRequest {
    graph_revision: String,
    source_identity: String,
    normalized_image_point: ViewerSamplePoint,
    js_adjustments: serde_json::Value,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PointColorPickerResponse {
    source_identity: String,
    source_fingerprint: String,
    graph_fingerprint: String,
    graph_revision: String,
    lightness: f32,
    chroma: f32,
    hue_degrees: f32,
    confidence: f32,
    sample_radius_px: u32,
}

#[derive(Clone, Copy, Debug, PartialEq)]
struct PointColorPatchSample {
    color: crate::color::point_color::PerceptualColorCoordinate,
    confidence: f32,
    sample_radius_px: u32,
}

#[tauri::command]
pub(crate) fn sample_point_color_picker(
    request: PointColorPickerRequest,
    state: tauri::State<'_, AppState>,
) -> Result<PointColorPickerResponse, String> {
    if request.graph_revision.trim().is_empty() {
        return Err("point_color.picker_missing_graph_revision".to_string());
    }
    let loaded = state
        .original_image
        .lock()
        .unwrap()
        .clone()
        .ok_or("point_color.no_source")?;
    if loaded.path != request.source_identity {
        return Err("point_color.stale_source".to_string());
    }
    let source_fingerprint = loaded.artifact_source.source_fingerprint();
    let mut adjustments = request.js_adjustments;
    hydrate_adjustments(&state, &mut adjustments);
    let render_plan =
        compile_consumer_render_plan(&adjustments, &loaded.path, loaded.is_raw, None, None)?;
    let sample = sample_point_color_patch(
        loaded.image.as_ref(),
        request.normalized_image_point.x,
        request.normalized_image_point.y,
    )?;
    ensure_current_source(
        &state,
        &request.source_identity,
        source_fingerprint,
        "point_color",
    )?;
    Ok(PointColorPickerResponse {
        source_identity: request.source_identity,
        source_fingerprint: format!("{source_fingerprint:016x}"),
        graph_fingerprint: format!("{:016x}", render_plan.edit_graph.fingerprint),
        graph_revision: request.graph_revision,
        lightness: sample.color.lightness,
        chroma: sample.color.chroma,
        hue_degrees: sample.color.hue_degrees,
        confidence: sample.confidence,
        sample_radius_px: sample.sample_radius_px,
    })
}

fn ensure_current_source(
    state: &AppState,
    expected_identity: &str,
    expected_fingerprint: u64,
    error_prefix: &str,
) -> Result<(), String> {
    let current_source = state
        .original_image
        .lock()
        .unwrap()
        .as_ref()
        .map(|current| {
            (
                current.path.clone(),
                current.artifact_source.source_fingerprint(),
            )
        });
    if current_source == Some((expected_identity.to_string(), expected_fingerprint)) {
        Ok(())
    } else {
        Err(format!("{error_prefix}.stale_source"))
    }
}

fn sample_point_color_patch(
    image: &DynamicImage,
    normalized_x: f64,
    normalized_y: f64,
) -> Result<PointColorPatchSample, String> {
    if !normalized_x.is_finite()
        || !normalized_y.is_finite()
        || !(0.0..=1.0).contains(&normalized_x)
        || !(0.0..=1.0).contains(&normalized_y)
    {
        return Err("point_color.picker_invalid_point".to_string());
    }
    let source = image.to_rgba32f();
    let (width, height) = source.dimensions();
    if width == 0 || height == 0 {
        return Err("point_color.invalid_sample".to_string());
    }
    let center_x = (normalized_x * f64::from(width - 1)).round() as i32;
    let center_y = (normalized_y * f64::from(height - 1)).round() as i32;
    let sample_radius_px = 2_u32;
    let mut samples = Vec::with_capacity(25);
    for y in (center_y - 2)..=(center_y + 2) {
        for x in (center_x - 2)..=(center_x + 2) {
            if x < 0 || y < 0 || x >= width as i32 || y >= height as i32 {
                continue;
            }
            let pixel = source.get_pixel(x as u32, y as u32).0;
            let color = crate::color::point_color::ap1_to_oklch([pixel[0], pixel[1], pixel[2]]);
            if color.lightness.is_finite() && color.chroma.is_finite() {
                samples.push(color);
            }
        }
    }
    if samples.is_empty() {
        return Err("point_color.invalid_sample".to_string());
    }
    samples.sort_by(|left, right| left.lightness.total_cmp(&right.lightness));
    let lightness = samples[samples.len() / 2].lightness;
    samples.sort_by(|left, right| left.chroma.total_cmp(&right.chroma));
    let chroma = samples[samples.len() / 2].chroma;
    let (hue_x, hue_y) = samples.iter().fold((0.0_f32, 0.0_f32), |(x, y), sample| {
        let weight = sample.chroma.max(0.001);
        (
            x + sample.hue_degrees.to_radians().cos() * weight,
            y + sample.hue_degrees.to_radians().sin() * weight,
        )
    });
    let hue_degrees = hue_y.atan2(hue_x).to_degrees().rem_euclid(360.0);
    let spread = samples
        .iter()
        .map(|sample| (sample.lightness - lightness).abs() + (sample.chroma - chroma).abs())
        .sum::<f32>()
        / samples.len() as f32;
    let confidence = (1.0 - spread * 4.0).clamp(0.0, 1.0)
        * if lightness < 0.01 || chroma < 0.003 {
            0.25
        } else {
            1.0
        };
    Ok(PointColorPatchSample {
        color: crate::color::point_color::PerceptualColorCoordinate {
            lightness,
            chroma,
            hue_degrees,
        },
        confidence,
        sample_radius_px,
    })
}

#[cfg(test)]
mod tests {
    use image::{ImageBuffer, Rgba};

    use super::*;

    #[test]
    fn point_color_rejects_non_finite_and_out_of_bounds_coordinates() {
        let image = DynamicImage::new_rgba32f(4, 4);
        for (x, y) in [(-0.1, 0.5), (1.1, 0.5), (0.5, f64::NAN)] {
            assert_eq!(
                sample_point_color_patch(&image, x, y).unwrap_err(),
                "point_color.picker_invalid_point"
            );
        }
    }

    #[test]
    fn point_color_uniform_patch_matches_ap1_reference_at_edges() {
        let rgb = [0.32_f32, 0.18, 0.07];
        let image = DynamicImage::ImageRgba32F(ImageBuffer::from_pixel(
            3,
            3,
            Rgba([rgb[0], rgb[1], rgb[2], 1.0]),
        ));
        let expected = crate::color::point_color::ap1_to_oklch(rgb);

        for (x, y) in [(0.0, 0.0), (0.5, 0.5), (1.0, 1.0)] {
            let sample = sample_point_color_patch(&image, x, y).unwrap();
            assert!((sample.color.lightness - expected.lightness).abs() < 1.0e-6);
            assert!((sample.color.chroma - expected.chroma).abs() < 1.0e-6);
            assert!((sample.color.hue_degrees - expected.hue_degrees).abs() < 1.0e-4);
            assert!((sample.confidence - 1.0).abs() < 1.0e-6);
        }
    }

    #[test]
    fn tone_equalizer_histogram_ignores_invalid_values_and_clamps_extremes() {
        let histogram = tone_equalizer_histogram([
            f32::NAN,
            -1.0,
            0.0,
            0.18 * 2.0_f32.powi(-20),
            0.18,
            0.18 * 2.0_f32.powi(20),
        ]);
        assert_eq!(histogram.iter().sum::<u32>(), 3);
        assert_eq!(histogram[0], 1);
        assert_eq!(histogram[16], 1);
        assert_eq!(histogram[31], 1);
    }
}
