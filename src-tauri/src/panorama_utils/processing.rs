use crate::panorama_stitching::{BRIEF_DESCRIPTOR_SIZE, Descriptor, Feature, KeyPoint, Match};
use image::{GrayImage, ImageBuffer, Luma};
use imageproc::corners::{Corner, corners_fast9};
use imageproc::filter::gaussian_blur_f32;
use nalgebra::{Matrix3, Point2, SymmetricEigen};
use rand::prelude::*;
use rayon::prelude::*;

pub const MAX_PROCESSING_DIMENSION: u32 = 1600;
const FAST_THRESHOLD: u8 = 15;
const NON_MAXIMA_SUPPRESSION_RADIUS: f32 = 15.0;
const BRIEF_PATCH_SIZE: u32 = 32;
const MATCH_RATIO_THRESHOLD: f32 = 0.8;
pub const RANSAC_ITERATIONS: usize = 2500;
pub const RANSAC_INLIER_THRESHOLD: f64 = 5.0;
pub const MIN_INLIERS_FOR_CONNECTION: usize = 15;
const LOW_DETAIL_WINDOW_RADIUS: u32 = 16;
const LOW_DETAIL_VARIANCE_THRESHOLD: f64 = 60.0;

pub fn calculate_downscale_dimensions(width: u32, height: u32) -> (u32, u32, f64) {
    let long_side = width.max(height);
    if long_side <= MAX_PROCESSING_DIMENSION {
        return (width, height, 1.0);
    }
    let scale_factor = long_side as f64 / MAX_PROCESSING_DIMENSION as f64;
    let new_width = (width as f64 / scale_factor).round() as u32;
    let new_height = (height as f64 / scale_factor).round() as u32;
    (new_width, new_height, scale_factor)
}

pub fn find_features(img: &GrayImage, brief_pairs: &[(Point2<i32>, Point2<i32>)]) -> Vec<Feature> {
    let blurred_img_u8 = imageproc::filter::gaussian_blur_f32(img, 1.5);
    let corners = corners_fast9(&blurred_img_u8, FAST_THRESHOLD);
    let keypoints = non_maximal_suppression(&corners, NON_MAXIMA_SUPPRESSION_RADIUS);
    let blurred_img_f32 = gaussian_blur_f32(&convert_gray_u8_to_f32(img), 2.0);
    let features: Vec<Feature> = keypoints
        .par_iter()
        .filter_map(|kp| {
            compute_brief_descriptor(&blurred_img_f32, kp, BRIEF_PATCH_SIZE, brief_pairs).map(
                |descriptor| Feature {
                    keypoint: *kp,
                    descriptor,
                },
            )
        })
        .collect();
    features
}

fn non_maximal_suppression(corners: &[Corner], radius: f32) -> Vec<KeyPoint> {
    let mut sorted_corners = corners.to_vec();
    sorted_corners.sort_by(|a, b| b.score.partial_cmp(&a.score).unwrap());
    let mut result = Vec::new();
    let radius_sq = radius * radius;
    let mut is_suppressed_grid = vec![false; sorted_corners.len()];
    for i in 0..sorted_corners.len() {
        if is_suppressed_grid[i] {
            continue;
        }
        let corner_i = sorted_corners[i];
        result.push(KeyPoint {
            x: corner_i.x,
            y: corner_i.y,
        });
        for j in (i + 1)..sorted_corners.len() {
            if is_suppressed_grid[j] {
                continue;
            }
            let corner_j = sorted_corners[j];
            let dx = corner_i.x as f32 - corner_j.x as f32;
            let dy = corner_i.y as f32 - corner_j.y as f32;
            if dx * dx + dy * dy < radius_sq {
                is_suppressed_grid[j] = true;
            }
        }
    }
    result
}

