use crate::merge::tile_runtime::{AcceptedTilePlan, TileHalo, TilePlanRequest, plan_tiles};

pub(crate) const FULL_RESOLUTION_APPLY_ALGORITHM_ID: &str =
    "hdr_calibrated_full_resolution_tiles_v1";

pub(crate) fn build_tile_plan(
    width: u64,
    height: u64,
    source_count: u64,
) -> Result<AcceptedTilePlan, String> {
    plan_tiles(TilePlanRequest {
        schema_version: 1,
        output_width: width,
        output_height: height,
        bytes_per_working_pixel: 16,
        source_count,
        requested_core_width: 1024,
        requested_core_height: 1024,
        halo: TileHalo {
            top: 16,
            right: 16,
            bottom: 16,
            left: 16,
        },
        memory_budget_bytes: None,
    })
}

#[cfg(test)]
mod full_resolution_tests {
    use super::*;

    #[test]
    fn alaska_scale_output_requires_deterministic_multiple_tiles() {
        let first = build_tile_plan(6048, 4024, 3).unwrap();
        let second = build_tile_plan(6048, 4024, 3).unwrap();
        assert!(first.tile_count > 1);
        assert_eq!(first.plan_hash, second.plan_hash);
        assert_eq!(first.reduction_order, "source_then_row_major_tile");
        assert!(first.memory.estimated_peak_bytes <= first.memory_budget_bytes);
    }
}

#[cfg(test)]
mod derived_output_tests {
    use std::io::Cursor;
    use std::path::Path;

    use image::{DynamicImage, GenericImageView, ImageBuffer, ImageFormat, ImageReader, Rgb};
    use image_hdr::hdr_merge_images;
    use image_hdr::input::HDRInput;

    use super::*;
    use crate::merge::atomic_derived_output::{
        AtomicDerivedOutputTransaction, AtomicOutputFault, DerivedOutputManifest,
        recover_atomic_derived_outputs,
    };

    fn tiff_bytes(exposure: f32) -> Vec<u8> {
        let pixels = ImageBuffer::<Rgb<f32>, _>::from_fn(65, 33, |x, y| {
            let value = ((x + y) as f32 / 96.0) * exposure;
            Rgb([value, value * 0.8, value * 0.6])
        });
        let mut bytes = Cursor::new(Vec::new());
        DynamicImage::ImageRgb32F(pixels)
            .write_to(&mut bytes, ImageFormat::Tiff)
            .unwrap();
        bytes.into_inner()
    }

    fn manifest() -> DerivedOutputManifest {
        DerivedOutputManifest {
            schema_version: 1,
            family: "hdr".to_string(),
            width: 65,
            height: 33,
            payload_path: "payload.tiff".to_string(),
            preview_paths: vec!["preview.png".to_string()],
            map_paths: vec!["maps/ownership.bin".to_string()],
            source_immutability_hashes: vec!["blake3:under".to_string(), "blake3:over".to_string()],
        }
    }

    fn staged(root: &Path) -> AtomicDerivedOutputTransaction {
        let payload = tiff_bytes(1.0);
        let preview = DynamicImage::ImageRgb8(
            image::load_from_memory_with_format(&payload, ImageFormat::Tiff)
                .unwrap()
                .to_rgb8(),
        );
        let mut preview_bytes = Cursor::new(Vec::new());
        preview
            .write_to(&mut preview_bytes, ImageFormat::Png)
            .unwrap();
        let mut transaction = AtomicDerivedOutputTransaction::begin(root, "result.rrhdr").unwrap();
        transaction.write_file("payload.tiff", &payload).unwrap();
        transaction
            .write_file("preview.png", preview_bytes.get_ref())
            .unwrap();
        transaction
            .write_file("maps/ownership.bin", &[0, 1, 1, 0])
            .unwrap();
        transaction.stage_manifest(&manifest()).unwrap();
        transaction
    }

    #[test]
    fn package_reopens_edits_and_exports_without_mutating_base() {
        let root = tempfile::tempdir().unwrap();
        let receipt = staged(root.path())
            .commit(&manifest(), |package| {
                package
                    .join("payload.tiff")
                    .is_file()
                    .then_some(())
                    .ok_or_else(|| "registration_failed".to_string())
            })
            .unwrap();
        let payload_path = Path::new(&receipt.final_package_path).join("payload.tiff");
        let before = std::fs::read(&payload_path).unwrap();
        let reopened = image::open(&payload_path).unwrap().to_rgb32f();
        let edited =
            ImageBuffer::<Rgb<f32>, _>::from_fn(reopened.width(), reopened.height(), |x, y| {
                let source = reopened.get_pixel(x, y);
                Rgb([source[0] * 0.75, source[1] * 0.75, source[2] * 0.75])
            });
        let mut edited_tiff = Cursor::new(Vec::new());
        DynamicImage::ImageRgb32F(edited.clone())
            .write_to(&mut edited_tiff, ImageFormat::Tiff)
            .unwrap();
        let mut edited_jpeg = Cursor::new(Vec::new());
        DynamicImage::ImageRgb8(DynamicImage::ImageRgb32F(edited).to_rgb8())
            .write_to(&mut edited_jpeg, ImageFormat::Jpeg)
            .unwrap();
        assert_eq!(
            image::load_from_memory_with_format(edited_tiff.get_ref(), ImageFormat::Tiff)
                .unwrap()
                .dimensions(),
            (65, 33)
        );
        assert_eq!(
            image::load_from_memory_with_format(edited_jpeg.get_ref(), ImageFormat::Jpeg)
                .unwrap()
                .dimensions(),
            (65, 33)
        );
        assert_eq!(before, std::fs::read(payload_path).unwrap());
        assert_eq!(
            receipt.payload_hash,
            format!("blake3:{}", blake3::hash(&before).to_hex())
        );
    }

