use crate::panorama_stitching::PanoramaProjectionOption;
use crate::panorama_utils::alignment_plan::AlignmentCancellation;
use crate::panorama_utils::alignment_plan::CalibratedAlignmentPlan;
use image::{DynamicImage, GrayImage, Rgb, Rgb32FImage};

pub const TILE_SIZE_PX: u32 = 512;
const MAX_OUTPUT_PIXELS: u64 = 250_000_000;

#[derive(Debug, Clone, PartialEq)]
pub struct ProjectionGeometry {
    pub projection: PanoramaProjectionOption,
    pub focal_length_px: f64,
    pub min_x: f64,
    pub min_y: f64,
    pub width: u32,
    pub height: u32,
    pub tile_count: u32,
}

pub struct ProjectedRender {
    pub geometry: ProjectionGeometry,
    pub image: Rgb32FImage,
    pub mask: GrayImage,
}

pub fn render_calibrated_projection<F>(
    images: &[DynamicImage],
    plan: &CalibratedAlignmentPlan,
    projection: PanoramaProjectionOption,
    cancellation: &AlignmentCancellation,
    mut stage: F,
) -> Result<ProjectedRender, String>
where
    F: FnMut(&str),
{
    if plan.readiness != "global_alignment_plan_ready" {
        return Err(format!(
            "Calibrated panorama render blocked: {}",
            plan.blocked_reasons.join(", ")
        ));
    }
    let solution = plan.global_solution.as_ref().ok_or_else(|| {
        "Calibrated panorama render requires a global camera solution.".to_string()
    })?;
    let focal = plan
        .sources
        .iter()
        .filter_map(|source| source.calibration.focal_length_px)
        .sum::<f64>()
        / plan
            .sources
            .iter()
            .filter(|source| source.calibration.focal_length_px.is_some())
            .count()
            .max(1) as f64;
    if !focal.is_finite() || focal <= 0.0 {
        return Err("Calibrated panorama render requires a finite focal length.".into());
    }
    stage("projection_bounds");
    cancellation.check("projection_bounds")?;
    let mut bounds = [
        f64::INFINITY,
        f64::INFINITY,
        f64::NEG_INFINITY,
        f64::NEG_INFINITY,
    ];
    for source in &plan.sources {
        let pose = solution
            .camera_poses
            .iter()
            .find(|pose| pose.source_index == source.source_index)
            .ok_or_else(|| format!("Missing camera pose for source {}.", source.source_index))?;
        for sample in edge_samples(source.width, source.height) {
            let projected = project_forward(sample, source.width, source.height, focal, projection);
            let x = projected[0] + pose.translation_px[0];
            let y = projected[1] + pose.translation_px[1];
            bounds[0] = bounds[0].min(x);
            bounds[1] = bounds[1].min(y);
            bounds[2] = bounds[2].max(x);
            bounds[3] = bounds[3].max(y);
        }
    }
    let width = checked_dimension(bounds[2] - bounds[0], "width")?;
    let height = checked_dimension(bounds[3] - bounds[1], "height")?;
    if u64::from(width) * u64::from(height) > MAX_OUTPUT_PIXELS {
        return Err("Calibrated panorama projected bounds exceed the bounded output limit.".into());
    }
    let tiles_x = width.div_ceil(TILE_SIZE_PX);
    let tiles_y = height.div_ceil(TILE_SIZE_PX);
    let geometry = ProjectionGeometry {
        projection,
        focal_length_px: focal,
        min_x: bounds[0],
        min_y: bounds[1],
        width,
        height,
        tile_count: tiles_x.saturating_mul(tiles_y),
    };
    let sources = images
        .iter()
        .map(DynamicImage::to_rgb32f)
        .collect::<Vec<_>>();
    let mut output = Rgb32FImage::new(width, height);
    let mut mask = GrayImage::new(width, height);
    stage("full_tile_render");
    for tile_y in 0..tiles_y {
        for tile_x in 0..tiles_x {
            cancellation.check("full_tile_render")?;
            let x0 = tile_x * TILE_SIZE_PX;
            let y0 = tile_y * TILE_SIZE_PX;
            let x1 = (x0 + TILE_SIZE_PX).min(width);
            let y1 = (y0 + TILE_SIZE_PX).min(height);
            for y in y0..y1 {
                for x in x0..x1 {
                    let world = [x as f64 + geometry.min_x, y as f64 + geometry.min_y];
                    let mut sum = [0.0f32; 3];
                    let mut weight = 0.0f32;
                    for (source, pose) in sources.iter().zip(&solution.camera_poses) {
                        let local = [
                            world[0] - pose.translation_px[0],
                            world[1] - pose.translation_px[1],
                        ];
                        let sample = project_inverse(
                            local,
                            source.width(),
                            source.height(),
                            focal,
                            projection,
                        );
                        if sample[0] >= 0.0
                            && sample[0] < source.width() as f64 - 1.0
                            && sample[1] >= 0.0
                            && sample[1] < source.height() as f64 - 1.0
                        {
                            let pixel = bilinear(source, sample[0], sample[1]);
                            let edge = sample[0]
                                .min(sample[1])
                                .min(source.width() as f64 - 1.0 - sample[0])
                                .min(source.height() as f64 - 1.0 - sample[1]);
                            let w = (edge / 32.0).clamp(0.05, 1.0) as f32;
                            for channel in 0..3 {
                                sum[channel] += pixel[channel] * w;
                            }
                            weight += w;
                        }
                    }
                    if weight > 0.0 {
                        output.put_pixel(
                            x,
                            y,
                            Rgb([sum[0] / weight, sum[1] / weight, sum[2] / weight]),
                        );
                        mask.put_pixel(x, y, image::Luma([255]));
                    }
                }
            }
        }
    }
    Ok(ProjectedRender {
        geometry,
        image: output,
        mask,
    })
}

