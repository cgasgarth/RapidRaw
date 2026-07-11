use image::GenericImageView;

use crate::merge::hdr::source_frame;

pub(crate) const PROXY_ID: &str = "focus_luma_proxy_v1";

#[derive(Clone, Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RectU32 {
    pub x: u32,
    pub y: u32,
    pub width: u32,
    pub height: u32,
}

#[derive(Clone, Debug)]
pub(crate) struct DecodedFocusSource {
    pub source_index: usize,
    pub path_handle: String,
    pub source_kind: &'static str,
    pub content_hash: String,
    pub graph_revision: String,
    pub width: u32,
    pub height: u32,
    pub active_area: RectU32,
    pub orientation: String,
    pub camera_make: String,
    pub camera_model: String,
    pub lens_model: Option<String>,
    pub focal_length_mm: Option<f32>,
    pub aperture: Option<f32>,
    pub focus_distance_mm: Option<f32>,
    pub exposure_ev: Option<f32>,
    pub iso: Option<u32>,
    pub calibration_identity: String,
    pub render_identity: &'static str,
    pub cfa_pattern: Option<String>,
    pub clipping_ratio: f32,
    pub finite_pixel_ratio: f32,
    pub noise: f32,
    pub proxy_hash: String,
    pub warnings: Vec<String>,
}

pub(crate) fn decode(
    path: &str,
    path_handle: String,
    graph_revision: String,
    source_index: usize,
) -> Result<DecodedFocusSource, String> {
    if crate::formats::is_raw_file(path) {
        let frame = source_frame::decode_focus_source(path, source_index)?;
        let finite = frame
            .proxy
            .pixels
            .iter()
            .filter(|value| value.is_finite())
            .count();
        let clipping = frame
            .color_proxy
            .clipped
            .iter()
            .filter(|channels| channels.iter().any(|value| *value))
            .count();
        let calibration =
            serde_json::to_vec(&frame.calibration).map_err(|error| error.to_string())?;
        let noise = robust_noise(&frame.proxy.pixels, frame.proxy.width);
        let focus_distance_mm = frame.focus_distance_mm;
        return Ok(DecodedFocusSource {
            source_index,
            path_handle,
            source_kind: "raw_sensor_source",
            content_hash: frame.content_hash,
            graph_revision,
            width: frame.width as u32,
            height: frame.height as u32,
            active_area: RectU32 {
                x: frame.active_area.x as u32,
                y: frame.active_area.y as u32,
                width: frame.active_area.width as u32,
                height: frame.active_area.height as u32,
            },
            orientation: frame.orientation,
            camera_make: frame.camera_make,
            camera_model: frame.camera_model,
            lens_model: Some(frame.lens_model),
            focal_length_mm: frame
                .focal_length_mm
                .is_finite()
                .then_some(frame.focal_length_mm),
            aperture: frame
                .exposure
                .aperture
                .is_finite()
                .then_some(frame.exposure.aperture),
            focus_distance_mm,
            exposure_ev: frame
                .exposure
                .exposure_scale
                .is_finite()
                .then(|| frame.exposure.exposure_scale.log2()),
            iso: frame
                .exposure
                .iso
                .is_finite()
                .then_some(frame.exposure.iso.round() as u32),
            calibration_identity: format!("blake3:{}", blake3::hash(&calibration).to_hex()),
            render_identity: "focus_raw_scene_linear_v1",
            cfa_pattern: Some(frame.cfa_pattern),
            clipping_ratio: clipping as f32 / frame.color_proxy.clipped.len().max(1) as f32,
            finite_pixel_ratio: finite as f32 / frame.proxy.pixels.len().max(1) as f32,
            noise,
            proxy_hash: frame.proxy_hash,
            warnings: if focus_distance_mm.is_some() {
                Vec::new()
            } else {
                vec!["focus_distance_metadata_unavailable".to_string()]
            },
        });
    }
    let bytes = std::fs::read(path).map_err(|error| format!("source_read_failed:{error}"))?;
    let image = image::load_from_memory(&bytes)
        .map_err(|error| format!("rendered_decode_failed:{error}"))?;
    let (width, height) = image.dimensions();
    let pixels = image.to_rgb32f();
    let luma = pixels
        .pixels()
        .map(|pixel| pixel[0] * 0.2126 + pixel[1] * 0.7152 + pixel[2] * 0.0722)
        .collect::<Vec<_>>();
    let finite = luma.iter().filter(|value| value.is_finite()).count();
    let clipping = pixels
        .pixels()
        .filter(|pixel| pixel.0.iter().any(|value| *value >= 0.995))
        .count();
    let proxy_bytes = luma
        .iter()
        .flat_map(|value| value.to_le_bytes())
        .collect::<Vec<_>>();
    Ok(DecodedFocusSource {
        source_index,
        path_handle,
        source_kind: "rendered_rgb_source",
        content_hash: format!("blake3:{}", blake3::hash(&bytes).to_hex()),
        graph_revision,
        width,
        height,
        active_area: RectU32 {
            x: 0,
            y: 0,
            width,
            height,
        },
        orientation: "Normal".to_string(),
        camera_make: "rendered".to_string(),
        camera_model: "rendered_rgb".to_string(),
        lens_model: None,
        focal_length_mm: None,
        aperture: None,
        focus_distance_mm: None,
        exposure_ev: None,
        iso: None,
        calibration_identity: "rendered_srgb_declared_v1".to_string(),
        render_identity: "rendered_rgb_scene_linear_v1",
        cfa_pattern: None,
        clipping_ratio: clipping as f32 / luma.len().max(1) as f32,
        finite_pixel_ratio: finite as f32 / luma.len().max(1) as f32,
        noise: robust_noise(&luma, width as usize),
        proxy_hash: format!("blake3:{}", blake3::hash(&proxy_bytes).to_hex()),
        warnings: vec![
            "focus_distance_metadata_unavailable".to_string(),
            "rendered_rgb_source".to_string(),
        ],
    })
}

fn robust_noise(values: &[f32], width: usize) -> f32 {
    let mut differences = values
        .iter()
        .enumerate()
        .filter_map(|(index, value)| {
            (width > 1 && index % width + 1 < width)
                .then(|| (*value - values[index + 1]).abs())
                .filter(|value| value.is_finite())
        })
        .collect::<Vec<_>>();
    differences.sort_by(f32::total_cmp);
    differences
        .get(differences.len() / 2)
        .copied()
        .unwrap_or(0.0)
        / 0.6745
}
