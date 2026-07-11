use std::io::Cursor;

use base64::Engine;
use image::{ImageFormat, Rgba, RgbaImage};

use super::labels::{FocusMaps, INVALID};

const MAGIC: &[u8; 8] = b"RRFSMAP\0";
const VERSION: u16 = 1;
const CHANNELS: [&str; 12] = [
    "winner_source",
    "runner_up_source",
    "winner_response",
    "runner_up_response",
    "winner_margin",
    "label_confidence",
    "valid_source_count",
    "low_texture",
    "clipped_or_defective",
    "alignment_risk",
    "occlusion_risk",
    "fallback_required",
];

#[derive(Clone, Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct FocusMapArtifact {
    pub format_id: &'static str,
    pub version: u16,
    pub width: u32,
    pub height: u32,
    pub coordinate_identity: String,
    pub endianness: &'static str,
    pub channels: Vec<&'static str>,
    pub content_hash: String,
    pub bytes_base64: String,
    pub algorithm_identity: String,
    pub winner_overlay_data_url: String,
    pub confidence_overlay_data_url: String,
    pub risk_overlay_data_url: String,
}

#[derive(Clone, Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct FocusEvidenceMetrics {
    pub labeled_pixel_count: u64,
    pub focus_coverage_ratio: f32,
    pub low_confidence_ratio: f32,
    pub invalid_ratio: f32,
    pub transition_risk_ratio: f32,
    pub label_fragmentation: u64,
    pub changed_pixel_count: u64,
    pub source_contributions: Vec<SourceContribution>,
}

#[derive(Clone, Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SourceContribution {
    pub source_index: u16,
    pub pixel_count: u64,
    pub area_ratio: f32,
}

pub(crate) fn build(
    maps: &FocusMaps,
    coordinate_identity: &str,
    algorithm_identity: &str,
    source_count: usize,
) -> Result<(FocusMapArtifact, FocusEvidenceMetrics), String> {
    let bytes = encode(maps, coordinate_identity, algorithm_identity);
    decode(&bytes, source_count)?;
    let hash = format!("blake3:{}", blake3::hash(&bytes).to_hex());
    let winner = overlay(maps, Overlay::Winner)?;
    let confidence = overlay(maps, Overlay::Confidence)?;
    let risk = overlay(maps, Overlay::Risk)?;
    Ok((
        FocusMapArtifact {
            format_id: "rapidraw_focus_map_v1",
            version: VERSION,
            width: maps.width,
            height: maps.height,
            coordinate_identity: coordinate_identity.into(),
            endianness: "little",
            channels: CHANNELS.to_vec(),
            content_hash: hash,
            bytes_base64: base64::engine::general_purpose::STANDARD.encode(bytes),
            algorithm_identity: algorithm_identity.into(),
            winner_overlay_data_url: data_url(&winner),
            confidence_overlay_data_url: data_url(&confidence),
            risk_overlay_data_url: data_url(&risk),
        },
        metrics(maps, source_count),
    ))
}

fn encode(m: &FocusMaps, coordinate: &str, algorithm: &str) -> Vec<u8> {
    let mut out = Vec::new();
    out.extend_from_slice(MAGIC);
    out.extend_from_slice(&VERSION.to_le_bytes());
    out.extend_from_slice(&m.width.to_le_bytes());
    out.extend_from_slice(&m.height.to_le_bytes());
    out.extend_from_slice(&blake3::hash(coordinate.as_bytes()).as_bytes()[..]);
    out.extend_from_slice(&blake3::hash(algorithm.as_bytes()).as_bytes()[..]);
    out.extend_from_slice(&(CHANNELS.len() as u16).to_le_bytes());
    for values in [&m.winner_source, &m.runner_up_source, &m.valid_source_count] {
        for value in values {
            out.extend_from_slice(&value.to_le_bytes());
        }
    }
    for values in [
        &m.winner_response,
        &m.runner_up_response,
        &m.winner_margin,
        &m.label_confidence,
    ] {
        for value in values {
            out.extend_from_slice(&value.to_le_bytes());
        }
    }
    for values in [
        &m.low_texture,
        &m.clipped_or_defective,
        &m.alignment_risk,
        &m.occlusion_risk,
        &m.fallback_required,
    ] {
        out.extend_from_slice(values);
    }
    out
}

pub(crate) fn decode(bytes: &[u8], source_count: usize) -> Result<(), String> {
    const HEADER: usize = 8 + 2 + 4 + 4 + 32 + 32 + 2;
    if bytes.len() < HEADER {
        return Err("focus_map_truncated_header".into());
    }
    if &bytes[..8] != MAGIC {
        return Err("focus_map_wrong_magic".into());
    }
    let version = u16::from_le_bytes([bytes[8], bytes[9]]);
    if version != VERSION {
        return Err("focus_map_wrong_version".into());
    }
    let width =
        u32::from_le_bytes(bytes[10..14].try_into().map_err(|_| "focus_map_header")?) as usize;
    let height =
        u32::from_le_bytes(bytes[14..18].try_into().map_err(|_| "focus_map_header")?) as usize;
    let pixels = width.checked_mul(height).ok_or("focus_map_oversized")?;
    if pixels > 100_000_000 {
        return Err("focus_map_oversized".into());
    }
    if u16::from_le_bytes([bytes[82], bytes[83]]) as usize != CHANNELS.len() {
        return Err("focus_map_channel_mismatch".into());
    }
    let expected = HEADER
        .checked_add(
            pixels
                .checked_mul(3 * 2 + 4 * 4 + 5)
                .ok_or("focus_map_oversized")?,
        )
        .ok_or("focus_map_oversized")?;
    if bytes.len() != expected {
        return Err("focus_map_length_mismatch".into());
    }
    let labels = &bytes[HEADER..HEADER + pixels * 2];
    for raw in labels.chunks_exact(2) {
        let label = u16::from_le_bytes([raw[0], raw[1]]);
        if label != INVALID && label as usize >= source_count {
            return Err("focus_map_label_out_of_range".into());
        }
    }
    let float_start = HEADER + pixels * 3 * 2;
    for raw in bytes[float_start..float_start + pixels * 4 * 4].chunks_exact(4) {
        let value = f32::from_le_bytes(raw.try_into().map_err(|_| "focus_map_float")?);
        if !value.is_finite() || value < 0.0 {
            return Err("focus_map_nonfinite_or_negative".into());
        }
    }
    let bounded_start = float_start + pixels * 2 * 4;
    for raw in bytes[bounded_start..bounded_start + pixels * 2 * 4].chunks_exact(4) {
        let value = f32::from_le_bytes(raw.try_into().map_err(|_| "focus_map_float")?);
        if value > 1.0 {
            return Err("focus_map_unit_range".into());
        }
    }
    Ok(())
}