pub fn generate_brief_pairs() -> Vec<(Point2<i32>, Point2<i32>)> {
    let mut rng = StdRng::seed_from_u64(12345);
    let half_patch = BRIEF_PATCH_SIZE as i32 / 2;
    let distribution = match rand::distr::Uniform::new(-half_patch, half_patch) {
        Ok(dist) => dist,
        Err(e) => panic!("Failed to create uniform distribution: {}", e),
    };

    (0..BRIEF_DESCRIPTOR_SIZE)
        .map(|_| {
            (
                Point2::new(distribution.sample(&mut rng), distribution.sample(&mut rng)),
                Point2::new(distribution.sample(&mut rng), distribution.sample(&mut rng)),
            )
        })
        .collect()
}

fn compute_brief_descriptor(
    img: &ImageBuffer<Luma<f32>, Vec<f32>>,
    kp: &KeyPoint,
    patch_size: u32,
    pairs: &[(Point2<i32>, Point2<i32>)],
) -> Option<Descriptor> {
    let mut descriptor = [0u8; BRIEF_DESCRIPTOR_SIZE / 8];
    let (width, height) = img.dimensions();
    let half_patch_size = patch_size / 2;
    if kp.x < half_patch_size
        || kp.x >= width - half_patch_size
        || kp.y < half_patch_size
        || kp.y >= height - half_patch_size
    {
        return None;
    }
    for (i, pair) in pairs.iter().enumerate() {
        let p1_x = (kp.x as i32 + pair.0.x) as u32;
        let p1_y = (kp.y as i32 + pair.0.y) as u32;
        let p2_x = (kp.x as i32 + pair.1.x) as u32;
        let p2_y = (kp.y as i32 + pair.1.y) as u32;
        let intensity1 = img.get_pixel(p1_x, p1_y)[0];
        let intensity2 = img.get_pixel(p2_x, p2_y)[0];
        if intensity1 < intensity2 {
            let byte_index = i / 8;
            let bit_index = i % 8;
            descriptor[byte_index] |= 1 << bit_index;
        }
    }
    Some(descriptor)
}

fn hamming_distance(d1: &Descriptor, d2: &Descriptor) -> u32 {
    d1.iter()
        .zip(d2.iter())
        .map(|(b1, b2)| (b1 ^ b2).count_ones())
        .sum()
}

pub fn match_features(features1: &[Feature], features2: &[Feature]) -> Vec<Match> {
    if features1.is_empty() || features2.is_empty() {
        return Vec::new();
    }
    let forward_matches = best_ratio_matches(features1, features2);
    let reverse_matches = best_ratio_matches(features2, features1);

    forward_matches
        .into_iter()
        .enumerate()
        .filter_map(|(index1, index2)| {
            let index2 = index2?;
            if reverse_matches.get(index2).copied().flatten() == Some(index1) {
                Some(Match { index1, index2 })
            } else {
                None
            }
        })
        .collect()
}

fn best_ratio_matches(
    query_features: &[Feature],
    train_features: &[Feature],
) -> Vec<Option<usize>> {
    query_features
        .par_iter()
        .enumerate()
        .map(|(i, f1)| {
            let mut best_dist = u32::MAX;
            let mut second_best_dist = u32::MAX;
            let mut best_idx = 0;
            for (j, f2) in train_features.iter().enumerate() {
                let dist = hamming_distance(&f1.descriptor, &f2.descriptor);
                if dist < best_dist {
                    second_best_dist = best_dist;
                    best_dist = dist;
                    best_idx = j;
                } else if dist < second_best_dist {
                    second_best_dist = dist;
                }
            }
            if second_best_dist > 0
                && (best_dist as f32 / second_best_dist as f32) < MATCH_RATIO_THRESHOLD
            {
                (i, Some(best_idx))
            } else {
                (i, None)
            }
        })
        .collect::<Vec<_>>()
        .into_iter()
        .fold(
            vec![None; query_features.len()],
            |mut matches, (index, best)| {
                matches[index] = best;
                matches
            },
        )
}

