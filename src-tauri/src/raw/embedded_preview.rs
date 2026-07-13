use std::io::Cursor;
use std::path::Path;
use std::time::Instant;

use base64::{Engine as _, engine::general_purpose::STANDARD};
use image::{GenericImageView, ImageFormat};
use rawler::decoders::RawDecodeParams;
use rawler::{Orientation, rawsource::RawSource};
use serde::Serialize;

use crate::image_processing::apply_orientation;
use crate::source_revision::SourceRevision;

const MIN_LONG_EDGE: u32 = 640;
const MAX_LONG_EDGE: u32 = 6_000;
const MAX_DECODED_BYTES: u64 = 128 * 1024 * 1024;
const MAX_ENCODED_BYTES: usize = 16 * 1024 * 1024;
const MAX_PUBLISHED_LONG_EDGE: u32 = 2_048;
#[cfg(target_os = "macos")]
static QOS_RESTORE_FAILURES: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);

#[cfg(target_os = "macos")]
struct ScopedProvisionalQos {
    original_class: libc::qos_class_t,
    original_priority: libc::c_int,
    changed: bool,
}

#[cfg(target_os = "macos")]
impl ScopedProvisionalQos {
    fn utility() -> Self {
        let mut original_class = libc::qos_class_t::QOS_CLASS_UNSPECIFIED;
        let mut original_priority = 0;
        // SAFETY: pthread_self returns the calling thread, and both out-pointers
        // are valid for the duration of this call.
        let read_ok = unsafe {
            libc::pthread_get_qos_class_np(
                libc::pthread_self(),
                &mut original_class,
                &mut original_priority,
            ) == 0
        };
        // SAFETY: this changes only the calling spawn_blocking worker. Drop
        // restores its original QoS before Tokio can reuse the thread.
        let changed = read_ok
            && unsafe {
                libc::pthread_set_qos_class_self_np(libc::qos_class_t::QOS_CLASS_UTILITY, 0) == 0
            };
        Self {
            original_class,
            original_priority,
            changed,
        }
    }
}

#[cfg(target_os = "macos")]
impl Drop for ScopedProvisionalQos {
    fn drop(&mut self) {
        if self.changed {
            // SAFETY: values were read from this same worker thread immediately
            // before the scoped QoS change.
            let restore_result = unsafe {
                libc::pthread_set_qos_class_self_np(self.original_class, self.original_priority)
            };
            if restore_result != 0 {
                QOS_RESTORE_FAILURES.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
            }
        }
    }
}