fn metrics(m: &FocusMaps, source_count: usize) -> FocusEvidenceMetrics {
    let total = m.winner_source.len().max(1) as f32;
    let labeled = m.winner_source.iter().filter(|v| **v != INVALID).count();
    let low = m.label_confidence.iter().filter(|v| **v < 0.12).count();
    let invalid = m.fallback_required.iter().filter(|v| **v != 0).count();
    let risk = m
        .occlusion_risk
        .iter()
        .zip(&m.alignment_risk)
        .filter(|(a, b)| **a != 0 || **b != 0)
        .count();
    let source_contributions = (0..source_count)
        .map(|source| {
            let count = m
                .winner_source
                .iter()
                .filter(|v| **v == source as u16)
                .count();
            SourceContribution {
                source_index: source as u16,
                pixel_count: count as u64,
                area_ratio: count as f32 / total,
            }
        })
        .collect();
    FocusEvidenceMetrics {
        labeled_pixel_count: labeled as u64,
        focus_coverage_ratio: labeled as f32 / total,
        low_confidence_ratio: low as f32 / total,
        invalid_ratio: invalid as f32 / total,
        transition_risk_ratio: risk as f32 / total,
        label_fragmentation: fragmentation(m),
        changed_pixel_count: m.changed_pixel_count,
        source_contributions,
    }
}

fn fragmentation(m: &FocusMaps) -> u64 {
    let w = m.width as usize;
    let mut changes = 0;
    for i in 0..m.winner_source.len() {
        if i % w > 0 && m.winner_source[i] != m.winner_source[i - 1] {
            changes += 1
        }
        if i >= w && m.winner_source[i] != m.winner_source[i - w] {
            changes += 1
        }
    }
    changes
}
enum Overlay {
    Winner,
    Confidence,
    Risk,
}
fn overlay(m: &FocusMaps, mode: Overlay) -> Result<Vec<u8>, String> {
    let image = RgbaImage::from_fn(m.width, m.height, |x, y| {
        let i = y as usize * m.width as usize + x as usize;
        match mode {
            Overlay::Winner => {
                let label = m.winner_source[i];
                if label == INVALID {
                    Rgba([0, 0, 0, 0])
                } else {
                    let h = blake3::hash(&label.to_le_bytes());
                    Rgba([h.as_bytes()[0], h.as_bytes()[1], h.as_bytes()[2], 210])
                }
            }
            Overlay::Confidence => {
                let value = (m.label_confidence[i] * 255.0).round() as u8;
                Rgba([255 - value, value, 40, 220])
            }
            Overlay::Risk => {
                if m.occlusion_risk[i] != 0 || m.alignment_risk[i] != 0 {
                    Rgba([235, 55, 45, 220])
                } else if m.fallback_required[i] != 0 {
                    Rgba([245, 170, 30, 200])
                } else {
                    Rgba([0, 0, 0, 0])
                }
            }
        }
    });
    let mut cursor = Cursor::new(Vec::new());
    image
        .write_to(&mut cursor, ImageFormat::Png)
        .map_err(|e| e.to_string())?;
    Ok(cursor.into_inner())
}
fn data_url(bytes: &[u8]) -> String {
    format!(
        "data:image/png;base64,{}",
        base64::engine::general_purpose::STANDARD.encode(bytes)
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn decoder_rejects_corruption() {
        let maps = FocusMaps {
            width: 1,
            height: 1,
            winner_source: vec![0],
            runner_up_source: vec![1],
            winner_response: vec![2.0],
            runner_up_response: vec![1.0],
            winner_margin: vec![0.5],
            label_confidence: vec![0.4],
            valid_source_count: vec![2],
            low_texture: vec![0],
            clipped_or_defective: vec![0],
            alignment_risk: vec![0],
            occlusion_risk: vec![0],
            fallback_required: vec![0],
            changed_pixel_count: 0,
        };
        let bytes = encode(&maps, "crop", "algorithm");
        assert!(decode(&bytes, 2).is_ok());
        assert_eq!(
            decode(&bytes[..bytes.len() - 1], 2).unwrap_err(),
            "focus_map_length_mismatch"
        );
        let mut bad = bytes.clone();
        bad[8] = 2;
        assert_eq!(decode(&bad, 2).unwrap_err(), "focus_map_wrong_version");
        let mut label = bytes;
        label[84..86].copy_from_slice(&3u16.to_le_bytes());
        assert_eq!(
            decode(&label, 2).unwrap_err(),
            "focus_map_label_out_of_range"
        );
    }
}
