use std::{collections::BTreeSet, fs, io::Cursor, path::Path};

use image::{ColorType, ImageEncoder, Rgb, RgbImage, codecs::png::PngEncoder};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

const SCHEMA: &str = "rapidraw.color-visual-approval.v1";
const WIDTH: u32 = 96;
const HEIGHT: u32 = 64;

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ApprovalBindings {
    pub source_hash: String,
    pub graph_hash: String,
    pub profile_hash: String,
    pub output_identity_hash: String,
    pub hardware_hash: String,
    pub commit_hash: String,
    pub numeric_report_hash: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
struct ApprovalArtifact {
    kind: String,
    relative_path: String,
    sha256: String,
    binding_hash: String,
    width: u32,
    height: u32,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ApprovalManifest {
    schema: String,
    source_policy: String,
    preview_export_max_abs_delta: u8,
    bindings: ApprovalBindings,
    artifacts: Vec<ApprovalArtifact>,
}

pub(crate) fn hash_bytes(bytes: &[u8]) -> String {
    hex::encode(Sha256::digest(bytes))
}

pub(crate) fn generate_visual_approval_bundle(
    root: &Path,
    bindings: ApprovalBindings,
) -> Result<ApprovalManifest, String> {
    fs::create_dir_all(root).map_err(|error| error.to_string())?;
    validate_bindings(&bindings)?;
    let source = synthetic_alaska_landscape();
    let stage = map_image(&source, artistic_stage);
    let sdr = map_image(&stage, sdr_output);
    let hdr = map_image(&stage, hdr_output);
    let preview = sdr.clone();
    let export = sdr.clone();
    let binding_hash = hash_bytes(
        &serde_json::to_vec(&bindings).map_err(|error| format!("binding_encode:{error}"))?,
    );

    let outputs = [
        ("contact_sheet", contact_sheet(&[&source, &stage, &sdr])),
        (
            "stage_difference_heatmap",
            difference_heatmap(&source, &stage),
        ),
        ("hue_map", diagnostic_map(&stage, Diagnostic::Hue)),
        ("chroma_map", diagnostic_map(&stage, Diagnostic::Chroma)),
        (
            "lightness_map",
            diagnostic_map(&stage, Diagnostic::Lightness),
        ),
        ("clamp_gamut_overlay", clamp_gamut_overlay(&stage)),
        ("crop_100_percent", crop_100_percent(&stage)),
        ("sdr_rendition", sdr),
        ("hdr_rendition", hdr),
        (
            "preview_export_readback",
            preview_export_readback(&preview, &export),
        ),
    ];
    let mut artifacts = Vec::with_capacity(outputs.len());
    for (kind, image) in outputs {
        let relative_path = format!("{kind}.png");
        let bytes = encode_png(&image)?;
        fs::write(root.join(&relative_path), &bytes).map_err(|error| error.to_string())?;
        artifacts.push(ApprovalArtifact {
            kind: kind.to_string(),
            relative_path,
            sha256: hash_bytes(&bytes),
            binding_hash: binding_hash.clone(),
            width: image.width(),
            height: image.height(),
        });
    }
    let manifest = ApprovalManifest {
        schema: SCHEMA.to_string(),
        source_policy: "deterministic_synthetic_alaska_landscape_no_people_v1".to_string(),
        preview_export_max_abs_delta: max_abs_delta(&preview, &export),
        bindings,
        artifacts,
    };
    validate_visual_approval_bundle(root, &manifest)?;
    let encoded = serde_json::to_vec_pretty(&manifest).map_err(|error| error.to_string())?;
    fs::write(root.join("manifest.json"), encoded).map_err(|error| error.to_string())?;
    Ok(manifest)
}

pub(crate) fn validate_visual_approval_bundle(
    root: &Path,
    manifest: &ApprovalManifest,
) -> Result<(), String> {
    if manifest.schema != SCHEMA {
        return Err("visual_approval_schema_mismatch".to_string());
    }
    if manifest.preview_export_max_abs_delta != 0 {
        return Err("visual_approval_preview_export_divergence".to_string());
    }
    validate_bindings(&manifest.bindings)?;
    let expected_binding_hash = hash_bytes(
        &serde_json::to_vec(&manifest.bindings)
            .map_err(|error| format!("binding_encode:{error}"))?,
    );
    let expected_kinds = BTreeSet::from([
        "contact_sheet",
        "stage_difference_heatmap",
        "hue_map",
        "chroma_map",
        "lightness_map",
        "clamp_gamut_overlay",
        "crop_100_percent",
        "sdr_rendition",
        "hdr_rendition",
        "preview_export_readback",
    ]);
    let actual_kinds = manifest
        .artifacts
        .iter()
        .map(|artifact| artifact.kind.as_str())
        .collect::<BTreeSet<_>>();
    if actual_kinds != expected_kinds {
        return Err("visual_approval_artifact_inventory_mismatch".to_string());
    }
    for artifact in &manifest.artifacts {
        if artifact.binding_hash != expected_binding_hash {
            return Err(format!(
                "visual_approval_binding_mismatch:{}",
                artifact.kind
            ));
        }
        if artifact.relative_path.contains("..") || Path::new(&artifact.relative_path).is_absolute()
        {
            return Err("visual_approval_unsafe_artifact_path".to_string());
        }
        let bytes = fs::read(root.join(&artifact.relative_path))
            .map_err(|error| format!("visual_approval_artifact_read:{error}"))?;
        if hash_bytes(&bytes) != artifact.sha256 {
            return Err(format!(
                "visual_approval_artifact_hash_mismatch:{}",
                artifact.kind
            ));
        }
        let decoded = image::load_from_memory(&bytes)
            .map_err(|error| format!("visual_approval_artifact_decode:{error}"))?;
        if decoded.width() != artifact.width || decoded.height() != artifact.height {
            return Err(format!(
                "visual_approval_dimensions_mismatch:{}",
                artifact.kind
            ));
        }
    }
    Ok(())
}

fn validate_bindings(bindings: &ApprovalBindings) -> Result<(), String> {
    for (name, value) in [
        ("source", &bindings.source_hash),
        ("graph", &bindings.graph_hash),
        ("profile", &bindings.profile_hash),
        ("output", &bindings.output_identity_hash),
        ("hardware", &bindings.hardware_hash),
        ("commit", &bindings.commit_hash),
        ("numeric_report", &bindings.numeric_report_hash),
    ] {
        if value.len() != 64 || !value.bytes().all(|byte| byte.is_ascii_hexdigit()) {
            return Err(format!("visual_approval_invalid_{name}_hash"));
        }
    }
    Ok(())
}

fn synthetic_alaska_landscape() -> RgbImage {
    RgbImage::from_fn(WIDTH, HEIGHT, |x, y| {
        let xf = x as f32 / (WIDTH - 1) as f32;
        let yf = y as f32 / (HEIGHT - 1) as f32;
        let ridge = 0.43 + 0.09 * (xf * 17.0).sin() + 0.04 * (xf * 41.0).cos();
        let rgb = if yf < ridge {
            let cloud = ((xf * 29.0 + yf * 17.0).sin() * 0.5 + 0.5) * 0.08;
            [
                0.18 + 0.38 * (1.0 - yf) + cloud,
                0.34 + 0.42 * (1.0 - yf),
                0.58 + 0.36 * (1.0 - yf),
            ]
        } else if yf < 0.72 {
            let snow = ((yf - ridge) / (0.72 - ridge).max(0.02)).clamp(0.0, 1.0);
            [0.16 + snow * 0.62, 0.20 + snow * 0.65, 0.24 + snow * 0.68]
        } else {
            let reflection = 0.06 * (xf * 45.0).sin();
            [0.08 + reflection, 0.24 + reflection, 0.31 + reflection]
        };
        Rgb(rgb.map(to_u8))
    })
}

fn artistic_stage(rgb: [f32; 3]) -> [f32; 3] {
    let luma = 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
    [
        luma + (rgb[0] - luma) * 1.18 + 0.025,
        luma + (rgb[1] - luma) * 1.08 + 0.008,
        luma + (rgb[2] - luma) * 1.22 - 0.012,
    ]
}

fn sdr_output(rgb: [f32; 3]) -> [f32; 3] {
    rgb.map(|value| value.clamp(0.0, 1.0).powf(1.0 / 2.2))
}

fn hdr_output(rgb: [f32; 3]) -> [f32; 3] {
    rgb.map(|value| (value.max(0.0) / (1.0 + value.max(0.0) * 0.22)).powf(1.0 / 2.4))
}

fn map_image(image: &RgbImage, map: fn([f32; 3]) -> [f32; 3]) -> RgbImage {
    RgbImage::from_fn(image.width(), image.height(), |x, y| {
        let pixel = image.get_pixel(x, y).0.map(|value| value as f32 / 255.0);
        Rgb(map(pixel).map(to_u8))
    })
}

fn contact_sheet(images: &[&RgbImage]) -> RgbImage {
    let mut output = RgbImage::new(WIDTH * images.len() as u32, HEIGHT);
    for (column, image) in images.iter().enumerate() {
        for (x, y, pixel) in image.enumerate_pixels() {
            output.put_pixel(x + column as u32 * WIDTH, y, *pixel);
        }
    }
    output
}

fn difference_heatmap(left: &RgbImage, right: &RgbImage) -> RgbImage {
    RgbImage::from_fn(WIDTH, HEIGHT, |x, y| {
        let a = left.get_pixel(x, y).0;
        let b = right.get_pixel(x, y).0;
        let delta = (0..3)
            .map(|index| (i16::from(a[index]) - i16::from(b[index])).unsigned_abs() as f32)
            .sum::<f32>()
            / (3.0 * 255.0);
        Rgb([
            to_u8(delta * 4.0),
            to_u8((delta * 2.0 - 0.25).max(0.0)),
            to_u8(1.0 - delta * 3.0),
        ])
    })
}

enum Diagnostic {
    Hue,
    Chroma,
    Lightness,
}

fn diagnostic_map(image: &RgbImage, diagnostic: Diagnostic) -> RgbImage {
    RgbImage::from_fn(WIDTH, HEIGHT, |x, y| {
        let rgb = image.get_pixel(x, y).0.map(|value| value as f32 / 255.0);
        let maximum = rgb.into_iter().fold(f32::NEG_INFINITY, f32::max);
        let minimum = rgb.into_iter().fold(f32::INFINITY, f32::min);
        let chroma = maximum - minimum;
        let lightness = (maximum + minimum) * 0.5;
        let hue = if chroma <= f32::EPSILON {
            0.0
        } else if maximum == rgb[0] {
            ((rgb[1] - rgb[2]) / chroma).rem_euclid(6.0) / 6.0
        } else if maximum == rgb[1] {
            ((rgb[2] - rgb[0]) / chroma + 2.0) / 6.0
        } else {
            ((rgb[0] - rgb[1]) / chroma + 4.0) / 6.0
        };
        let value = match diagnostic {
            Diagnostic::Hue => hue,
            Diagnostic::Chroma => chroma,
            Diagnostic::Lightness => lightness,
        };
        Rgb([to_u8(value), to_u8(value), to_u8(value)])
    })
}

fn clamp_gamut_overlay(image: &RgbImage) -> RgbImage {
    RgbImage::from_fn(WIDTH, HEIGHT, |x, y| {
        let rgb = image.get_pixel(x, y).0;
        if rgb.iter().any(|value| *value <= 3) {
            Rgb([0, 64, 255])
        } else if rgb.iter().any(|value| *value >= 252) {
            Rgb([255, 32, 0])
        } else {
            Rgb(rgb.map(|value| value / 3))
        }
    })
}

fn crop_100_percent(image: &RgbImage) -> RgbImage {
    image::imageops::crop_imm(image, 31, 18, 32, 32).to_image()
}

fn preview_export_readback(preview: &RgbImage, export: &RgbImage) -> RgbImage {
    let mut output = RgbImage::new(WIDTH * 3, HEIGHT);
    for (x, y, pixel) in preview.enumerate_pixels() {
        output.put_pixel(x, y, *pixel);
        output.put_pixel(x + WIDTH, y, *export.get_pixel(x, y));
        let delta = pixel
            .0
            .iter()
            .zip(export.get_pixel(x, y).0)
            .map(|(left, right)| left.abs_diff(right))
            .max()
            .unwrap_or(0);
        output.put_pixel(x + WIDTH * 2, y, Rgb([delta, delta, delta]));
    }
    output
}

fn max_abs_delta(left: &RgbImage, right: &RgbImage) -> u8 {
    left.pixels()
        .zip(right.pixels())
        .flat_map(|(left, right)| left.0.into_iter().zip(right.0))
        .map(|(left, right)| left.abs_diff(right))
        .max()
        .unwrap_or(0)
}

fn encode_png(image: &RgbImage) -> Result<Vec<u8>, String> {
    let mut bytes = Cursor::new(Vec::new());
    PngEncoder::new(&mut bytes)
        .write_image(
            image.as_raw(),
            image.width(),
            image.height(),
            ColorType::Rgb8.into(),
        )
        .map_err(|error| error.to_string())?;
    Ok(bytes.into_inner())
}

fn to_u8(value: f32) -> u8 {
    (value.clamp(0.0, 1.0) * 255.0).round() as u8
}

#[cfg(test)]
mod tests {
    use super::*;

    fn digest(label: &str) -> String {
        hash_bytes(label.as_bytes())
    }

    fn bindings() -> ApprovalBindings {
        ApprovalBindings {
            source_hash: digest("synthetic-alaska-source-v1"),
            graph_hash: digest("scene-linear-to-display-graph-v1"),
            profile_hash: digest("controlled-display-p3-profile-v1"),
            output_identity_hash: digest("sdr-hdr-paired-output-v1"),
            hardware_hash: digest("test-wgpu-adapter-identity-v1"),
            commit_hash: digest("git-commit-fixture-v1"),
            numeric_report_hash: digest("numeric-backend-report-v1"),
        }
    }

    #[test]
    fn approval_artifacts_are_complete_hashed_and_deterministic() {
        let first = tempfile::tempdir().unwrap();
        let second = tempfile::tempdir().unwrap();
        let first_manifest = generate_visual_approval_bundle(first.path(), bindings()).unwrap();
        let second_manifest = generate_visual_approval_bundle(second.path(), bindings()).unwrap();

        assert_eq!(first_manifest, second_manifest);
        assert_eq!(first_manifest.artifacts.len(), 10);
        assert_eq!(first_manifest.preview_export_max_abs_delta, 0);
        validate_visual_approval_bundle(first.path(), &first_manifest).unwrap();
        for artifact in &first_manifest.artifacts {
            assert_eq!(
                fs::read(first.path().join(&artifact.relative_path)).unwrap(),
                fs::read(second.path().join(&artifact.relative_path)).unwrap()
            );
        }
    }

    #[test]
    fn injected_binding_and_artifact_mismatches_fail_closed() {
        let root = tempfile::tempdir().unwrap();
        let manifest = generate_visual_approval_bundle(root.path(), bindings()).unwrap();
        let mut wrong_binding = manifest.clone();
        wrong_binding.bindings.output_identity_hash = digest("wrong-output");
        assert!(
            validate_visual_approval_bundle(root.path(), &wrong_binding)
                .unwrap_err()
                .starts_with("visual_approval_binding_mismatch")
        );

        let artifact = &manifest.artifacts[0];
        fs::write(
            root.path().join(&artifact.relative_path),
            b"injected-corruption",
        )
        .unwrap();
        assert_eq!(
            validate_visual_approval_bundle(root.path(), &manifest).unwrap_err(),
            format!("visual_approval_artifact_hash_mismatch:{}", artifact.kind)
        );
    }
}