fn edge_samples(width: u32, height: u32) -> Vec<[f64; 2]> {
    let mut samples = Vec::with_capacity(68);
    for step in 0..=16 {
        let x = width.saturating_sub(1) as f64 * step as f64 / 16.0;
        let y = height.saturating_sub(1) as f64 * step as f64 / 16.0;
        samples.extend([
            [x, 0.0],
            [x, height.saturating_sub(1) as f64],
            [0.0, y],
            [width.saturating_sub(1) as f64, y],
        ]);
    }
    samples
}

fn project_forward(
    point: [f64; 2],
    width: u32,
    height: u32,
    focal: f64,
    projection: PanoramaProjectionOption,
) -> [f64; 2] {
    let x = point[0] - width as f64 / 2.0;
    let y = point[1] - height as f64 / 2.0;
    match projection {
        PanoramaProjectionOption::Rectilinear => [x, y],
        PanoramaProjectionOption::Cylindrical => {
            let theta = (x / focal).atan();
            [focal * theta, focal * y / (x * x + focal * focal).sqrt()]
        }
        PanoramaProjectionOption::Spherical => unreachable!(),
    }
}

fn project_inverse(
    point: [f64; 2],
    width: u32,
    height: u32,
    focal: f64,
    projection: PanoramaProjectionOption,
) -> [f64; 2] {
    match projection {
        PanoramaProjectionOption::Rectilinear => [
            point[0] + width as f64 / 2.0,
            point[1] + height as f64 / 2.0,
        ],
        PanoramaProjectionOption::Cylindrical => {
            let theta = point[0] / focal;
            let x = focal * theta.tan();
            let y = point[1] / theta.cos();
            [x + width as f64 / 2.0, y + height as f64 / 2.0]
        }
        PanoramaProjectionOption::Spherical => unreachable!(),
    }
}

fn bilinear(image: &Rgb32FImage, x: f64, y: f64) -> Rgb<f32> {
    let x0 = x.floor() as u32;
    let y0 = y.floor() as u32;
    let x1 = (x0 + 1).min(image.width() - 1);
    let y1 = (y0 + 1).min(image.height() - 1);
    let dx = (x - x0 as f64) as f32;
    let dy = (y - y0 as f64) as f32;
    let mut out = [0.0; 3];
    for (channel, value) in out.iter_mut().enumerate() {
        let top =
            image.get_pixel(x0, y0)[channel] * (1.0 - dx) + image.get_pixel(x1, y0)[channel] * dx;
        let bottom =
            image.get_pixel(x0, y1)[channel] * (1.0 - dx) + image.get_pixel(x1, y1)[channel] * dx;
        *value = top * (1.0 - dy) + bottom * dy;
    }
    Rgb(out)
}

