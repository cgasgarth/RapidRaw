use super::{
    blend::{BlendResult, POLICY_ID},
    labels::{FocusMaps, INVALID},
    pyramid, warp,
};

#[derive(Clone, Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct NativeBlendReview {
    pub proof_level: &'static str,
    pub blend_policy_id: &'static str,
    pub pyramid_policy_id: &'static str,
    pub deterministic_backend: &'static str,
    pub pyramid_levels: usize,
    pub effective_owner_radius_px: u32,
    pub owner_expanded_pixel_ratio: f32,
    pub preview_data_url: String,
    pub contribution_overlay_data_url: String,
    pub edge_owner_overlay_data_url: String,
    pub fallback_overlay_data_url: String,
    pub halo_risk_overlay_data_url: String,
    pub preview_hash: String,
    pub contribution_hash: String,
    pub edge_owner_hash: String,
    pub fallback_hash: String,
    pub halo_risk_hash: String,
    pub blend_result_hash: String,
    pub fallback_ratio: f32,
    pub low_confidence_ratio: f32,
    pub halo_risk_ratio: f32,
    pub edge_owner_ambiguity_ratio: f32,
    pub source_contributions: Vec<Contribution>,
    pub retouch_seed: RetouchSeed,
}
#[derive(Clone, Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Contribution {
    pub source_index: usize,
    pub area_ratio: f32,
}
#[derive(Clone, Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RetouchSeed {
    pub content_hash: String,
    pub regions: Vec<RetouchRegion>,
}
#[derive(Clone, Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RetouchRegion {
    pub x: u32,
    pub y: u32,
    pub width: u32,
    pub height: u32,
    pub mask_hash: String,
    pub current_owner_source: usize,
    pub alternate_sources: Vec<usize>,
    pub reason_codes: Vec<&'static str>,
    pub confidence: f32,
}