pub fn find_homography_ransac(
    matches: &[Match],
    keypoints1: &[KeyPoint],
    keypoints2: &[KeyPoint],
) -> Option<(Matrix3<f64>, Vec<Match>)> {
    let mut rng = StdRng::seed_from_u64(ransac_seed(matches, keypoints1, keypoints2));
    let mut best_h: Option<Matrix3<f64>> = None;
    let mut best_inliers: Vec<Match> = Vec::new();

    let points: Vec<(Point2<f64>, Point2<f64>)> = matches
        .iter()
        .map(|m| {
            let p1 = keypoints1[m.index1];
            let p2 = keypoints2[m.index2];
            (
                Point2::new(p1.x as f64, p1.y as f64),
                Point2::new(p2.x as f64, p2.y as f64),
            )
        })
        .collect();

    if points.len() < 4 {
        return None;
    }

    let ransac_inlier_threshold_sq = RANSAC_INLIER_THRESHOLD.powi(2);

    for _ in 0..RANSAC_ITERATIONS {
        let sample_indices: Vec<usize> = (0..points.len()).collect();
        let sample_indices = sample_indices
            .sample(&mut rng, 4)
            .cloned()
            .collect::<Vec<_>>();
        if sample_indices.len() < 4 {
            continue;
        }

        let sample_points: Vec<(Point2<f64>, Point2<f64>)> =
            sample_indices.iter().map(|&i| points[i]).collect();

        if correspondence_set_is_degenerate(&sample_points) {
            continue;
        }

        if let Some(h) = compute_homography(&sample_points) {
            let current_inliers: Vec<Match> = matches
                .par_iter()
                .enumerate()
                .filter_map(|(i, m)| {
                    let (p1, p2) = points[i];
                    let p1_h = nalgebra::Point3::new(p1.x, p1.y, 1.0);
                    let p2_h_transformed = h * p1_h;
                    if p2_h_transformed.z.abs() < 1e-8 {
                        return None;
                    }
                    let p2_transformed = Point2::new(
                        p2_h_transformed.x / p2_h_transformed.z,
                        p2_h_transformed.y / p2_h_transformed.z,
                    );
                    let dist_sq =
                        (p2.x - p2_transformed.x).powi(2) + (p2.y - p2_transformed.y).powi(2);
                    if dist_sq < ransac_inlier_threshold_sq {
                        Some(*m)
                    } else {
                        None
                    }
                })
                .collect();

            if current_inliers.len() > best_inliers.len() {
                best_inliers = current_inliers;
                best_h = Some(h);
            }
        }
    }

    if best_inliers.len() >= MIN_INLIERS_FOR_CONNECTION {
        Some((best_h.unwrap(), best_inliers))
    } else {
        None
    }
}

pub fn mean_reprojection_error(
    homography: &Matrix3<f64>,
    inliers: &[Match],
    keypoints1: &[KeyPoint],
    keypoints2: &[KeyPoint],
) -> f64 {
    if inliers.is_empty() {
        return f64::INFINITY;
    }
    let sum = inliers
        .iter()
        .map(|matched| {
            let p1 = keypoints1[matched.index1];
            let p2 = keypoints2[matched.index2];
            let transformed = homography * nalgebra::Point3::new(p1.x as f64, p1.y as f64, 1.0);
            if transformed.z.abs() < 1e-8 {
                return f64::INFINITY;
            }
            let projected =
                Point2::new(transformed.x / transformed.z, transformed.y / transformed.z);
            ((p2.x as f64 - projected.x).powi(2) + (p2.y as f64 - projected.y).powi(2)).sqrt()
        })
        .sum::<f64>();
    sum / inliers.len() as f64
}

fn ransac_seed(matches: &[Match], keypoints1: &[KeyPoint], keypoints2: &[KeyPoint]) -> u64 {
    let mut hash = 0xcbf29ce484222325_u64;
    mix_u64(&mut hash, matches.len() as u64);
    for matched in matches {
        mix_u64(&mut hash, matched.index1 as u64);
        mix_u64(&mut hash, matched.index2 as u64);
        if let Some(point) = keypoints1.get(matched.index1) {
            mix_u64(&mut hash, point.x as u64);
            mix_u64(&mut hash, point.y as u64);
        }
        if let Some(point) = keypoints2.get(matched.index2) {
            mix_u64(&mut hash, point.x as u64);
            mix_u64(&mut hash, point.y as u64);
        }
    }
    hash
}

