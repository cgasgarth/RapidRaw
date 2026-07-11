use serde::Serialize;

use super::reconstruction::PlaneTile;
use super::support::SupportClass;

pub const SR_MOTION_ALGORITHM_ID: &str = "cfa_block_residual_motion_v1";
const BLOCK_SIZE: u32 = 8;
const MOTION_RESIDUAL: f32 = 3.5;
const EDGE_RISK: f32 = 0.22;
const NOISE_LIMIT: f32 = 0.012;

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum RegionClass {
    SupportedStatic,
    WeakSupport,
    MotionRejected,
    OcclusionOrParallax,
    EdgeRisk,
    NoiseLimited,
    ClippedOrDefective,
    ReferenceFallback,
}

impl RegionClass {
    pub fn unsafe_for_detail(self) -> bool {
        self != Self::SupportedStatic
    }
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RegionEvidence {
    pub bounds: [u32; 4],
    pub class: RegionClass,
    pub contributing_source_mask: u8,
    pub mask_hash: String,
    pub normalized_residual_median: f32,
    pub normalized_residual_mad: f32,
    pub per_plane_support: [f32; 4],
    pub reason_codes: Vec<&'static str>,
    pub registration_uncertainty: f32,
    pub selected_action: &'static str,
}

pub struct MotionAnalysis {
    pub classes: Vec<RegionClass>,
    pub confidence: Vec<f32>,
    pub regions: Vec<RegionEvidence>,
}

pub fn classify_regions(planes: &[PlaneTile], registration_uncertainty: f32) -> MotionAnalysis {
    let width = planes[0].width;
    let height = planes[0].height;
    let mut classes = vec![RegionClass::SupportedStatic; (width * height) as usize];
    let mut confidence = vec![0.0; classes.len()];
    let mut regions = Vec::new();
    for top in (0..height).step_by(BLOCK_SIZE as usize) {
        for left in (0..width).step_by(BLOCK_SIZE as usize) {
            let right = (left + BLOCK_SIZE).min(width);
            let bottom = (top + BLOCK_SIZE).min(height);
            let mut support = [0.0; 4];
            let mut residuals = Vec::new();
            let mut source_mask = u8::MAX;
            let mut weak = 0usize;
            let mut clipped = 0usize;
            let count = ((right - left) * (bottom - top)) as usize;
            for y in top..bottom {
                for x in left..right {
                    let index = (y * width + x) as usize;
                    for (plane_index, plane) in planes.iter().enumerate() {
                        let sample = plane.estimates[index];
                        support[plane_index] += sample.effective_samples.min(4.0) / 4.0;
                        source_mask &= sample.source_mask;
                        weak += usize::from(sample.support_class() != SupportClass::Supported);
                        clipped +=
                            usize::from(!sample.estimate.is_finite() || sample.estimate >= 0.995);
                        let sigma = sample.variance.max(1.0e-7).sqrt();
                        residuals.push(sample.residual / sigma);
                    }
                }
            }
            for value in &mut support {
                *value /= count as f32;
            }
            residuals.sort_by(f32::total_cmp);
            let median = residuals[residuals.len() / 2];
            let mut deviations = residuals
                .iter()
                .map(|value| (value - median).abs())
                .collect::<Vec<_>>();
            deviations.sort_by(f32::total_cmp);
            let mad = deviations[deviations.len() / 2];
            let weak_ratio = weak as f32 / (count * 4) as f32;
            let clipped_ratio = clipped as f32 / (count * 4) as f32;
            let source_count = source_mask.count_ones();
            let (class, reason) = if clipped_ratio > 0.1 {
                (
                    RegionClass::ClippedOrDefective,
                    "clipped_or_nonfinite_samples",
                )
            } else if source_count < 2 && weak_ratio > 0.5 {
                (
                    RegionClass::OcclusionOrParallax,
                    "one_sided_source_validity",
                )
            } else if median > MOTION_RESIDUAL && mad > 0.5 {
                (RegionClass::MotionRejected, "variance_normalized_residual")
            } else if weak_ratio > 0.25 || support.iter().any(|value| *value < 0.45) {
                (RegionClass::WeakSupport, "minimum_per_plane_support")
            } else if planes.iter().any(|plane| {
                let center =
                    ((top + (bottom - top) / 2) * width + left + (right - left) / 2) as usize;
                plane.estimates[center].variance > NOISE_LIMIT
            }) {
                (RegionClass::NoiseLimited, "variance_noise_limit")
            } else if median > EDGE_RISK / registration_uncertainty.max(0.05) {
                (RegionClass::EdgeRisk, "edge_registration_uncertainty")
            } else {
                (RegionClass::SupportedStatic, "supported_static")
            };
            let block_confidence = if class == RegionClass::SupportedStatic {
                (1.0 - median / MOTION_RESIDUAL).clamp(0.0, 1.0)
                    * support.iter().copied().fold(1.0, f32::min)
            } else {
                0.0
            };
            for y in top..bottom {
                for x in left..right {
                    let index = (y * width + x) as usize;
                    classes[index] = class;
                    confidence[index] = block_confidence;
                }
            }
            let mask_hash =
                blake3::hash(format!("{left}:{top}:{right}:{bottom}:{class:?}").as_bytes());
            regions.push(RegionEvidence {
                bounds: [left, top, right - left, bottom - top],
                class,
                contributing_source_mask: source_mask,
                mask_hash: format!("blake3:{}", mask_hash.to_hex()),
                normalized_residual_median: median,
                normalized_residual_mad: mad,
                per_plane_support: support,
                reason_codes: vec![reason],
                registration_uncertainty,
                selected_action: if class == RegionClass::SupportedStatic {
                    "retain_fused_detail"
                } else {
                    "reference_fallback"
                },
            });
        }
    }
    dilate_unsafe(&mut classes, width, height, 2);
    MotionAnalysis {
        classes,
        confidence,
        regions,
    }
}

fn dilate_unsafe(classes: &mut [RegionClass], width: u32, height: u32, radius: i32) {
    let input = classes.to_vec();
    for y in 0..height {
        for x in 0..width {
            if input[(y * width + x) as usize].unsafe_for_detail() {
                continue;
            }
            let unsafe_neighbor = (-radius..=radius).any(|dy| {
                (-radius..=radius).any(|dx| {
                    let nx = x as i32 + dx;
                    let ny = y as i32 + dy;
                    nx >= 0
                        && ny >= 0
                        && nx < width as i32
                        && ny < height as i32
                        && input[(ny as u32 * width + nx as u32) as usize].unsafe_for_detail()
                })
            });
            if unsafe_neighbor {
                classes[(y * width + x) as usize] = RegionClass::ReferenceFallback;
            }
        }
    }
}