pub(crate) fn build(
    result: &BlendResult,
    maps: &FocusMaps,
    map_hash: &str,
    input_hash: &str,
) -> Result<NativeBlendReview, String> {
    let count = result.pixels.len();
    let width = result.width as usize;
    let preview = encode_rgb(result)?;
    let contribution = encode_map(result, |i| color(result.edge_owner[i] as usize, 210))?;
    let owners = encode_map(result, |i| {
        if result.edge_owner[i] == INVALID {
            [0., 0., 0., 0.]
        } else {
            color(result.edge_owner[i] as usize, 255)
        }
    })?;
    let fallback = encode_map(result, |i| {
        if result.fallback[i] != 0 {
            [1., 0.65, 0., 0.85]
        } else {
            [0., 0., 0., 0.]
        }
    })?;
    let halo = encode_map(result, |i| {
        if result.halo_risk[i] != 0 {
            [1., 0., 0.2, 0.9]
        } else {
            [0., 0., 0., 0.]
        }
    })?;
    let hashes = [&preview, &contribution, &owners, &fallback, &halo]
        .map(|v| format!("blake3:{}", blake3::hash(v).to_hex()));
    let source_contributions = result
        .weights
        .iter()
        .enumerate()
        .map(|(source, w)| Contribution {
            source_index: result.source_indices[source],
            area_ratio: w.iter().sum::<f32>() / count as f32,
        })
        .collect();
    let regions = (0..count)
        .filter(|i| {
            result.halo_risk[*i] != 0
                || maps.label_confidence[*i] < 0.25
                || result.fallback[*i] != 0
        })
        .step_by(64)
        .take(128)
        .map(|i| {
            let x = (i % width) as u32;
            let y = (i / width) as u32;
            let owner = result.edge_owner[i];
            let mut reasons = Vec::new();
            if maps.label_confidence[i] < 0.25 {
                reasons.push("low_margin");
            }
            if maps.occlusion_risk[i] != 0 {
                reasons.push("occlusion_risk");
            }
            if maps.alignment_risk[i] != 0 {
                reasons.push("alignment_risk");
            }
            if result.fallback[i] != 0 {
                reasons.push("invalid_owner");
            }
            if result.halo_risk[i] != 0 {
                reasons.push("halo_overshoot");
            }
            let alternates = [maps.runner_up_source[i], maps.winner_source[i]]
                .into_iter()
                .filter(|s| *s != INVALID && *s != owner)
                .map(|s| s as usize)
                .collect::<Vec<_>>();
            let mask_hash = format!(
                "blake3:{}",
                blake3::hash(format!("{input_hash}:{map_hash}:{x}:{y}").as_bytes()).to_hex()
            );
            RetouchRegion {
                x,
                y,
                width: 16.min(result.width - x),
                height: 16.min(result.height - y),
                mask_hash,
                current_owner_source: if owner == INVALID { 0 } else { owner as usize },
                alternate_sources: alternates,
                reason_codes: reasons,
                confidence: maps.label_confidence[i],
            }
        })
        .collect::<Vec<_>>();
    let seed_bytes = serde_json::to_vec(&regions).map_err(|e| e.to_string())?;
    let seed = RetouchSeed {
        content_hash: format!("blake3:{}", blake3::hash(&seed_bytes).to_hex()),
        regions,
    };
    let canonical = serde_json::to_vec(&(
        input_hash,
        map_hash,
        POLICY_ID,
        pyramid::POLICY_ID,
        &hashes,
        &seed.content_hash,
    ))
    .map_err(|e| e.to_string())?;
    Ok(NativeBlendReview {
        proof_level: "native_measured_v1",
        blend_policy_id: POLICY_ID,
        pyramid_policy_id: pyramid::POLICY_ID,
        deterministic_backend: "cpu_f32_row_major_no_fast_math",
        pyramid_levels: result.levels,
        effective_owner_radius_px: result.effective_owner_radius_px,
        owner_expanded_pixel_ratio: result.owner_expanded_pixels as f32 / count as f32,
        preview_data_url: warp::data_url(&preview),
        contribution_overlay_data_url: warp::data_url(&contribution),
        edge_owner_overlay_data_url: warp::data_url(&owners),
        fallback_overlay_data_url: warp::data_url(&fallback),
        halo_risk_overlay_data_url: warp::data_url(&halo),
        preview_hash: hashes[0].clone(),
        contribution_hash: hashes[1].clone(),
        edge_owner_hash: hashes[2].clone(),
        fallback_hash: hashes[3].clone(),
        halo_risk_hash: hashes[4].clone(),
        blend_result_hash: format!("blake3:{}", blake3::hash(&canonical).to_hex()),
        fallback_ratio: ratio(&result.fallback),
        low_confidence_ratio: maps.label_confidence.iter().filter(|v| **v < 0.25).count() as f32
            / count as f32,
        halo_risk_ratio: ratio(&result.halo_risk),
        edge_owner_ambiguity_ratio: ratio(&result.ownership_ambiguous),
        source_contributions,
        retouch_seed: seed,
    })
}
fn ratio(v: &[u8]) -> f32 {
    v.iter().filter(|v| **v != 0).count() as f32 / v.len() as f32
}
fn color(i: usize, a: u8) -> [f32; 4] {
    let c = [
        [0.1, 0.75, 0.95],
        [0.95, 0.35, 0.25],
        [0.3, 0.85, 0.35],
        [0.9, 0.75, 0.15],
        [0.65, 0.35, 0.9],
    ][i % 5];
    [c[0], c[1], c[2], a as f32 / 255.]
}
fn encode_rgb(r: &BlendResult) -> Result<Vec<u8>, String> {
    warp::encode(
        &r.pixels
            .iter()
            .map(|p| [display(p[0]), display(p[1]), display(p[2]), 1.])
            .collect::<Vec<_>>(),
        r.width,
        r.height,
    )
}
fn display(v: f32) -> f32 {
    v.max(0.).powf(1. / 2.2)
}
fn encode_map(r: &BlendResult, f: impl Fn(usize) -> [f32; 4]) -> Result<Vec<u8>, String> {
    warp::encode(
        &(0..r.pixels.len()).map(f).collect::<Vec<_>>(),
        r.width,
        r.height,
    )
}