fn mix_u64(hash: &mut u64, value: u64) {
    *hash ^= value;
    *hash = hash.wrapping_mul(0x100000001b3);
}

fn are_points_collinear(p1: Point2<f64>, p2: Point2<f64>, p3: Point2<f64>) -> bool {
    let area = p1.x * (p2.y - p3.y) + p2.x * (p3.y - p1.y) + p3.x * (p1.y - p2.y);
    area.abs() < 1e-6
}

fn has_non_collinear_triplet(points: &[Point2<f64>]) -> bool {
    for first in 0..points.len() {
        for second in (first + 1)..points.len() {
            for third in (second + 1)..points.len() {
                if !are_points_collinear(points[first], points[second], points[third]) {
                    return true;
                }
            }
        }
    }
    false
}

fn correspondence_set_is_degenerate(points: &[(Point2<f64>, Point2<f64>)]) -> bool {
    if points.len() < 4 {
        return true;
    }
    let source_points = points.iter().map(|point| point.0).collect::<Vec<_>>();
    let target_points = points.iter().map(|point| point.1).collect::<Vec<_>>();
    !has_non_collinear_triplet(&source_points) || !has_non_collinear_triplet(&target_points)
}

pub fn compute_homography(points: &[(Point2<f64>, Point2<f64>)]) -> Option<Matrix3<f64>> {
    if correspondence_set_is_degenerate(points) {
        return None;
    }
    let source_points = points.iter().map(|point| point.0).collect::<Vec<_>>();
    let target_points = points.iter().map(|point| point.1).collect::<Vec<_>>();
    let (normalized_source_points, source_transform) = normalize_points(&source_points)?;
    let (normalized_target_points, target_transform) = normalize_points(&target_points)?;

    let mut a_rows = Vec::with_capacity(points.len() * 2);
    for (p1, p2) in normalized_source_points
        .iter()
        .zip(normalized_target_points.iter())
    {
        let (x, y) = (p1.x, p1.y);
        let (xp, yp) = (p2.x, p2.y);
        a_rows.push(nalgebra::RowDVector::from_vec(vec![
            -x,
            -y,
            -1.0,
            0.0,
            0.0,
            0.0,
            x * xp,
            y * xp,
            xp,
        ]));
        a_rows.push(nalgebra::RowDVector::from_vec(vec![
            0.0,
            0.0,
            0.0,
            -x,
            -y,
            -1.0,
            x * yp,
            y * yp,
            yp,
        ]));
    }
    let a = nalgebra::DMatrix::from_rows(&a_rows);
    let normal_matrix = a.transpose() * a;
    let eigendecomposition = SymmetricEigen::new(normal_matrix);
    let smallest_eigenvalue_index = eigendecomposition
        .eigenvalues
        .iter()
        .enumerate()
        .min_by(|(_, left), (_, right)| left.total_cmp(right))
        .map(|(index, _)| index)?;
    let h_vec = eigendecomposition
        .eigenvectors
        .column(smallest_eigenvalue_index)
        .clone_owned();
    let normalized_homography = Matrix3::from_iterator(h_vec.iter().cloned()).transpose();
    let target_transform_inv = target_transform.try_inverse()?;
    normalize_homography_scale(target_transform_inv * normalized_homography * source_transform)
}