    #[test]
    fn cancellation_fault_cannot_publish_and_registration_recovers() {
        let root = tempfile::tempdir().unwrap();
        let mut cancelled = staged(root.path());
        cancelled.inject_fault(AtomicOutputFault::Marker);
        assert!(cancelled.commit(&manifest(), |_| Ok(())).is_err());
        assert_eq!(std::fs::read_dir(root.path()).unwrap().count(), 0);

        let mut unregistered = staged(root.path());
        unregistered.inject_fault(AtomicOutputFault::Registration);
        let receipt = unregistered.commit(&manifest(), |_| Ok(())).unwrap();
        assert_eq!(receipt.commit_status, "unregistered");
        assert_eq!(
            recover_atomic_derived_outputs(root.path()).unwrap().len(),
            1
        );
    }

    #[test]
    fn private_alaska_raw_apply_reopen_export_when_enabled() {
        if std::env::var("RAWENGINE_RUN_PRIVATE_HDR_APPLY_PROOF")
            .ok()
            .as_deref()
            != Some("1")
        {
            return;
        }
        let root = std::path::PathBuf::from(std::env::var("RAWENGINE_PRIVATE_RAW_ROOT").unwrap());
        let source_paths = [
            "private-fixtures/hdr/bracket-alignment-v1/frame-01-under.arw",
            "private-fixtures/hdr/bracket-alignment-v1/frame-02-mid.arw",
            "private-fixtures/hdr/bracket-alignment-v1/frame-03-over.arw",
        ]
        .map(|relative| root.join(relative));
        let mut source_hashes = Vec::new();
        let mut inputs = Vec::new();
        for path in &source_paths {
            let bytes = std::fs::read(path).unwrap();
            source_hashes.push(format!("blake3:{}", blake3::hash(&bytes).to_hex()));
            let (image, _) = crate::raw::raw_processing::develop_raw_image_with_report(
                &bytes,
                false,
                crate::raw::raw_processing::RawProcessingProfile::Maximum,
                4.0,
                "linear".to_string(),
                None,
            )
            .unwrap();
            let metadata = crate::merge::hdr::source_frame::decode_source(
                path.to_str().unwrap(),
                inputs.len(),
            )
            .unwrap();
            inputs.push(
                HDRInput::with_image(
                    &image,
                    std::time::Duration::from_secs_f32(metadata.exposure.exposure_time_seconds),
                    metadata.exposure.iso,
                )
                .unwrap(),
            );
        }
        let merged = hdr_merge_images(&mut inputs.into()).unwrap();
        let output_dimensions = merged.dimensions();
        let tile_plan =
            build_tile_plan(u64::from(merged.width()), u64::from(merged.height()), 3).unwrap();
        assert!(tile_plan.tile_count > 1);
        let mut payload = Cursor::new(Vec::new());
        merged.write_to(&mut payload, ImageFormat::Tiff).unwrap();
        let payload_hash = format!("blake3:{}", blake3::hash(payload.get_ref()).to_hex());
        let output_root = tempfile::tempdir().unwrap();
        let manifest = DerivedOutputManifest {
            schema_version: 1,
            family: "hdr".to_string(),
            width: u64::from(merged.width()),
            height: u64::from(merged.height()),
            payload_path: "alaska-hdr.tiff".to_string(),
            preview_paths: vec!["preview.png".to_string()],
            map_paths: vec!["maps/ownership.bin".to_string()],
            source_immutability_hashes: source_hashes,
        };
        let mut transaction =
            AtomicDerivedOutputTransaction::begin(output_root.path(), "alaska.rrhdr").unwrap();
        transaction
            .write_file("alaska-hdr.tiff", payload.get_ref())
            .unwrap();
        let mut preview = Cursor::new(Vec::new());
        DynamicImage::ImageRgb8(merged.to_rgb8())
            .write_to(&mut preview, ImageFormat::Png)
            .unwrap();
        transaction
            .write_file("preview.png", preview.get_ref())
            .unwrap();
        transaction
            .write_file("maps/ownership.bin", &[0, 1, 2])
            .unwrap();
        transaction.stage_manifest(&manifest).unwrap();
        let receipt = transaction.commit(&manifest, |_| Ok(())).unwrap();
        drop(payload);
        drop(merged);
        let reopened_path = Path::new(&receipt.final_package_path).join("alaska-hdr.tiff");
        let mut reader = ImageReader::open(&reopened_path).unwrap();
        reader.no_limits();
        let reopened = reader.decode().unwrap();
        assert_eq!(reopened.dimensions(), output_dimensions);
        let mut jpeg = Cursor::new(Vec::new());
        DynamicImage::ImageRgb8(reopened.to_rgb8())
            .write_to(&mut jpeg, ImageFormat::Jpeg)
            .unwrap();
        assert_eq!(
            image::load_from_memory_with_format(jpeg.get_ref(), ImageFormat::Jpeg)
                .unwrap()
                .dimensions(),
            output_dimensions
        );
        assert_eq!(receipt.payload_hash, payload_hash);
        assert_eq!(
            format!(
                "blake3:{}",
                blake3::hash(&std::fs::read(reopened_path).unwrap()).to_hex()
            ),
            payload_hash
        );
        println!(
            "private_hdr_apply=ready dimensions={}x{} tiles={} payload_hash={} jpeg_bytes={}",
            output_dimensions.0,
            output_dimensions.1,
            tile_plan.tile_count,
            payload_hash,
            jpeg.get_ref().len()
        );
    }
}
