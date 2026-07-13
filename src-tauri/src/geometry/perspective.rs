use image::{DynamicImage, GrayImage};
use imageproc::edges::canny;
use imageproc::hough::{LineDetectionOptions, detect_lines, intersection_points};
use nalgebra::{Matrix3, SMatrix, SVector, Vector3};
use serde::{Deserialize, Serialize};

pub const PERSPECTIVE_IMPLEMENTATION_VERSION_V1: u32 = 1;

#[derive(Clone, Copy, Debug, Default, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum PerspectiveCorrectionMode {
    #[default]
    Off,
    ManualLegacy,
    AutoLevel,
    AutoVertical,
    AutoHorizontal,
    AutoFull,
    Guided,
}

#[derive(Clone, Copy, Debug, Default, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum PerspectiveCropPolicy {
    ShowAll,
    Constrain,
    #[default]
    AutoCrop,
    PreserveCurrentCrop,
    ManualAfterCorrection,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum PerspectiveLineClass {
    Horizontal,
    Vertical,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PerspectiveGuideV1 {
    pub id: String,
    pub class: PerspectiveLineClass,
    pub endpoints_source_normalized: [[f64; 2]; 2],
    #[serde(default = "default_guide_weight")]
    pub weight: f32,
}

fn default_guide_weight() -> f32 {
    1.0
}

#[derive(Clone, Debug, Default, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PerspectiveCorrectionSettingsV1 {
    #[serde(default)]
    pub mode: PerspectiveCorrectionMode,
    #[serde(default)]
    pub amount: f32,
    #[serde(default)]
    pub crop_policy: PerspectiveCropPolicy,
    #[serde(default)]
    pub guides: Vec<PerspectiveGuideV1>,
    #[serde(default)]
    pub resolved_plan: Option<PerspectiveCorrectionPlanV1>,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, Hash, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PerspectiveAnalysisIdentityV1 {
    pub source_revision: u64,
    pub orientation_fingerprint: u64,
    pub lens_geometry_fingerprint: u64,
    pub analysis_dimensions: [u32; 2],
    pub implementation_version: u32,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DetectedPerspectiveLineV1 {
    pub endpoints_source_normalized: [[f32; 2]; 2],
    pub orientation_class: PerspectiveLineClass,
    pub length_weight: f32,
    pub edge_strength: f32,
    pub confidence: f32,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PerspectiveAnalysisV1 {
    pub identity: PerspectiveAnalysisIdentityV1,
    pub horizon_angle_degrees: Option<f32>,
    pub lines: Vec<DetectedPerspectiveLineV1>,
    pub confidence: f32,
    pub warning_codes: Vec<String>,
}

pub fn analyze_perspective(
    image: &DynamicImage,
    identity: PerspectiveAnalysisIdentityV1,
) -> PerspectiveAnalysisV1 {
    const MAX_ANALYSIS_EDGE: u32 = 1024;
    const MAX_RETAINED_LINES: usize = 64;
    let grayscale = image.to_luma8();
    let scale =
        (MAX_ANALYSIS_EDGE as f32 / grayscale.width().max(grayscale.height()) as f32).min(1.0);
    let width = ((grayscale.width() as f32 * scale).round() as u32).max(1);
    let height = ((grayscale.height() as f32 * scale).round() as u32).max(1);
    let bounded: GrayImage = image::imageops::resize(
        &grayscale,
        width,
        height,
        image::imageops::FilterType::Triangle,
    );
    let edges = canny(&bounded, 24.0, 72.0);
    let vote_threshold = (width.min(height) / 5).max(16);
    let mut polar = detect_lines(
        &edges,
        LineDetectionOptions {
            vote_threshold,
            suppression_radius: 8,
        },
    );
    polar.sort_by_key(|line| (line.angle_in_degrees, (line.r * 16.0).round() as i32));
    let mut lines = polar
        .into_iter()
        .filter_map(|polar| {
            let (start, end) = intersection_points(polar, width, height)?;
            let direction_degrees = (polar.angle_in_degrees as f32 + 90.0) % 180.0;
            let horizontal_error = direction_degrees.min(180.0 - direction_degrees);
            let vertical_error = (direction_degrees - 90.0).abs();
            let (orientation_class, angle_error) = if horizontal_error <= vertical_error {
                (PerspectiveLineClass::Horizontal, horizontal_error)
            } else {
                (PerspectiveLineClass::Vertical, vertical_error)
            };
            if angle_error > 35.0 {
                return None;
            }
            let a = [start.0 / width as f32, start.1 / height as f32];
            let b = [end.0 / width as f32, end.1 / height as f32];
            let length = (b[0] - a[0]).hypot(b[1] - a[1]).min(1.5);
            let confidence = (length * (1.0 - angle_error / 45.0)).clamp(0.0, 1.0);
            Some(DetectedPerspectiveLineV1 {
                endpoints_source_normalized: [a, b],
                orientation_class,
                length_weight: length,
                edge_strength: 1.0,
                confidence,
            })
        })
        .collect::<Vec<_>>();
    lines.sort_by(|a, b| {
        b.confidence.total_cmp(&a.confidence).then_with(|| {
            a.endpoints_source_normalized[0][0].total_cmp(&b.endpoints_source_normalized[0][0])
        })
    });
    lines.truncate(MAX_RETAINED_LINES);
    let horizontal_angles = lines
        .iter()
        .filter(|line| line.orientation_class == PerspectiveLineClass::Horizontal)
        .map(|line| {
            let [a, b] = line.endpoints_source_normalized;
            (
                (b[1] - a[1]).atan2(b[0] - a[0]).to_degrees(),
                line.confidence,
            )
        })
        .collect::<Vec<_>>();
    let horizon_angle_degrees = weighted_median_angle(&horizontal_angles);
    let family_count = lines.iter().filter(|line| line.confidence >= 0.25).count();
    let confidence = (family_count as f32 / 8.0).clamp(0.0, 1.0);
    let warning_codes = if family_count < 2 {
        vec!["perspective.no_reliable_geometry".to_string()]
    } else {
        Vec::new()
    };
    PerspectiveAnalysisV1 {
        identity: PerspectiveAnalysisIdentityV1 {
            analysis_dimensions: [width, height],
            ..identity
        },
        horizon_angle_degrees,
        lines,
        confidence,
        warning_codes,
    }
}

fn weighted_median_angle(angles: &[(f32, f32)]) -> Option<f32> {
    if angles.is_empty() {
        return None;
    }
    let mut angles = angles.to_vec();
    angles.sort_by(|a, b| a.0.total_cmp(&b.0));
    let total = angles.iter().map(|(_, weight)| weight).sum::<f32>();
    let mut accumulated = 0.0;
    for (angle, weight) in angles {
        accumulated += weight;
        if accumulated >= total / 2.0 {
            return Some(angle);
        }
    }
    None
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NormalizedCropV1 {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PerspectiveCorrectionPlanV1 {
    pub analysis_identity: Option<PerspectiveAnalysisIdentityV1>,
    pub source_to_corrected: [[f64; 3]; 3],
    pub corrected_to_source: [[f64; 3]; 3],
    pub valid_polygon: Vec<[f64; 2]>,
    pub suggested_crop: Option<NormalizedCropV1>,
    pub retained_area: f32,
    pub confidence: f32,
    pub warning_codes: Vec<String>,
    pub fingerprint: u64,
    pub implementation_version: u32,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PerspectiveCorrectionReceiptV1 {
    pub plan: PerspectiveCorrectionPlanV1,
    pub guide_count: u32,
    pub horizontal_guide_count: u32,
    pub vertical_guide_count: u32,
    pub residual_degrees_p95: f32,
    pub condition_estimate: f64,
    pub abstention_reason: Option<String>,
}

pub fn compile_perspective_plan(
    settings: &PerspectiveCorrectionSettingsV1,
) -> Result<PerspectiveCorrectionReceiptV1, String> {
    if settings.mode == PerspectiveCorrectionMode::Off
        || settings.mode == PerspectiveCorrectionMode::ManualLegacy
        || settings.amount <= 0.0
    {
        return Ok(identity_receipt(settings, None));
    }
    if settings.mode != PerspectiveCorrectionMode::Guided {
        if let Some(plan) = settings.resolved_plan.as_ref() {
            let matrix: Matrix3<f64> =
                Matrix3::from_row_slice(bytemuck::cast_slice(&plan.source_to_corrected));
            let inverse: Matrix3<f64> =
                Matrix3::from_row_slice(bytemuck::cast_slice(&plan.corrected_to_source));
            let reciprocal_error = (matrix * inverse - Matrix3::<f64>::identity()).abs().amax();
            if matrix.iter().all(|value| value.is_finite())
                && inverse.iter().all(|value| value.is_finite())
                && reciprocal_error < 1.0e-6
                && plan.implementation_version == PERSPECTIVE_IMPLEMENTATION_VERSION_V1
            {
                let amount = f64::from(settings.amount.clamp(0.0, 100.0)) / 100.0;
                if amount < 1.0 {
                    let source = [[0.0, 0.0], [1.0, 0.0], [1.0, 1.0], [0.0, 1.0]];
                    let solved = [
                        transform_point(matrix, source[0])?,
                        transform_point(matrix, source[1])?,
                        transform_point(matrix, source[2])?,
                        transform_point(matrix, source[3])?,
                    ];
                    let target = std::array::from_fn(|index| {
                        [
                            source[index][0] + (solved[index][0] - source[index][0]) * amount,
                            source[index][1] + (solved[index][1] - source[index][1]) * amount,
                        ]
                    });
                    return receipt_from_matrix(
                        settings,
                        plan.confidence,
                        homography(source, target)?,
                        0,
                        0,
                    );
                }
                return Ok(PerspectiveCorrectionReceiptV1 {
                    plan: plan.clone(),
                    guide_count: 0,
                    horizontal_guide_count: 0,
                    vertical_guide_count: 0,
                    residual_degrees_p95: 0.0,
                    condition_estimate: matrix.norm() * inverse.norm(),
                    abstention_reason: None,
                });
            }
            return Err("perspective.invalid_resolved_plan".to_string());
        }
        return Ok(identity_receipt(
            settings,
            Some("perspective.analysis_required".to_string()),
        ));
    }
    let horizontal = valid_guides(settings, PerspectiveLineClass::Horizontal)?;
    let vertical = valid_guides(settings, PerspectiveLineClass::Vertical)?;
    if horizontal.len() == 1 && vertical.is_empty() {
        return compile_single_guide_rotation(settings, horizontal[0], 0.0, 1, 0);
    }
    if vertical.len() == 1 && horizontal.is_empty() {
        return compile_single_guide_rotation(
            settings,
            vertical[0],
            std::f64::consts::FRAC_PI_2,
            0,
            1,
        );
    }
    if horizontal.len() < 2 && vertical.len() < 2 {
        return Ok(identity_receipt(
            settings,
            Some("perspective.guided_constraints_insufficient".to_string()),
        ));
    }

    let (left, right) = if vertical.len() >= 2 {
        (
            line(horizontal_line(vertical[0])?),
            line(horizontal_line(vertical[1])?),
        )
    } else {
        (
            line([[0.0, 0.0], [0.0, 1.0]]),
            line([[1.0, 0.0], [1.0, 1.0]]),
        )
    };
    let (top, bottom) = if horizontal.len() >= 2 {
        (
            line(horizontal_line(horizontal[0])?),
            line(horizontal_line(horizontal[1])?),
        )
    } else {
        (
            line([[0.0, 0.0], [1.0, 0.0]]),
            line([[0.0, 1.0], [1.0, 1.0]]),
        )
    };
    let source_quad = [
        intersect(left, top)?,
        intersect(right, top)?,
        intersect(right, bottom)?,
        intersect(left, bottom)?,
    ];
    validate_quad(source_quad)?;
    let rect = target_rectangle(source_quad);
    let amount = f64::from(settings.amount.clamp(0.0, 100.0)) / 100.0;
    let target = std::array::from_fn(|index| {
        [
            source_quad[index][0] + (rect[index][0] - source_quad[index][0]) * amount,
            source_quad[index][1] + (rect[index][1] - source_quad[index][1]) * amount,
        ]
    });
    let matrix = homography(source_quad, target)?;
    let inverse = matrix
        .try_inverse()
        .ok_or_else(|| "perspective.singular_transform".to_string())?;
    let condition = matrix.norm() * inverse.norm();
    if !condition.is_finite() || condition > 1.0e6 {
        return Err("perspective.ill_conditioned_transform".to_string());
    }
    let valid_polygon = [[0.0, 0.0], [1.0, 0.0], [1.0, 1.0], [0.0, 1.0]]
        .map(|point| transform_point(matrix, point))
        .into_iter()
        .collect::<Result<Vec<_>, _>>()?;
    let crop = maximal_centered_crop(&valid_polygon);
    let retained_area = crop.map_or(1.0, |crop| {
        (crop.width * crop.height).clamp(0.0, 1.0) as f32
    });
    let mut warnings = Vec::new();
    if retained_area < 0.35 {
        warnings.push("perspective.extreme_crop".to_string());
    }
    let fingerprint = fingerprint(settings, matrix, crop);
    let plan = PerspectiveCorrectionPlanV1 {
        analysis_identity: None,
        source_to_corrected: matrix_to_array(matrix),
        corrected_to_source: matrix_to_array(inverse),
        valid_polygon,
        suggested_crop: (settings.crop_policy == PerspectiveCropPolicy::AutoCrop)
            .then_some(crop)
            .flatten(),
        retained_area,
        confidence: if warnings.is_empty() { 1.0 } else { 0.5 },
        warning_codes: warnings,
        fingerprint,
        implementation_version: PERSPECTIVE_IMPLEMENTATION_VERSION_V1,
    };
    Ok(PerspectiveCorrectionReceiptV1 {
        plan,
        guide_count: settings.guides.len() as u32,
        horizontal_guide_count: horizontal.len() as u32,
        vertical_guide_count: vertical.len() as u32,
        residual_degrees_p95: 0.0,
        condition_estimate: condition,
        abstention_reason: None,
    })
}

fn compile_single_guide_rotation(
    settings: &PerspectiveCorrectionSettingsV1,
    guide: &PerspectiveGuideV1,
    target_angle: f64,
    horizontal_count: u32,
    vertical_count: u32,
) -> Result<PerspectiveCorrectionReceiptV1, String> {
    let [a, b] = guide.endpoints_source_normalized;
    let measured = (b[1] - a[1]).atan2(b[0] - a[0]);
    let amount = f64::from(settings.amount.clamp(0.0, 100.0)) / 100.0;
    let angle = (target_angle - measured) * amount;
    let (sin, cos) = angle.sin_cos();
    let translate = |x, y| Matrix3::new(1.0, 0.0, x, 0.0, 1.0, y, 0.0, 0.0, 1.0);
    let rotate = Matrix3::new(cos, -sin, 0.0, sin, cos, 0.0, 0.0, 0.0, 1.0);
    receipt_from_matrix(
        settings,
        1.0,
        translate(0.5, 0.5) * rotate * translate(-0.5, -0.5),
        horizontal_count,
        vertical_count,
    )
}

pub fn compile_perspective_plan_with_analysis(
    settings: &PerspectiveCorrectionSettingsV1,
    analysis: &PerspectiveAnalysisV1,
) -> Result<PerspectiveCorrectionReceiptV1, String> {
    if settings.mode == PerspectiveCorrectionMode::AutoLevel {
        let Some(angle) = analysis.horizon_angle_degrees else {
            return Ok(identity_receipt(
                settings,
                Some("perspective.no_reliable_horizon".to_string()),
            ));
        };
        if analysis.confidence < 0.2 {
            return Ok(identity_receipt(
                settings,
                Some("perspective.low_confidence".to_string()),
            ));
        }
        let angle = -f64::from(angle) * f64::from(settings.amount.clamp(0.0, 100.0)) / 100.0;
        let (sin, cos) = angle.to_radians().sin_cos();
        let translate = |x, y| Matrix3::new(1.0, 0.0, x, 0.0, 1.0, y, 0.0, 0.0, 1.0);
        let rotate = Matrix3::new(cos, -sin, 0.0, sin, cos, 0.0, 0.0, 0.0, 1.0);
        let mut receipt = receipt_from_matrix(
            settings,
            analysis.confidence,
            translate(0.5, 0.5) * rotate * translate(-0.5, -0.5),
            0,
            0,
        )?;
        bind_analysis_identity(&mut receipt.plan, analysis.identity);
        return Ok(receipt);
    }

    let mut guided = settings.clone();
    guided.mode = PerspectiveCorrectionMode::Guided;
    guided.guides = recommended_guides(settings.mode, analysis);
    let mut receipt = compile_perspective_plan(&guided)?;
    bind_analysis_identity(&mut receipt.plan, analysis.identity);
    receipt.plan.confidence = receipt.plan.confidence.min(analysis.confidence);
    if analysis.confidence < 0.2 && receipt.abstention_reason.is_none() {
        receipt.abstention_reason = Some("perspective.low_confidence".to_string());
        receipt
            .plan
            .warning_codes
            .push("perspective.low_confidence".to_string());
    }
    Ok(receipt)
}

fn recommended_guides(
    mode: PerspectiveCorrectionMode,
    analysis: &PerspectiveAnalysisV1,
) -> Vec<PerspectiveGuideV1> {
    let take_family = |class| {
        analysis
            .lines
            .iter()
            .filter(|line| line.orientation_class == class && line.confidence >= 0.2)
            .take(2)
            .enumerate()
            .map(|(index, line)| PerspectiveGuideV1 {
                id: format!("auto_{class:?}_{index}"),
                class,
                endpoints_source_normalized: line
                    .endpoints_source_normalized
                    .map(|point| point.map(f64::from)),
                weight: line.confidence,
            })
            .collect::<Vec<_>>()
    };
    let mut horizontal = take_family(PerspectiveLineClass::Horizontal);
    let mut vertical = take_family(PerspectiveLineClass::Vertical);
    if mode == PerspectiveCorrectionMode::AutoVertical && horizontal.len() < 2 {
        horizontal = boundary_guides(PerspectiveLineClass::Horizontal);
    }
    if mode == PerspectiveCorrectionMode::AutoHorizontal && vertical.len() < 2 {
        vertical = boundary_guides(PerspectiveLineClass::Vertical);
    }
    horizontal.extend(vertical);
    horizontal
}

fn boundary_guides(class: PerspectiveLineClass) -> Vec<PerspectiveGuideV1> {
    match class {
        PerspectiveLineClass::Horizontal => vec![
            PerspectiveGuideV1 {
                id: "preserve_top".to_string(),
                class,
                endpoints_source_normalized: [[0.0, 0.0], [1.0, 0.0]],
                weight: 1.0,
            },
            PerspectiveGuideV1 {
                id: "preserve_bottom".to_string(),
                class,
                endpoints_source_normalized: [[0.0, 1.0], [1.0, 1.0]],
                weight: 1.0,
            },
        ],
        PerspectiveLineClass::Vertical => vec![
            PerspectiveGuideV1 {
                id: "preserve_left".to_string(),
                class,
                endpoints_source_normalized: [[0.0, 0.0], [0.0, 1.0]],
                weight: 1.0,
            },
            PerspectiveGuideV1 {
                id: "preserve_right".to_string(),
                class,
                endpoints_source_normalized: [[1.0, 0.0], [1.0, 1.0]],
                weight: 1.0,
            },
        ],
    }
}

fn bind_analysis_identity(
    plan: &mut PerspectiveCorrectionPlanV1,
    identity: PerspectiveAnalysisIdentityV1,
) {
    let mut hasher = blake3::Hasher::new();
    hasher.update(&plan.fingerprint.to_le_bytes());
    hasher.update(&serde_json::to_vec(&identity).unwrap_or_default());
    plan.fingerprint = u64::from_le_bytes(hasher.finalize().as_bytes()[..8].try_into().unwrap());
    plan.analysis_identity = Some(identity);
}

fn receipt_from_matrix(
    settings: &PerspectiveCorrectionSettingsV1,
    confidence: f32,
    matrix: Matrix3<f64>,
    horizontal_guide_count: u32,
    vertical_guide_count: u32,
) -> Result<PerspectiveCorrectionReceiptV1, String> {
    let inverse = matrix
        .try_inverse()
        .ok_or_else(|| "perspective.singular_transform".to_string())?;
    let valid_polygon = [[0.0, 0.0], [1.0, 0.0], [1.0, 1.0], [0.0, 1.0]]
        .map(|point| transform_point(matrix, point))
        .into_iter()
        .collect::<Result<Vec<_>, _>>()?;
    let crop = maximal_centered_crop(&valid_polygon);
    let retained_area = crop.map_or(1.0, |crop| (crop.width * crop.height) as f32);
    Ok(PerspectiveCorrectionReceiptV1 {
        plan: PerspectiveCorrectionPlanV1 {
            analysis_identity: None,
            source_to_corrected: matrix_to_array(matrix),
            corrected_to_source: matrix_to_array(inverse),
            valid_polygon,
            suggested_crop: (settings.crop_policy == PerspectiveCropPolicy::AutoCrop)
                .then_some(crop)
                .flatten(),
            retained_area,
            confidence,
            warning_codes: Vec::new(),
            fingerprint: fingerprint(settings, matrix, crop),
            implementation_version: PERSPECTIVE_IMPLEMENTATION_VERSION_V1,
        },
        guide_count: horizontal_guide_count + vertical_guide_count,
        horizontal_guide_count,
        vertical_guide_count,
        residual_degrees_p95: 0.0,
        condition_estimate: matrix.norm() * inverse.norm(),
        abstention_reason: None,
    })
}

fn valid_guides(
    settings: &PerspectiveCorrectionSettingsV1,
    class: PerspectiveLineClass,
) -> Result<Vec<&PerspectiveGuideV1>, String> {
    settings
        .guides
        .iter()
        .filter(|guide| guide.class == class)
        .map(|guide| {
            let [a, b] = guide.endpoints_source_normalized;
            let length = (b[0] - a[0]).hypot(b[1] - a[1]);
            if !a.into_iter().chain(b).all(f64::is_finite) || length < 0.02 {
                Err("perspective.invalid_guide".to_string())
            } else {
                Ok(guide)
            }
        })
        .collect()
}

fn horizontal_line(guide: &PerspectiveGuideV1) -> Result<[[f64; 2]; 2], String> {
    Ok(guide.endpoints_source_normalized)
}

fn line(points: [[f64; 2]; 2]) -> [f64; 3] {
    let [a, b] = points;
    [a[1] - b[1], b[0] - a[0], a[0] * b[1] - b[0] * a[1]]
}

fn intersect(a: [f64; 3], b: [f64; 3]) -> Result<[f64; 2], String> {
    let p = [
        a[1] * b[2] - a[2] * b[1],
        a[2] * b[0] - a[0] * b[2],
        a[0] * b[1] - a[1] * b[0],
    ];
    if !p[2].is_finite() || p[2].abs() < 1.0e-8 {
        return Err("perspective.parallel_guides".to_string());
    }
    Ok([p[0] / p[2], p[1] / p[2]])
}

fn validate_quad(quad: [[f64; 2]; 4]) -> Result<(), String> {
    let mut sign = 0.0;
    for index in 0..4 {
        let a = quad[index];
        let b = quad[(index + 1) % 4];
        let c = quad[(index + 2) % 4];
        let cross = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
        if cross.abs() < 1.0e-8 || (sign != 0.0 && cross.signum() != sign) {
            return Err("perspective.invalid_guide_quad".to_string());
        }
        sign = cross.signum();
    }
    Ok(())
}

fn target_rectangle(quad: [[f64; 2]; 4]) -> [[f64; 2]; 4] {
    let center = [
        quad.iter().map(|p| p[0]).sum::<f64>() / 4.0,
        quad.iter().map(|p| p[1]).sum::<f64>() / 4.0,
    ];
    let width = (((quad[1][0] - quad[0][0]).hypot(quad[1][1] - quad[0][1])
        + (quad[2][0] - quad[3][0]).hypot(quad[2][1] - quad[3][1]))
        / 2.0)
        .clamp(0.05, 2.0);
    let height = (((quad[3][0] - quad[0][0]).hypot(quad[3][1] - quad[0][1])
        + (quad[2][0] - quad[1][0]).hypot(quad[2][1] - quad[1][1]))
        / 2.0)
        .clamp(0.05, 2.0);
    let (x0, x1) = (center[0] - width / 2.0, center[0] + width / 2.0);
    let (y0, y1) = (center[1] - height / 2.0, center[1] + height / 2.0);
    [[x0, y0], [x1, y0], [x1, y1], [x0, y1]]
}

fn homography(source: [[f64; 2]; 4], target: [[f64; 2]; 4]) -> Result<Matrix3<f64>, String> {
    let mut a = SMatrix::<f64, 8, 8>::zeros();
    let mut b = SVector::<f64, 8>::zeros();
    for index in 0..4 {
        let [x, y] = source[index];
        let [u, v] = target[index];
        let row = index * 2;
        a[(row, 0)] = x;
        a[(row, 1)] = y;
        a[(row, 2)] = 1.0;
        a[(row, 6)] = -u * x;
        a[(row, 7)] = -u * y;
        b[row] = u;
        a[(row + 1, 3)] = x;
        a[(row + 1, 4)] = y;
        a[(row + 1, 5)] = 1.0;
        a[(row + 1, 6)] = -v * x;
        a[(row + 1, 7)] = -v * y;
        b[row + 1] = v;
    }
    let h = a
        .lu()
        .solve(&b)
        .ok_or_else(|| "perspective.unsolved_transform".to_string())?;
    Ok(Matrix3::new(
        h[0], h[1], h[2], h[3], h[4], h[5], h[6], h[7], 1.0,
    ))
}

fn transform_point(matrix: Matrix3<f64>, point: [f64; 2]) -> Result<[f64; 2], String> {
    let p = matrix * Vector3::new(point[0], point[1], 1.0);
    if !p.z.is_finite() || p.z.abs() < 1.0e-8 {
        return Err("perspective.invalid_projected_point".to_string());
    }
    Ok([p.x / p.z, p.y / p.z])
}

fn maximal_centered_crop(polygon: &[[f64; 2]]) -> Option<NormalizedCropV1> {
    if polygon.len() != 4 {
        return None;
    }
    let center = [
        polygon.iter().map(|p| p[0]).sum::<f64>() / 4.0,
        polygon.iter().map(|p| p[1]).sum::<f64>() / 4.0,
    ];
    let mut low = 0.0;
    let mut high = 1.0;
    for _ in 0..48 {
        let scale = (low + high) / 2.0;
        let corners = [
            [center[0] - scale / 2.0, center[1] - scale / 2.0],
            [center[0] + scale / 2.0, center[1] - scale / 2.0],
            [center[0] + scale / 2.0, center[1] + scale / 2.0],
            [center[0] - scale / 2.0, center[1] + scale / 2.0],
        ];
        if corners.into_iter().all(|point| {
            (0.0..=1.0).contains(&point[0])
                && (0.0..=1.0).contains(&point[1])
                && point_in_convex_polygon(point, polygon)
        }) {
            low = scale;
        } else {
            high = scale;
        }
    }
    (low > 0.0).then_some(NormalizedCropV1 {
        x: center[0] - low / 2.0,
        y: center[1] - low / 2.0,
        width: low,
        height: low,
    })
}

fn point_in_convex_polygon(point: [f64; 2], polygon: &[[f64; 2]]) -> bool {
    let mut sign = 0.0;
    for index in 0..polygon.len() {
        let a = polygon[index];
        let b = polygon[(index + 1) % polygon.len()];
        let cross = (b[0] - a[0]) * (point[1] - a[1]) - (b[1] - a[1]) * (point[0] - a[0]);
        if cross.abs() > 1.0e-9 {
            if sign != 0.0 && cross.signum() != sign {
                return false;
            }
            sign = cross.signum();
        }
    }
    true
}

fn matrix_to_array(matrix: Matrix3<f64>) -> [[f64; 3]; 3] {
    std::array::from_fn(|row| std::array::from_fn(|column| matrix[(row, column)]))
}

fn identity_receipt(
    settings: &PerspectiveCorrectionSettingsV1,
    abstention_reason: Option<String>,
) -> PerspectiveCorrectionReceiptV1 {
    let identity = Matrix3::identity();
    let plan = PerspectiveCorrectionPlanV1 {
        analysis_identity: None,
        source_to_corrected: matrix_to_array(identity),
        corrected_to_source: matrix_to_array(identity),
        valid_polygon: vec![[0.0, 0.0], [1.0, 0.0], [1.0, 1.0], [0.0, 1.0]],
        suggested_crop: None,
        retained_area: 1.0,
        confidence: if abstention_reason.is_some() {
            0.0
        } else {
            1.0
        },
        warning_codes: abstention_reason.clone().into_iter().collect(),
        fingerprint: fingerprint(settings, identity, None),
        implementation_version: PERSPECTIVE_IMPLEMENTATION_VERSION_V1,
    };
    PerspectiveCorrectionReceiptV1 {
        plan,
        guide_count: settings.guides.len() as u32,
        horizontal_guide_count: settings
            .guides
            .iter()
            .filter(|g| g.class == PerspectiveLineClass::Horizontal)
            .count() as u32,
        vertical_guide_count: settings
            .guides
            .iter()
            .filter(|g| g.class == PerspectiveLineClass::Vertical)
            .count() as u32,
        residual_degrees_p95: 0.0,
        condition_estimate: 1.0,
        abstention_reason,
    }
}

fn fingerprint(
    settings: &PerspectiveCorrectionSettingsV1,
    matrix: Matrix3<f64>,
    crop: Option<NormalizedCropV1>,
) -> u64 {
    let mut hasher = blake3::Hasher::new();
    hasher.update(&PERSPECTIVE_IMPLEMENTATION_VERSION_V1.to_le_bytes());
    hasher.update(&serde_json::to_vec(settings).unwrap_or_default());
    hasher.update(bytemuck::cast_slice(matrix.as_slice()));
    hasher.update(&serde_json::to_vec(&crop).unwrap_or_default());
    u64::from_le_bytes(hasher.finalize().as_bytes()[..8].try_into().unwrap())
}

#[cfg(test)]
mod tests {
    use super::*;
    use image::{ImageBuffer, Luma};
    use imageproc::drawing::draw_line_segment_mut;

    fn guide(
        id: &str,
        class: PerspectiveLineClass,
        a: [f64; 2],
        b: [f64; 2],
    ) -> PerspectiveGuideV1 {
        PerspectiveGuideV1 {
            id: id.to_string(),
            class,
            endpoints_source_normalized: [a, b],
            weight: 1.0,
        }
    }

    fn converging_settings(amount: f32) -> PerspectiveCorrectionSettingsV1 {
        PerspectiveCorrectionSettingsV1 {
            mode: PerspectiveCorrectionMode::Guided,
            amount,
            crop_policy: PerspectiveCropPolicy::AutoCrop,
            guides: vec![
                guide(
                    "left",
                    PerspectiveLineClass::Vertical,
                    [0.22, 0.1],
                    [0.12, 0.9],
                ),
                guide(
                    "right",
                    PerspectiveLineClass::Vertical,
                    [0.78, 0.1],
                    [0.88, 0.9],
                ),
                guide(
                    "top",
                    PerspectiveLineClass::Horizontal,
                    [0.22, 0.1],
                    [0.78, 0.1],
                ),
                guide(
                    "bottom",
                    PerspectiveLineClass::Horizontal,
                    [0.12, 0.9],
                    [0.88, 0.9],
                ),
            ],
            resolved_plan: None,
        }
    }

    #[test]
    fn amount_zero_is_exact_identity_and_does_not_destroy_crop() {
        let receipt = compile_perspective_plan(&converging_settings(0.0)).unwrap();
        assert_eq!(
            receipt.plan.source_to_corrected,
            matrix_to_array(Matrix3::identity())
        );
        assert_eq!(receipt.plan.suggested_crop, None);
    }

    #[test]
    fn guided_full_rectifies_four_lines_with_finite_inverse_and_crop() {
        let receipt = compile_perspective_plan(&converging_settings(100.0)).unwrap();
        let forward =
            Matrix3::from_row_slice(bytemuck::cast_slice(&receipt.plan.source_to_corrected));
        let source = [[0.22, 0.1], [0.78, 0.1], [0.88, 0.9], [0.12, 0.9]];
        let output = source.map(|point| transform_point(forward, point).unwrap());
        assert!((output[0][1] - output[1][1]).abs() < 1.0e-9);
        assert!((output[2][1] - output[3][1]).abs() < 1.0e-9);
        assert!((output[0][0] - output[3][0]).abs() < 1.0e-9);
        assert!((output[1][0] - output[2][0]).abs() < 1.0e-9);
        assert!(receipt.condition_estimate.is_finite());
        assert!(receipt.plan.suggested_crop.is_some());
        assert!(receipt.plan.retained_area > 0.0);
    }

    #[test]
    fn partial_amount_is_continuous_and_distinct_from_endpoints() {
        let zero = compile_perspective_plan(&converging_settings(0.0)).unwrap();
        let half = compile_perspective_plan(&converging_settings(50.0)).unwrap();
        let full = compile_perspective_plan(&converging_settings(100.0)).unwrap();
        assert_ne!(half.plan.source_to_corrected, zero.plan.source_to_corrected);
        assert_ne!(half.plan.source_to_corrected, full.plan.source_to_corrected);
        assert!(half.condition_estimate.is_finite());
    }

    #[test]
    fn invalid_or_incomplete_guides_fail_safe_without_extreme_geometry() {
        let mut settings = converging_settings(100.0);
        settings.guides = vec![settings.guides[0].clone(), settings.guides[2].clone()];
        let receipt = compile_perspective_plan(&settings).unwrap();
        assert_eq!(
            receipt.abstention_reason.as_deref(),
            Some("perspective.guided_constraints_insufficient")
        );
        settings.guides.push(guide(
            "short",
            PerspectiveLineClass::Horizontal,
            [0.2, 0.2],
            [0.201, 0.2],
        ));
        assert_eq!(
            compile_perspective_plan(&settings),
            Err("perspective.invalid_guide".to_string())
        );
    }

    #[test]
    fn one_line_levels_and_two_vertical_guides_rectify_without_unrelated_constraints() {
        let one_horizontal = PerspectiveCorrectionSettingsV1 {
            mode: PerspectiveCorrectionMode::Guided,
            amount: 100.0,
            crop_policy: PerspectiveCropPolicy::AutoCrop,
            guides: vec![guide(
                "horizon",
                PerspectiveLineClass::Horizontal,
                [0.1, 0.3],
                [0.9, 0.4],
            )],
            resolved_plan: None,
        };
        let leveled = compile_perspective_plan(&one_horizontal).unwrap();
        assert_eq!(leveled.horizontal_guide_count, 1);
        assert_ne!(
            leveled.plan.source_to_corrected,
            matrix_to_array(Matrix3::identity())
        );

        let full = converging_settings(100.0);
        let vertical_only = PerspectiveCorrectionSettingsV1 {
            guides: full
                .guides
                .iter()
                .filter(|guide| guide.class == PerspectiveLineClass::Vertical)
                .cloned()
                .collect(),
            ..full
        };
        let rectified = compile_perspective_plan(&vertical_only).unwrap();
        assert_eq!(rectified.vertical_guide_count, 2);
        assert!(rectified.abstention_reason.is_none());
        assert!(rectified.condition_estimate.is_finite());
    }

    #[test]
    fn bounded_analysis_is_deterministic_and_recovers_synthetic_line_families() {
        let mut fixture = ImageBuffer::from_pixel(2400, 1600, Luma([0_u8]));
        for offset in [300.0, 700.0, 1_100.0, 1_500.0, 1_900.0] {
            draw_line_segment_mut(
                &mut fixture,
                (offset, 120.0),
                (offset - 80.0, 1480.0),
                Luma([255]),
            );
        }
        for offset in [250.0, 650.0, 1050.0, 1450.0] {
            draw_line_segment_mut(
                &mut fixture,
                (120.0, offset),
                (2280.0, offset + 30.0),
                Luma([255]),
            );
        }
        let identity = PerspectiveAnalysisIdentityV1 {
            source_revision: 7,
            orientation_fingerprint: 8,
            lens_geometry_fingerprint: 9,
            analysis_dimensions: [0, 0],
            implementation_version: PERSPECTIVE_IMPLEMENTATION_VERSION_V1,
        };
        let fixture = DynamicImage::ImageLuma8(fixture);
        let first = analyze_perspective(&fixture, identity);
        let second = analyze_perspective(&fixture, identity);
        assert!(first.identity.analysis_dimensions[0] <= 1024);
        assert!(first.identity.analysis_dimensions[1] <= 1024);
        assert!(
            first
                .lines
                .iter()
                .any(|line| line.orientation_class == PerspectiveLineClass::Vertical)
        );
        assert!(
            first
                .lines
                .iter()
                .any(|line| line.orientation_class == PerspectiveLineClass::Horizontal)
        );
        assert_eq!(first, second);
        let auto_full = compile_perspective_plan_with_analysis(
            &PerspectiveCorrectionSettingsV1 {
                mode: PerspectiveCorrectionMode::AutoFull,
                amount: 80.0,
                crop_policy: PerspectiveCropPolicy::AutoCrop,
                guides: Vec::new(),
                resolved_plan: None,
            },
            &first,
        )
        .unwrap();
        assert!(auto_full.abstention_reason.is_none());
        assert_eq!(auto_full.plan.analysis_identity, Some(first.identity));
        assert!(auto_full.plan.retained_area > 0.0);
    }

    #[test]
    fn guided_plan_drives_full_and_target_mapped_render_with_crop_safe_pixels() {
        let settings = converging_settings(70.0);
        let receipt = compile_perspective_plan(&settings).unwrap();
        let adjustments = serde_json::json!({ "perspectiveCorrection": settings });
        let params = crate::geometry::get_geometry_params_from_json(&adjustments);
        let source = DynamicImage::ImageRgb32F(image::ImageBuffer::from_fn(160, 120, |x, y| {
            image::Rgb([0.2 + x as f32 / 400.0, 0.2 + y as f32 / 300.0, 0.5])
        }));
        let full = crate::geometry::warp_image_geometry(&source, params);
        let mapped = crate::geometry::warp_image_geometry_mapped(
            &source,
            params,
            160,
            120,
            |x, y| (x, y),
            None,
            None,
        )
        .unwrap();
        let full = full.to_rgb32f();
        let mapped = mapped.to_rgb32f();
        let mean_error = full
            .pixels()
            .zip(mapped.pixels())
            .flat_map(|(a, b)| (0..3).map(move |channel| (a[channel] - b[channel]).abs()))
            .sum::<f32>()
            / (160 * 120 * 3) as f32;
        assert!(
            mean_error < 1.0e-6,
            "mapped/full perspective error {mean_error}"
        );

        let crop = receipt.plan.suggested_crop.unwrap();
        let x0 = (crop.x * 160.0).ceil().max(1.0) as u32;
        let y0 = (crop.y * 120.0).ceil().max(1.0) as u32;
        let x1 = ((crop.x + crop.width) * 160.0).floor().min(158.0) as u32;
        let y1 = ((crop.y + crop.height) * 120.0).floor().min(118.0) as u32;
        for y in y0..y1 {
            for x in x0..x1 {
                let pixel = full.get_pixel(x, y);
                assert!(pixel.0.iter().all(|channel| *channel > 0.0));
            }
        }
    }

    #[test]
    fn perspective_plan_invalidates_geometry_and_render_plan_identity() {
        let off = serde_json::json!({ "perspectiveCorrection": PerspectiveCorrectionSettingsV1::default() });
        let guided = serde_json::json!({ "perspectiveCorrection": converging_settings(100.0) });
        assert_ne!(
            crate::calculate_geometry_hash(&off),
            crate::calculate_geometry_hash(&guided)
        );
        let off_params = crate::geometry::get_geometry_params_from_json(&off);
        let guided_params = crate::geometry::get_geometry_params_from_json(&guided);
        assert!(crate::geometry::is_geometry_identity(&off_params));
        assert!(!crate::geometry::is_geometry_identity(&guided_params));
    }

    #[test]
    fn auto_level_uses_evidence_and_removes_measured_horizon_roll() {
        let analysis = PerspectiveAnalysisV1 {
            identity: PerspectiveAnalysisIdentityV1 {
                source_revision: 11,
                orientation_fingerprint: 12,
                lens_geometry_fingerprint: 13,
                analysis_dimensions: [1024, 768],
                implementation_version: PERSPECTIVE_IMPLEMENTATION_VERSION_V1,
            },
            horizon_angle_degrees: Some(8.0),
            lines: Vec::new(),
            confidence: 0.9,
            warning_codes: Vec::new(),
        };
        let settings = PerspectiveCorrectionSettingsV1 {
            mode: PerspectiveCorrectionMode::AutoLevel,
            amount: 100.0,
            crop_policy: PerspectiveCropPolicy::AutoCrop,
            guides: Vec::new(),
            resolved_plan: None,
        };
        let receipt = compile_perspective_plan_with_analysis(&settings, &analysis).unwrap();
        assert_eq!(receipt.plan.analysis_identity, Some(analysis.identity));
        assert_ne!(
            receipt.plan.source_to_corrected,
            matrix_to_array(Matrix3::identity())
        );
        assert!(receipt.plan.retained_area > 0.5);
    }

    #[test]
    fn amount_only_update_reuses_resolved_analysis_without_line_detection() {
        let full = compile_perspective_plan(&converging_settings(100.0))
            .unwrap()
            .plan;
        let mut settings = PerspectiveCorrectionSettingsV1 {
            mode: PerspectiveCorrectionMode::AutoFull,
            amount: 50.0,
            crop_policy: PerspectiveCropPolicy::AutoCrop,
            guides: Vec::new(),
            resolved_plan: Some(full.clone()),
        };
        let half = compile_perspective_plan(&settings).unwrap();
        assert_ne!(half.plan.source_to_corrected, full.source_to_corrected);
        assert!(half.condition_estimate.is_finite());
        settings.amount = 0.0;
        let zero = compile_perspective_plan(&settings).unwrap();
        assert_eq!(
            zero.plan.source_to_corrected,
            matrix_to_array(Matrix3::identity())
        );
    }

    #[test]
    fn legacy_manual_geometry_is_pixel_stable_without_explicit_upgrade() {
        let legacy = serde_json::json!({
            "transformVertical": 18.0,
            "transformHorizontal": -9.0,
            "transformRotate": 2.5,
            "transformAspect": 4.0,
            "transformScale": 104.0,
            "transformXOffset": 3.0,
            "transformYOffset": -2.0
        });
        let mut explicit = legacy.clone();
        explicit["perspectiveCorrection"] = serde_json::json!({
            "mode": "manual_legacy",
            "amount": 100.0,
            "cropPolicy": "preserve_current_crop",
            "guides": [],
            "resolvedPlan": null
        });
        let source = DynamicImage::ImageRgb32F(image::ImageBuffer::from_fn(96, 72, |x, y| {
            image::Rgb([x as f32 / 96.0, y as f32 / 72.0, 0.4])
        }));
        let implicit_pixels = crate::geometry::apply_geometry_warp(&source, &legacy)
            .into_owned()
            .to_rgb32f()
            .into_raw();
        let explicit_pixels = crate::geometry::apply_geometry_warp(&source, &explicit)
            .into_owned()
            .to_rgb32f()
            .into_raw();
        assert_eq!(implicit_pixels, explicit_pixels);
    }
}