fn normalize_points(points: &[Point2<f64>]) -> Option<(Vec<Point2<f64>>, Matrix3<f64>)> {
    if points.is_empty() {
        return None;
    }
    let center_x = points.iter().map(|point| point.x).sum::<f64>() / points.len() as f64;
    let center_y = points.iter().map(|point| point.y).sum::<f64>() / points.len() as f64;
    let mean_distance = points
        .iter()
        .map(|point| ((point.x - center_x).powi(2) + (point.y - center_y).powi(2)).sqrt())
        .sum::<f64>()
        / points.len() as f64;
    if !mean_distance.is_finite() || mean_distance <= f64::EPSILON {
        return None;
    }

    let scale = 2.0_f64.sqrt() / mean_distance;
    let transform = Matrix3::new(
        scale,
        0.0,
        -scale * center_x,
        0.0,
        scale,
        -scale * center_y,
        0.0,
        0.0,
        1.0,
    );
    let normalized_points = points
        .iter()
        .map(|point| {
            let normalized = transform * nalgebra::Point3::new(point.x, point.y, 1.0);
            Point2::new(normalized.x / normalized.z, normalized.y / normalized.z)
        })
        .collect();

    Some((normalized_points, transform))
}

fn normalize_homography_scale(homography: Matrix3<f64>) -> Option<Matrix3<f64>> {
    if !homography.iter().all(|value| value.is_finite()) {
        return None;
    }
    if homography[(2, 2)].abs() > f64::EPSILON {
        return Some(homography / homography[(2, 2)]);
    }
    let norm = homography.norm();
    if norm.is_finite() && norm > f64::EPSILON {
        Some(homography / norm)
    } else {
        None
    }
}

fn convert_gray_u8_to_f32(img: &GrayImage) -> ImageBuffer<Luma<f32>, Vec<f32>> {
    let (width, height) = img.dimensions();
    ImageBuffer::from_fn(width, height, |x, y| {
        Luma([img.get_pixel(x, y)[0] as f32 / 255.0])
    })
}

fn build_integral_images(gray: &GrayImage) -> (Vec<u64>, Vec<u128>) {
    let (width, height) = gray.dimensions();
    let mut sat = vec![0u64; (width * height) as usize];
    let mut sat_sq = vec![0u128; (width * height) as usize];

    for y in 0..height {
        let mut row_sum = 0u64;
        let mut row_sum_sq = 0u128;
        for x in 0..width {
            let pixel_val = gray.get_pixel(x, y)[0] as u64;
            let pixel_val_sq = pixel_val as u128 * pixel_val as u128;
            row_sum += pixel_val;
            row_sum_sq += pixel_val_sq;

            let idx = (y * width + x) as usize;
            let above_idx = if y > 0 {
                ((y - 1) * width + x) as usize
            } else {
                usize::MAX
            };

            sat[idx] = row_sum
                + if above_idx != usize::MAX {
                    sat[above_idx]
                } else {
                    0
                };
            sat_sq[idx] = row_sum_sq
                + if above_idx != usize::MAX {
                    sat_sq[above_idx]
                } else {
                    0
                };
        }
    }
    (sat, sat_sq)
}