pub fn with_provisional_thread_priority<T>(operation: impl FnOnce() -> T) -> T {
    #[cfg(target_os = "macos")]
    let _qos = ScopedProvisionalQos::utility();
    operation()
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum ImageFrameQuality {
    EmbeddedProvisional,
    FastDeveloped,
    SettledDeveloped,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProgressiveImageFrameReceipt {
    pub image_session: u64,
    pub selection_generation: u64,
    pub source_revision: String,
    pub frame_generation: u64,
    pub quality: ImageFrameQuality,
    pub width: u32,
    pub height: u32,
    pub orientation_applied: bool,
    pub source_kind: String,
    pub color_assumption: String,
    pub provisional_reason: Option<String>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum EmbeddedPreviewRejection {
    Cancelled,
    UnsupportedContainer,
    DecodeFailed,
    Missing,
    TooSmall,
    DimensionsExceedBudget,
    EncodedBytesExceedBudget,
    SourceChanged,
}

#[derive(Clone, Debug)]
pub struct ExtractedEmbeddedPreview {
    pub candidate_height: u32,
    pub candidate_width: u32,
    pub data_url: String,
    pub receipt: ProgressiveImageFrameReceipt,
    pub elapsed_millis: u64,
    pub encoded_bytes: usize,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
struct PreviewCandidate {
    width: u32,
    height: u32,
}

fn validate_candidate(candidate: PreviewCandidate) -> Result<(), EmbeddedPreviewRejection> {
    let long_edge = candidate.width.max(candidate.height);
    if long_edge < MIN_LONG_EDGE {
        return Err(EmbeddedPreviewRejection::TooSmall);
    }
    let decoded_bytes = u64::from(candidate.width)
        .saturating_mul(u64::from(candidate.height))
        .saturating_mul(4);
    if long_edge > MAX_LONG_EDGE || decoded_bytes > MAX_DECODED_BYTES {
        return Err(EmbeddedPreviewRejection::DimensionsExceedBudget);
    }
    Ok(())
}

#[cfg(test)]
pub fn extract_embedded_preview(
    path: &Path,
    image_session: u64,
    selection_generation: u64,
    frame_generation: u64,
) -> Result<ExtractedEmbeddedPreview, EmbeddedPreviewRejection> {
    let source = RawSource::new(path).map_err(|_| EmbeddedPreviewRejection::DecodeFailed)?;
    extract_embedded_preview_from_source(
        &source,
        path,
        image_session,
        selection_generation,
        frame_generation,
        || false,
    )
}

pub fn extract_embedded_preview_from_source(
    source: &RawSource,
    path: &Path,
    image_session: u64,
    selection_generation: u64,
    frame_generation: u64,
    is_cancelled: impl Fn() -> bool,
) -> Result<ExtractedEmbeddedPreview, EmbeddedPreviewRejection> {
    let started = Instant::now();
    let revision =
        SourceRevision::from_path(path).map_err(|_| EmbeddedPreviewRejection::DecodeFailed)?;
    if is_cancelled() {
        return Err(EmbeddedPreviewRejection::Cancelled);
    }
    let decoder =
        rawler::get_decoder(source).map_err(|_| EmbeddedPreviewRejection::UnsupportedContainer)?;
    let params = RawDecodeParams::default();
    if is_cancelled() {
        return Err(EmbeddedPreviewRejection::Cancelled);
    }
    let metadata = decoder
        .raw_metadata(source, &params)
        .map_err(|_| EmbeddedPreviewRejection::DecodeFailed)?;
    if is_cancelled() {
        return Err(EmbeddedPreviewRejection::Cancelled);
    }
    let image = decoder
        .full_image(source, &params)
        .map_err(|_| EmbeddedPreviewRejection::DecodeFailed)?
        .ok_or(EmbeddedPreviewRejection::Missing)?;
    if is_cancelled() {
        return Err(EmbeddedPreviewRejection::Cancelled);
    }
    validate_candidate(PreviewCandidate {
        width: image.width(),
        height: image.height(),
    })?;
    let orientation = metadata
        .exif
        .orientation
        .map(Orientation::from_u16)
        .unwrap_or(Orientation::Normal);
    let orientation_applied = !matches!(orientation, Orientation::Normal | Orientation::Unknown);
    let image = apply_orientation(image, orientation);
    let (candidate_width, candidate_height) = image.dimensions();
    let image = if image.width().max(image.height()) > MAX_PUBLISHED_LONG_EDGE {
        image.resize(
            MAX_PUBLISHED_LONG_EDGE,
            MAX_PUBLISHED_LONG_EDGE,
            image::imageops::FilterType::Triangle,
        )
    } else {
        image
    };
    let (width, height) = image.dimensions();
    let mut encoded = Cursor::new(Vec::new());
    image
        .write_to(&mut encoded, ImageFormat::Jpeg)
        .map_err(|_| EmbeddedPreviewRejection::DecodeFailed)?;
    let encoded = encoded.into_inner();
    if encoded.len() > MAX_ENCODED_BYTES {
        return Err(EmbeddedPreviewRejection::EncodedBytesExceedBudget);
    }
    if SourceRevision::from_path(path).map_err(|_| EmbeddedPreviewRejection::SourceChanged)?
        != revision
    {
        return Err(EmbeddedPreviewRejection::SourceChanged);
    }
    let source_kind = format!("{:?}", decoder.format_hint()).to_ascii_lowercase();
    Ok(ExtractedEmbeddedPreview {
        candidate_height,
        candidate_width,
        data_url: format!("data:image/jpeg;base64,{}", STANDARD.encode(&encoded)),
        receipt: ProgressiveImageFrameReceipt {
            image_session,
            selection_generation,
            source_revision: revision.identity(),
            frame_generation,
            quality: ImageFrameQuality::EmbeddedProvisional,
            width,
            height,
            orientation_applied,
            source_kind,
            color_assumption: "encoded_srgb_vendor_preview".to_string(),
            provisional_reason: Some(
                "camera-rendered latency bridge; not authoritative pixels".to_string(),
            ),
        },
        elapsed_millis: started.elapsed().as_millis() as u64,
        encoded_bytes: encoded.len(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Arc;

    #[test]
    fn candidate_policy_rejects_tiny_and_memory_hostile_previews() {
        assert_eq!(
            validate_candidate(PreviewCandidate {
                width: 320,
                height: 240
            }),
            Err(EmbeddedPreviewRejection::TooSmall)
        );
        assert_eq!(
            validate_candidate(PreviewCandidate {
                width: 10_000,
                height: 8_000
            }),
            Err(EmbeddedPreviewRejection::DimensionsExceedBudget)
        );
        assert_eq!(
            validate_candidate(PreviewCandidate {
                width: 2_048,
                height: 1_365
            }),
            Ok(())
        );
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn provisional_qos_scope_restores_worker_priority() {
        let before = QOS_RESTORE_FAILURES.load(std::sync::atomic::Ordering::Relaxed);
        with_provisional_thread_priority(|| assert_eq!(2 + 2, 4));
        assert_eq!(
            QOS_RESTORE_FAILURES.load(std::sync::atomic::Ordering::Relaxed),
            before
        );
    }

    #[test]
    fn receipt_serialization_keeps_provisional_pixels_explicit() {
        let receipt = ProgressiveImageFrameReceipt {
            image_session: 7,
            selection_generation: 8,
            source_revision: "source-revision-v1:test".to_string(),
            frame_generation: 1,
            quality: ImageFrameQuality::EmbeddedProvisional,
            width: 2_048,
            height: 1_365,
            orientation_applied: true,
            source_kind: "arw".to_string(),
            color_assumption: "encoded_srgb_vendor_preview".to_string(),
            provisional_reason: Some("not authoritative".to_string()),
        };
        assert_eq!(
            serde_json::to_value(receipt).unwrap()["quality"],
            "embeddedProvisional"
        );
    }

    #[test]
    fn invalid_container_rejects_without_fabricating_a_frame() {
        let file = tempfile::NamedTempFile::new().unwrap();
        std::fs::write(file.path(), b"not a raw container").unwrap();
        assert_eq!(
            extract_embedded_preview(file.path(), 1, 1, 1).unwrap_err(),
            EmbeddedPreviewRejection::UnsupportedContainer
        );
    }

    #[test]
    fn cancelled_session_stops_before_container_parse() {
        let file = tempfile::NamedTempFile::new().unwrap();
        std::fs::write(file.path(), b"not parsed when already cancelled").unwrap();
        let source = RawSource::new(file.path()).unwrap();
        assert_eq!(
            extract_embedded_preview_from_source(&source, file.path(), 1, 1, 1, || true)
                .unwrap_err(),
            EmbeddedPreviewRejection::Cancelled
        );
    }

    #[test]
    #[ignore = "requires RAPIDRAW_PRIVATE_RAW_PATH; never commits private media or output"]
    fn private_raw_embedded_preview_runtime_proof() {
        let path = std::env::var("RAPIDRAW_PRIVATE_RAW_PATH")
            .expect("set RAPIDRAW_PRIVATE_RAW_PATH to a private supported RAW");
        let development_before = crate::raw_processing::raw_development_invocations();
        let preview = extract_embedded_preview(Path::new(&path), 1, 1, 1)
            .expect("extract embedded preview without RAW development");
        assert_eq!(
            crate::raw_processing::raw_development_invocations(),
            development_before,
            "embedded extraction must not invoke RAW development"
        );
        let encoded = preview
            .data_url
            .strip_prefix("data:image/jpeg;base64,")
            .expect("JPEG data URL");
        let jpeg = STANDARD.decode(encoded).expect("decode preview transport");
        let decoded = image::load_from_memory_with_format(&jpeg, ImageFormat::Jpeg)
            .expect("decode published preview pixels");
        assert_eq!(
            decoded.dimensions(),
            (preview.receipt.width, preview.receipt.height)
        );
        assert_eq!(
            preview.receipt.quality,
            ImageFrameQuality::EmbeddedProvisional
        );
        assert_eq!(
            preview.receipt.color_assumption,
            "encoded_srgb_vendor_preview"
        );
        assert!(preview.receipt.provisional_reason.is_some());
        println!(
            "{}",
            serde_json::json!({
                "elapsedMillis": preview.elapsed_millis,
                "encodedBytes": preview.encoded_bytes,
                "candidateHeight": preview.candidate_height,
                "candidateWidth": preview.candidate_width,
                "height": preview.receipt.height,
                "orientationApplied": preview.receipt.orientation_applied,
                "sourceKind": preview.receipt.source_kind,
                "sourceRevision": preview.receipt.source_revision,
                "width": preview.receipt.width,
            })
        );
    }

    #[test]
    #[ignore = "requires RAPIDRAW_PRIVATE_RAW_PATH; benchmark performs a full private RAW development"]
    fn private_raw_first_frame_latency_benchmark() {
        let path = std::env::var("RAPIDRAW_PRIVATE_RAW_PATH")
            .expect("set RAPIDRAW_PRIVATE_RAW_PATH to a private supported RAW");
        let report = benchmark_private_path(Path::new(&path), false);
        assert!(report.first_visible_millis.saturating_mul(3) < report.progressive_settled_millis);
        assert!(report.settled_overhead_ratio <= 1.2);
        println!("{}", serde_json::to_string(&report).unwrap());
    }

    #[test]
    #[ignore = "requires RAPIDRAW_PRIVATE_RAW_MATRIX separated by semicolons"]
    fn private_raw_progressive_p95_matrix_benchmark() {
        let paths = std::env::var("RAPIDRAW_PRIVATE_RAW_MATRIX")
            .expect("set RAPIDRAW_PRIVATE_RAW_MATRIX to semicolon-separated RAW paths");
        let paths: Vec<_> = paths.split(';').filter(|path| !path.is_empty()).collect();
        assert!(paths.len() >= 5, "matrix requires at least five RAWs");
        for path in &paths {
            let _ = benchmark_private_path(Path::new(path), false);
        }
        let reports: Vec<_> = paths
            .iter()
            .flat_map(|path| {
                (0..5).map(move |iteration| {
                    benchmark_private_path(Path::new(path), iteration % 2 == 1)
                })
            })
            .collect();
        let megapixels: Vec<_> = reports
            .iter()
            .map(|report| u64::from(report.settled_width) * u64::from(report.settled_height))
            .collect();
        assert!(
            megapixels
                .iter()
                .any(|pixels| (20_000_000..35_000_000).contains(pixels))
        );
        assert!(
            megapixels
                .iter()
                .any(|pixels| (35_000_000..55_000_000).contains(pixels))
        );
        assert!(
            megapixels
                .iter()
                .any(|pixels| (55_000_000..80_000_000).contains(pixels))
        );
        assert!(megapixels.iter().any(|pixels| *pixels >= 90_000_000));
        assert!(reports.iter().any(|report| report.source_kind == "arw"));
        assert!(reports.iter().any(|report| report.source_kind == "raf"));
        let first_visible_p95 = p95(reports
            .iter()
            .map(|report| report.first_visible_millis)
            .collect());
        let first_visible_p50 = p50(reports
            .iter()
            .map(|report| report.first_visible_millis)
            .collect());
        let overhead_p95_millis = p95(reports
            .iter()
            .map(|report| {
                report
                    .progressive_settled_millis
                    .saturating_sub(report.baseline_settled_millis)
            })
            .collect());
        let overhead_ratio_p95 = p95_f64(
            reports
                .iter()
                .map(|report| report.settled_overhead_ratio)
                .collect(),
        );
        let overhead_ratio_p50 = p50_f64(
            reports
                .iter()
                .map(|report| report.settled_overhead_ratio)
                .collect(),
        );
        assert!(first_visible_p95 <= 250, "p95 first-visible exceeded 250ms");
        assert!(
            overhead_ratio_p95 <= 1.05,
            "p95 settled overhead exceeded 5%"
        );
        let class_stats: Vec<_> = ["24mp", "42mp", "60mp", "100mp"]
            .into_iter()
            .map(|class| {
                let class_reports: Vec<_> = reports
                    .iter()
                    .filter(|report| report.megapixel_class == class)
                    .collect();
                serde_json::json!({
                    "class": class,
                    "firstVisibleP50Millis": p50(class_reports.iter().map(|report| report.first_visible_millis).collect()),
                    "firstVisibleP95Millis": p95(class_reports.iter().map(|report| report.first_visible_millis).collect()),
                    "settledOverheadRatioP50": p50_f64(class_reports.iter().map(|report| report.settled_overhead_ratio).collect()),
                    "settledOverheadRatioP95": p95_f64(class_reports.iter().map(|report| report.settled_overhead_ratio).collect()),
                })
            })
            .collect();
        println!(
            "{}",
            serde_json::json!({
                "firstVisibleP95Millis": first_visible_p95,
                "firstVisibleP50Millis": first_visible_p50,
                "classes": class_stats,
                "settledOverheadP95Millis": overhead_p95_millis,
                "settledOverheadRatioP95": overhead_ratio_p95,
                "settledOverheadRatioP50": overhead_ratio_p50,
                "reports": reports,
            })
        );
    }

    #[derive(Serialize)]
    #[serde(rename_all = "camelCase")]
    struct PrivateBenchmarkReport {
        baseline_settled_millis: u64,
        first_visible_millis: u64,
        first_visible_width: u32,
        megapixel_class: &'static str,
        progressive_settled_millis: u64,
        settled_height: u32,
        settled_overhead_ratio: f64,
        settled_width: u32,
        shared_mapped_source: bool,
        source_kind: String,
        speedup: f64,
    }

    fn benchmark_private_path(path: &Path, progressive_first: bool) -> PrivateBenchmarkReport {
        let run_baseline = || {
            let started = Instant::now();
            let source = RawSource::new(path).expect("map baseline private RAW");
            let _ = crate::raw_processing::develop_raw_source_with_report(
                &source,
                false,
                crate::raw_processing::RawProcessingProfile::Balanced,
                0.0,
                "default".to_string(),
                None,
            )
            .expect("baseline settled RAW development");
            started.elapsed().as_millis() as u64
        };
        let run_progressive = || {
            let progressive_started = Instant::now();
            let source = Arc::new(RawSource::new(path).expect("map progressive private RAW once"));
            let source_open_millis = progressive_started.elapsed().as_millis() as u64;
            let (preview, preview_millis, settled, progressive_settled_millis) =
                std::thread::scope(|scope| {
                    let preview_source = Arc::clone(&source);
                    let preview_task = scope.spawn(move || {
                        let started = Instant::now();
                        let preview = with_provisional_thread_priority(|| {
                            extract_embedded_preview_from_source(
                                &preview_source,
                                path,
                                1,
                                1,
                                1,
                                || false,
                            )
                        })
                        .expect("embedded preview extraction");
                        (preview, started.elapsed().as_millis() as u64)
                    });
                    let (settled, _) = crate::raw_processing::develop_raw_source_with_report(
                        &source,
                        false,
                        crate::raw_processing::RawProcessingProfile::Balanced,
                        0.0,
                        "default".to_string(),
                        None,
                    )
                    .expect("progressive settled RAW development");
                    let progressive_settled_millis =
                        progressive_started.elapsed().as_millis() as u64;
                    let (preview, preview_millis) =
                        preview_task.join().expect("preview worker joins");
                    (
                        preview,
                        source_open_millis + preview_millis,
                        settled,
                        progressive_settled_millis,
                    )
                });
            (preview, preview_millis, settled, progressive_settled_millis)
        };
        let (baseline_settled_millis, progressive) = if progressive_first {
            let progressive = run_progressive();
            (run_baseline(), progressive)
        } else {
            let baseline = run_baseline();
            (baseline, run_progressive())
        };
        let (preview, preview_millis, settled, progressive_settled_millis) = progressive;
        assert!(
            preview_millis.saturating_mul(3) < progressive_settled_millis,
            "embedded first frame must be at least 3x faster: preview={preview_millis}ms settled={progressive_settled_millis}ms"
        );
        let settled_overhead_ratio =
            progressive_settled_millis as f64 / baseline_settled_millis.max(1) as f64;
        assert!(
            settled_overhead_ratio <= 1.2,
            "concurrent extraction materially regressed settled decode: baseline={baseline_settled_millis}ms progressive={progressive_settled_millis}ms ratio={settled_overhead_ratio:.3}"
        );
        let megapixels = u64::from(settled.width()) * u64::from(settled.height());
        PrivateBenchmarkReport {
            baseline_settled_millis,
            first_visible_millis: preview_millis,
            first_visible_width: preview.receipt.width,
            megapixel_class: match megapixels {
                0..35_000_000 => "24mp",
                35_000_000..55_000_000 => "42mp",
                55_000_000..90_000_000 => "60mp",
                _ => "100mp",
            },
            progressive_settled_millis,
            settled_height: settled.height(),
            settled_overhead_ratio,
            settled_width: settled.width(),
            shared_mapped_source: true,
            source_kind: preview.receipt.source_kind,
            speedup: progressive_settled_millis as f64 / preview_millis.max(1) as f64,
        }
    }

    fn p95(mut values: Vec<u64>) -> u64 {
        values.sort_unstable();
        values[(values.len() * 95).div_ceil(100).saturating_sub(1)]
    }

    fn p50(mut values: Vec<u64>) -> u64 {
        values.sort_unstable();
        values[(values.len() - 1) / 2]
    }

    fn p95_f64(mut values: Vec<f64>) -> f64 {
        values.sort_by(f64::total_cmp);
        values[(values.len() * 95).div_ceil(100).saturating_sub(1)]
    }

    fn p50_f64(mut values: Vec<f64>) -> f64 {
        values.sort_by(f64::total_cmp);
        values[(values.len() - 1) / 2]
    }
}