fn checked_dimension(span: f64, name: &str) -> Result<u32, String> {
    if !span.is_finite() || span < 0.0 || span.ceil() >= u32::MAX as f64 {
        return Err(format!("Invalid calibrated panorama {name} bounds."));
    }
    Ok(span.ceil() as u32 + 1)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::panorama_utils::alignment_plan::{
        AlignmentSource, CalibrationEvidence, CameraPose, GlobalSolution,
    };
    use image::RgbImage;

    #[test]
    fn cylindrical_projection_contracts_horizontal_edges() {
        let point = [199.0, 50.0];
        let rect = project_forward(
            point,
            200,
            100,
            100.0,
            PanoramaProjectionOption::Rectilinear,
        );
        let cylinder = project_forward(
            point,
            200,
            100,
            100.0,
            PanoramaProjectionOption::Cylindrical,
        );
        assert!(cylinder[0].abs() < rect[0].abs());
        let round_trip = project_inverse(
            cylinder,
            200,
            100,
            100.0,
            PanoramaProjectionOption::Cylindrical,
        );
        assert!((round_trip[0] - point[0]).abs() < 1e-9);
        assert!((round_trip[1] - point[1]).abs() < 1e-9);
    }

    #[test]
    fn calibrated_cpu_render_is_deterministic_and_projection_specific() {
        let images = fixture_images();
        let plan = fixture_plan();
        let render = |projection| {
            render_calibrated_projection(
                &images,
                &plan,
                projection,
                &AlignmentCancellation::default(),
                |_| {},
            )
            .unwrap()
        };
        let first = render(PanoramaProjectionOption::Cylindrical);
        let second = render(PanoramaProjectionOption::Cylindrical);
        let rectilinear = render(PanoramaProjectionOption::Rectilinear);
        assert_eq!(first.geometry, second.geometry);
        assert_eq!(first.image.as_raw(), second.image.as_raw());
        assert_ne!(first.image.as_raw(), rectilinear.image.as_raw());
        assert!(first.geometry.width < rectilinear.geometry.width);
        assert!(first.geometry.tile_count > 0);
        assert!(
            first.geometry.tile_count
                <= first.geometry.width.div_ceil(TILE_SIZE_PX)
                    * first.geometry.height.div_ceil(TILE_SIZE_PX)
        );
    }

    #[test]
    fn cancelled_projection_publishes_no_pixels() {
        let cancellation = AlignmentCancellation::default();
        cancellation.cancel();
        let result = render_calibrated_projection(
            &fixture_images(),
            &fixture_plan(),
            PanoramaProjectionOption::Cylindrical,
            &cancellation,
            |_| {},
        );
        assert!(matches!(result, Err(error) if error.contains("projection_bounds")));
    }

    fn fixture_images() -> Vec<DynamicImage> {
        (0..2)
            .map(|index| {
                let image = RgbImage::from_fn(96, 48, |x, y| {
                    image::Rgb([
                        (x + index * 31) as u8,
                        (y * 3) as u8,
                        ((x + y + index * 17) % 255) as u8,
                    ])
                });
                DynamicImage::ImageRgb8(image)
            })
            .collect()
    }

    fn fixture_plan() -> CalibratedAlignmentPlan {
        let sources = (0..2)
            .map(|source_index| AlignmentSource {
                source_index,
                content_hash: format!("blake3:source-{source_index}"),
                width: 96,
                height: 48,
                orientation: 1,
                calibration: CalibrationEvidence {
                    source: "verified_sidecar".into(),
                    focal_length_35mm: Some(37.5),
                    focal_length_px: Some(100.0),
                    principal_point_px: [48.0, 24.0],
                    radial_k1: Some(0.0),
                    observable: true,
                },
                feature_count: 100,
                feature_artifact_hash: format!("blake3:features-{source_index}"),
                texture_score: 1.0,
            })
            .collect();
        CalibratedAlignmentPlan {
            schema_version: "panorama_calibrated_alignment_plan_v1".into(),
            readiness: "global_alignment_plan_ready".into(),
            algorithm_id: "rapidraw_oriented_brief_calibrated_global_pose_v1".into(),
            policy_hash: "blake3:policy".into(),
            plan_hash: "blake3:plan".into(),
            sources,
            edges: Vec::new(),
            global_solution: Some(GlobalSolution {
                reference_source_index: 0,
                converged: true,
                iterations: 4,
                robust_loss: "huber".into(),
                residual_rms_px: 0.2,
                residual_p95_px: 0.4,
                cycle_closure_error_px: 0.0,
                camera_poses: vec![
                    CameraPose {
                        source_index: 0,
                        yaw_degrees: 0.0,
                        pitch_degrees: 0.0,
                        translation_px: [0.0, 0.0],
                    },
                    CameraPose {
                        source_index: 1,
                        yaw_degrees: 20.0,
                        pitch_degrees: 0.0,
                        translation_px: [62.0, 1.0],
                    },
                ],
            }),
            excluded_source_indices: Vec::new(),
            overlap_seam_handoff: Vec::new(),
            estimated_horizontal_fov_degrees: Some(88.0),
            warning_codes: Vec::new(),
            blocked_reasons: Vec::new(),
            completed_stages: vec!["plan_publish".into()],
        }
    }
}