pub fn generate_low_detail_mask(gray_full: &GrayImage) -> GrayImage {
    println!("    - Generating low-detail mask...");
    let (width, height) = gray_full.dimensions();
    let mut mask = GrayImage::new(width, height);
    let (sat, sat_sq) = build_integral_images(gray_full);
    let r = LOW_DETAIL_WINDOW_RADIUS as i32;

    let get_sat_val = |s: &Vec<u64>, x: i32, y: i32| -> u64 {
        if x < 0 || y < 0 {
            0
        } else {
            s[(y as u32 * width + x as u32) as usize]
        }
    };
    let get_sat_sq_val = |s: &Vec<u128>, x: i32, y: i32| -> u128 {
        if x < 0 || y < 0 {
            0
        } else {
            s[(y as u32 * width + x as u32) as usize]
        }
    };

    mask.par_chunks_mut(width as usize)
        .enumerate()
        .for_each(|(y, row)| {
            for x in 0..width as i32 {
                let x1 = x - r - 1;
                let y1 = y as i32 - r - 1;
                let x2 = (x + r).min(width as i32 - 1);
                let y2 = (y as i32 + r).min(height as i32 - 1);

                let n_x = (x2 - (x1 + 1) + 1) as f64;
                let n_y = (y2 - (y1 + 1) + 1) as f64;
                let n = n_x * n_y;
                if n < 1.0 {
                    continue;
                }

                let sum = get_sat_val(&sat, x2, y2) + get_sat_val(&sat, x1, y1)
                    - get_sat_val(&sat, x2, y1)
                    - get_sat_val(&sat, x1, y2);
                let sum_sq = get_sat_sq_val(&sat_sq, x2, y2) + get_sat_sq_val(&sat_sq, x1, y1)
                    - get_sat_sq_val(&sat_sq, x2, y1)
                    - get_sat_sq_val(&sat_sq, x1, y2);

                let mean = sum as f64 / n;
                let variance = (sum_sq as f64 / n) - mean.powi(2);

                if variance < LOW_DETAIL_VARIANCE_THRESHOLD {
                    row[x as usize] = 255;
                } else {
                    row[x as usize] = 0;
                }
            }
        });
    mask
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn match_features_keeps_only_reciprocal_one_to_one_pairs() {
        let features1 = vec![
            feature_with_descriptor(0, 0),
            feature_with_descriptor(1, 1),
            feature_with_descriptor(240, 2),
        ];
        let features2 = vec![
            feature_with_descriptor(0, 0),
            feature_with_descriptor(240, 1),
            feature_with_descriptor(255, 2),
        ];

        let matches = match_features(&features1, &features2);

        assert_eq!(match_pairs(&matches), vec![(0, 0), (2, 1)]);
    }

    #[test]
    fn match_features_rejects_non_reciprocal_duplicate_target() {
        let features1 = vec![feature_with_descriptor(0, 0), feature_with_descriptor(1, 1)];
        let features2 = vec![
            feature_with_descriptor(0, 0),
            feature_with_descriptor(255, 1),
        ];

        let matches = match_features(&features1, &features2);

        assert_eq!(match_pairs(&matches), vec![(0, 0)]);
    }

    #[test]
    fn compute_homography_rejects_source_collinear_points() {
        let points = vec![
            (Point2::new(0.0, 0.0), Point2::new(0.0, 0.0)),
            (Point2::new(1.0, 0.0), Point2::new(1.0, 0.0)),
            (Point2::new(2.0, 0.0), Point2::new(2.0, 1.0)),
            (Point2::new(3.0, 0.0), Point2::new(3.0, 1.0)),
        ];

        assert!(compute_homography(&points).is_none());
    }

    #[test]
    fn compute_homography_rejects_target_collinear_points() {
        let points = vec![
            (Point2::new(0.0, 0.0), Point2::new(0.0, 0.0)),
            (Point2::new(1.0, 0.0), Point2::new(1.0, 0.0)),
            (Point2::new(0.0, 1.0), Point2::new(2.0, 0.0)),
            (Point2::new(1.0, 1.0), Point2::new(3.0, 0.0)),
        ];

        assert!(compute_homography(&points).is_none());
    }

    #[test]
    fn compute_homography_recovers_large_coordinate_translation() {
        let points = vec![
            (
                Point2::new(10_000.0, 20_000.0),
                Point2::new(10_125.0, 19_950.0),
            ),
            (
                Point2::new(16_000.0, 20_500.0),
                Point2::new(16_125.0, 20_450.0),
            ),
            (
                Point2::new(10_500.0, 25_500.0),
                Point2::new(10_625.0, 25_450.0),
            ),
            (
                Point2::new(16_500.0, 26_000.0),
                Point2::new(16_625.0, 25_950.0),
            ),
            (
                Point2::new(13_000.0, 23_200.0),
                Point2::new(13_125.0, 23_150.0),
            ),
        ];

        let homography = compute_homography(&points).expect("translation homography");

        assert!((homography[(0, 2)] - 125.0).abs() < 1e-6);
        assert!((homography[(1, 2)] + 50.0).abs() < 1e-6);
        assert!((homography[(2, 2)] - 1.0).abs() < 1e-9);
    }

    #[test]
    fn compute_homography_recovers_exact_four_point_translation() {
        let points = vec![
            (Point2::new(0.0, 0.0), Point2::new(125.0, -50.0)),
            (Point2::new(4000.0, 0.0), Point2::new(4125.0, -50.0)),
            (Point2::new(0.0, 3000.0), Point2::new(125.0, 2950.0)),
            (Point2::new(4000.0, 3000.0), Point2::new(4125.0, 2950.0)),
        ];

        let homography = compute_homography(&points).expect("four-point translation homography");

        assert!((homography[(0, 2)] - 125.0).abs() < 1e-6);
        assert!((homography[(1, 2)] + 50.0).abs() < 1e-6);
        assert!((homography[(2, 2)] - 1.0).abs() < 1e-9);
    }

    #[test]
    fn compute_homography_recovers_projective_transform() {
        let expected_homography =
            Matrix3::new(1.1, 0.08, 125.0, -0.04, 0.95, -50.0, 0.00003, -0.00002, 1.0);
        let source_points = [
            Point2::new(10_000.0, 20_000.0),
            Point2::new(16_000.0, 20_500.0),
            Point2::new(10_500.0, 25_500.0),
            Point2::new(16_500.0, 26_000.0),
            Point2::new(13_000.0, 23_200.0),
        ];
        let points = source_points
            .iter()
            .map(|source| (*source, project_point(&expected_homography, *source)))
            .collect::<Vec<_>>();

        let homography = compute_homography(&points).expect("projective homography");

        for (source, target) in points {
            let projected = project_point(&homography, source);
            assert!((projected.x - target.x).abs() < 1e-4);
            assert!((projected.y - target.y).abs() < 1e-4);
        }
        assert!(homography[(2, 0)].abs() > 1e-7);
        assert!(homography[(2, 1)].abs() > 1e-7);
    }

    fn project_point(homography: &Matrix3<f64>, point: Point2<f64>) -> Point2<f64> {
        let projected = homography * nalgebra::Point3::new(point.x, point.y, 1.0);
        Point2::new(projected.x / projected.z, projected.y / projected.z)
    }

    #[test]
    fn ransac_homography_is_deterministic_for_same_inputs() {
        let mut keypoints1 = Vec::new();
        let mut keypoints2 = Vec::new();
        let mut matches = Vec::new();

        for index in 0..24 {
            let x = 20 + (index % 6) as u32 * 17;
            let y = 30 + (index / 6) as u32 * 19;
            keypoints1.push(KeyPoint { x, y });
            if index < 20 {
                keypoints2.push(KeyPoint { x: x + 7, y: y + 5 });
            } else {
                keypoints2.push(KeyPoint {
                    x: 240 - index as u32 * 3,
                    y: 180 + index as u32,
                });
            }
            matches.push(Match {
                index1: index,
                index2: index,
            });
        }

        let (expected_homography, expected_inliers) =
            find_homography_ransac(&matches, &keypoints1, &keypoints2)
                .expect("synthetic translation homography should be found");

        for _ in 0..8 {
            let (homography, inliers) = find_homography_ransac(&matches, &keypoints1, &keypoints2)
                .expect("synthetic translation homography should be found");
            assert_eq!(match_pairs(&inliers), match_pairs(&expected_inliers));
            assert_eq!(homography.as_slice(), expected_homography.as_slice());
        }
    }

    fn match_pairs(matches: &[Match]) -> Vec<(usize, usize)> {
        matches
            .iter()
            .map(|matched| (matched.index1, matched.index2))
            .collect()
    }

    fn feature_with_descriptor(first_byte: u8, offset: u32) -> Feature {
        let mut descriptor = [0_u8; BRIEF_DESCRIPTOR_SIZE / 8];
        descriptor[0] = first_byte;
        Feature {
            descriptor,
            keypoint: KeyPoint {
                x: 20 + offset,
                y: 30 + offset,
            },
        }
    }
}
