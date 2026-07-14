use std::sync::{Arc, Mutex};

use image::{DynamicImage, GenericImageView};
use serde::{Deserialize, Serialize};

use crate::render::artifact_identity::RenderArtifactIdentity;
use crate::render::native_cache::{
    CacheBudgetCoordinator, CachePolicy, CacheStats, MemoryLruCache,
};

#[derive(Clone)]
pub(crate) enum SampleablePixels {
    Native(Arc<DynamicImage>),
}

impl SampleablePixels {
    pub(crate) fn native(image: Arc<DynamicImage>) -> Self {
        Self::Native(image)
    }

    pub(crate) fn image(&self) -> &Arc<DynamicImage> {
        match self {
            Self::Native(image) => image,
        }
    }

    pub(crate) fn dimensions(&self) -> (u32, u32) {
        self.image().dimensions()
    }

    pub(crate) fn retained_bytes(&self) -> u64 {
        self.image().as_bytes().len() as u64
    }
}

#[derive(Clone)]
pub(crate) struct CachedViewerSampleFrame {
    pub(crate) artifact_identity: RenderArtifactIdentity,
    pub(crate) graph_revision: String,
    pub(crate) pixels: SampleablePixels,
    pub(crate) image_identity: String,
    pub(crate) space_label: String,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum ViewerSampleCacheSlot {
    Edited,
    Original,
    SoftProof,
}

impl ViewerSampleCacheSlot {
    fn cache_key(self) -> &'static str {
        match self {
            Self::Edited => "edited",
            Self::Original => "original",
            Self::SoftProof => "softProof",
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
struct ViewerSampleSession {
    image_session: u64,
    image_identity: String,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum ViewerSamplePublishDisposition {
    Published,
    RejectedNoSession,
    RejectedStaleSession,
}

pub(crate) struct ViewerSamplingService {
    active_session: Mutex<Option<ViewerSampleSession>>,
    frames: MemoryLruCache<String, CachedViewerSampleFrame>,
}

impl ViewerSamplingService {
    pub(crate) fn new(cache_budget: Arc<CacheBudgetCoordinator>) -> Self {
        const MIB: u64 = 1024 * 1024;
        Self {
            active_session: Mutex::new(None),
            frames: MemoryLruCache::new(
                CachePolicy {
                    name: "viewer_samples",
                    soft_limit_bytes: 96 * MIB,
                    hard_limit_bytes: 128 * MIB,
                    max_entries: Some(8),
                },
                cache_budget,
            ),
        }
    }

    pub(crate) fn install_session(&self, image_session: u64, image_identity: &str) {
        let mut active_session = self.active_session.lock().unwrap();
        *active_session = Some(ViewerSampleSession {
            image_session,
            image_identity: image_identity.to_string(),
        });
        self.frames.clear();
    }

    pub(crate) fn clear_frames(&self) {
        let _active_session = self.active_session.lock().unwrap();
        self.frames.clear();
    }

    pub(crate) fn clear_session(&self) {
        let mut active_session = self.active_session.lock().unwrap();
        *active_session = None;
        self.frames.clear();
    }

    pub(crate) fn stats(&self) -> CacheStats {
        self.frames.stats()
    }

    pub(crate) fn publish(
        &self,
        slot: ViewerSampleCacheSlot,
        frame: CachedViewerSampleFrame,
    ) -> ViewerSamplePublishDisposition {
        let active_session = self.active_session.lock().unwrap();
        let Some(session) = active_session.as_ref() else {
            return ViewerSamplePublishDisposition::RejectedNoSession;
        };
        if frame.artifact_identity.image_session != session.image_session
            || frame.image_identity != session.image_identity
        {
            return ViewerSamplePublishDisposition::RejectedStaleSession;
        }
        let weight = frame.pixels.retained_bytes();
        self.frames
            .insert(slot.cache_key().to_string(), Arc::new(frame), weight);
        ViewerSamplePublishDisposition::Published
    }

    pub(crate) fn frame_for_key(&self, key: &str) -> Option<Arc<CachedViewerSampleFrame>> {
        let active_session = self.active_session.lock().unwrap();
        let session = active_session.as_ref()?;
        let frame = self.frames.get(&key.to_string())?;
        (frame.artifact_identity.image_session == session.image_session
            && frame.image_identity == session.image_identity)
            .then_some(frame)
    }

    pub(crate) fn sample(&self, request: ViewerSampleRequest) -> ViewerSampleResponse {
        let active_session = self.active_session.lock().unwrap();
        let Some(session) = active_session.as_ref() else {
            return unavailable_viewer_sample(
                &request,
                ViewerSampleUnavailableReason::FrameUnavailable,
                "Unavailable",
            );
        };
        if session.image_identity != request.image_identity {
            return unavailable_viewer_sample(
                &request,
                ViewerSampleUnavailableReason::StaleFrame,
                "Unavailable",
            );
        }
        let Some(frame) = self.frames.get(&request.target.cache_key().to_string()) else {
            return unavailable_viewer_sample(
                &request,
                ViewerSampleUnavailableReason::FrameUnavailable,
                "Unavailable",
            );
        };
        if frame.artifact_identity.image_session != session.image_session
            || frame.image_identity != request.image_identity
            || frame.graph_revision != request.graph_revision
        {
            return unavailable_viewer_sample(
                &request,
                ViewerSampleUnavailableReason::StaleFrame,
                &frame.space_label,
            );
        }
        sample_viewer_frame(&request, frame.as_ref())
    }
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
struct ViewerSamplePoint {
    x: f64,
    y: f64,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct ViewerSampleImageSize {
    width: u32,
    height: u32,
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
enum ViewerSampleTarget {
    Edited,
    Original,
    SoftProof,
}

impl ViewerSampleTarget {
    fn cache_key(self) -> &'static str {
        match self {
            Self::Edited => "edited",
            Self::Original => "original",
            Self::SoftProof => "softProof",
        }
    }
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
enum ViewerSampleSpace {
    DisplayEncoded,
    WorkingLinear,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ViewerSampleRequest {
    request_identity: String,
    image_identity: String,
    graph_revision: String,
    geometry_epoch: u64,
    normalized_image_point: ViewerSamplePoint,
    source_image_size: ViewerSampleImageSize,
    target: ViewerSampleTarget,
    sample_radius_image_px: u32,
    requested_space: ViewerSampleSpace,
}

#[derive(Clone, Copy, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) enum ViewerSampleUnavailableReason {
    FrameUnavailable,
    StaleFrame,
    UnsupportedSpace,
    InvalidPoint,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub(crate) struct ViewerClippedChannels(u8);

impl Serialize for ViewerClippedChannels {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        use serde::ser::SerializeSeq;
        let mut sequence = serializer.serialize_seq(Some(self.0.count_ones() as usize))?;
        for (bit, label) in [(1, "r"), (2, "g"), (4, "b")] {
            if self.0 & bit != 0 {
                sequence.serialize_element(label)?;
            }
        }
        sequence.end()
    }
}

#[derive(Debug, Serialize)]
#[serde(tag = "status", rename_all = "camelCase")]
pub(crate) enum ViewerSampleResponse {
    Available {
        #[serde(rename = "requestIdentity")]
        request_identity: String,
        #[serde(rename = "imagePointPx")]
        image_point_px: ViewerSamplePointPx,
        rgb: [f64; 3],
        luma: f64,
        #[serde(rename = "clippedChannels")]
        clipped_channels: ViewerClippedChannels,
        #[serde(rename = "spaceLabel")]
        space_label: String,
    },
    Unavailable {
        #[serde(rename = "requestIdentity")]
        request_identity: String,
        reason: ViewerSampleUnavailableReason,
        #[serde(rename = "spaceLabel")]
        space_label: String,
    },
}

#[derive(Clone, Copy, Debug, Serialize, PartialEq, Eq)]
pub(crate) struct ViewerSamplePointPx {
    x: u32,
    y: u32,
}

fn unavailable_viewer_sample(
    request: &ViewerSampleRequest,
    reason: ViewerSampleUnavailableReason,
    space_label: &str,
) -> ViewerSampleResponse {
    ViewerSampleResponse::Unavailable {
        request_identity: request.request_identity.clone(),
        reason,
        space_label: space_label.to_string(),
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct ViewerSampleRect {
    min_x: u32,
    max_x: u32,
    min_y: u32,
    max_y: u32,
    image_point_px: ViewerSamplePointPx,
}

fn resolve_sample_rect(
    request: &ViewerSampleRequest,
    width: u32,
    height: u32,
) -> Option<ViewerSampleRect> {
    let point = request.normalized_image_point;
    if width == 0
        || height == 0
        || request.source_image_size.width == 0
        || request.source_image_size.height == 0
        || !point.x.is_finite()
        || !point.y.is_finite()
        || !(0.0..=1.0).contains(&point.x)
        || !(0.0..=1.0).contains(&point.y)
    {
        return None;
    }
    let center_x = (point.x * f64::from(width - 1)).round() as u32;
    let center_y = (point.y * f64::from(height - 1)).round() as u32;
    let source_max = request
        .source_image_size
        .width
        .max(request.source_image_size.height);
    let frame_max = width.max(height);
    let radius = ((request.sample_radius_image_px as f64 * f64::from(frame_max)
        / f64::from(source_max))
    .ceil() as u32)
        .min(16);
    Some(ViewerSampleRect {
        min_x: center_x.saturating_sub(radius),
        max_x: center_x.saturating_add(radius).min(width - 1),
        min_y: center_y.saturating_sub(radius),
        max_y: center_y.saturating_add(radius).min(height - 1),
        image_point_px: ViewerSamplePointPx {
            x: (point.x * f64::from(request.source_image_size.width - 1)).round() as u32,
            y: (point.y * f64::from(request.source_image_size.height - 1)).round() as u32,
        },
    })
}

static VIEWER_SAMPLE_PIXELS_VISITED: std::sync::atomic::AtomicU64 =
    std::sync::atomic::AtomicU64::new(0);

fn sum_native_pixels(image: &DynamicImage, rect: ViewerSampleRect) -> Option<([f64; 3], u64)> {
    macro_rules! sum_rows {
        ($buffer:expr, $channels:expr, $scale:expr) => {{
            let raw = $buffer.as_raw();
            let width = $buffer.width() as usize;
            let channels = $channels;
            let mut totals = [0.0_f64; 3];
            let mut count = 0_u64;
            for y in rect.min_y as usize..=rect.max_y as usize {
                let start = (y * width + rect.min_x as usize) * channels;
                let end = (y * width + rect.max_x as usize + 1) * channels;
                for pixel in raw.get(start..end)?.chunks_exact(channels) {
                    totals[0] += pixel[0] as f64 * $scale;
                    totals[1] += pixel[1] as f64 * $scale;
                    totals[2] += pixel[2] as f64 * $scale;
                    count += 1;
                }
            }
            Some((totals, count))
        }};
    }
    match image {
        DynamicImage::ImageRgb8(buffer) => sum_rows!(buffer, 3, 1.0 / 255.0),
        DynamicImage::ImageRgba8(buffer) => sum_rows!(buffer, 4, 1.0 / 255.0),
        DynamicImage::ImageRgb16(buffer) => sum_rows!(buffer, 3, 1.0 / 65535.0),
        DynamicImage::ImageRgba16(buffer) => sum_rows!(buffer, 4, 1.0 / 65535.0),
        DynamicImage::ImageRgb32F(buffer) => sum_rows!(buffer, 3, 1.0),
        DynamicImage::ImageRgba32F(buffer) => sum_rows!(buffer, 4, 1.0),
        _ => None,
    }
}

fn sample_viewer_frame(
    request: &ViewerSampleRequest,
    frame: &CachedViewerSampleFrame,
) -> ViewerSampleResponse {
    let _geometry_epoch = request.geometry_epoch;
    if request.requested_space != ViewerSampleSpace::DisplayEncoded {
        return unavailable_viewer_sample(
            request,
            ViewerSampleUnavailableReason::UnsupportedSpace,
            &frame.space_label,
        );
    }
    if !request.normalized_image_point.x.is_finite()
        || !request.normalized_image_point.y.is_finite()
        || !(0.0..=1.0).contains(&request.normalized_image_point.x)
        || !(0.0..=1.0).contains(&request.normalized_image_point.y)
        || request.source_image_size.width == 0
        || request.source_image_size.height == 0
    {
        return unavailable_viewer_sample(
            request,
            ViewerSampleUnavailableReason::InvalidPoint,
            &frame.space_label,
        );
    }
    let (width, height) = frame.pixels.dimensions();
    let Some(rect) = resolve_sample_rect(request, width, height) else {
        return unavailable_viewer_sample(
            request,
            if width == 0 || height == 0 {
                ViewerSampleUnavailableReason::FrameUnavailable
            } else {
                ViewerSampleUnavailableReason::InvalidPoint
            },
            &frame.space_label,
        );
    };
    let Some((totals, count)) = sum_native_pixels(frame.pixels.image(), rect) else {
        return unavailable_viewer_sample(
            request,
            ViewerSampleUnavailableReason::FrameUnavailable,
            &frame.space_label,
        );
    };
    VIEWER_SAMPLE_PIXELS_VISITED.fetch_add(count, std::sync::atomic::Ordering::Relaxed);
    let channels = totals.map(|value| (value / count as f64).clamp(0.0, 1.0));
    let clipped_channels =
        ViewerClippedChannels(channels.iter().enumerate().fold(0, |bits, (index, value)| {
            bits | (u8::from(*value >= 1.0 - f64::EPSILON) << index)
        }));
    ViewerSampleResponse::Available {
        request_identity: request.request_identity.clone(),
        image_point_px: rect.image_point_px,
        rgb: channels,
        luma: channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722,
        clipped_channels,
        space_label: frame.space_label.clone(),
    }
}

#[cfg(test)]
mod tests {
    use std::thread;
    use std::time::Instant;

    use image::ImageBuffer;

    use super::*;

    fn fixture_request(radius: u32) -> ViewerSampleRequest {
        ViewerSampleRequest {
            request_identity: "fixture-request".to_string(),
            image_identity: "/fixture/color-patches.tif".to_string(),
            graph_revision: "history_3".to_string(),
            geometry_epoch: 9,
            normalized_image_point: ViewerSamplePoint { x: 0.5, y: 0.5 },
            source_image_size: ViewerSampleImageSize {
                width: 3,
                height: 1,
            },
            target: ViewerSampleTarget::Edited,
            sample_radius_image_px: radius,
            requested_space: ViewerSampleSpace::DisplayEncoded,
        }
    }

    fn frame_for(image: DynamicImage, image_session: u64, path: &str) -> CachedViewerSampleFrame {
        let (width, height) = image.dimensions();
        CachedViewerSampleFrame {
            artifact_identity: RenderArtifactIdentity::source_geometry(
                &crate::render::artifact_identity::tests_support::source(path),
                image_session,
                1,
                1,
                1,
                width,
                height,
            ),
            graph_revision: "history_3".to_string(),
            pixels: SampleablePixels::native(Arc::new(image)),
            image_identity: path.to_string(),
            space_label: "Display encoded sRGB".to_string(),
        }
    }

    fn frame(image: DynamicImage) -> CachedViewerSampleFrame {
        frame_for(image, 1, "/fixture/color-patches.tif")
    }

    fn service() -> ViewerSamplingService {
        ViewerSamplingService::new(CacheBudgetCoordinator::new(
            256 * 1024 * 1024,
            512 * 1024 * 1024,
        ))
    }

    fn available(response: ViewerSampleResponse) -> ([f64; 3], f64, ViewerSamplePointPx) {
        match response {
            ViewerSampleResponse::Available {
                rgb,
                luma,
                image_point_px,
                ..
            } => (rgb, luma, image_point_px),
            response => panic!("expected available response, got {response:?}"),
        }
    }

    #[test]
    fn rejects_old_publication_after_a_b_a_session_change() {
        let service = service();
        service.install_session(1, "a.raw");
        service.install_session(2, "b.raw");
        service.install_session(3, "a.raw");
        let stale = frame_for(
            DynamicImage::ImageRgb8(ImageBuffer::from_pixel(1, 1, image::Rgb([1, 2, 3]))),
            1,
            "a.raw",
        );
        assert_eq!(
            service.publish(ViewerSampleCacheSlot::Edited, stale),
            ViewerSamplePublishDisposition::RejectedStaleSession
        );
        assert!(service.frame_for_key("edited").is_none());
    }

    #[test]
    fn concurrent_old_session_publication_cannot_replace_current_frame() {
        let service = Arc::new(service());
        service.install_session(1, "a.raw");
        let stale_service = Arc::clone(&service);
        let stale = thread::spawn(move || {
            thread::yield_now();
            stale_service.publish(
                ViewerSampleCacheSlot::Edited,
                frame_for(
                    DynamicImage::ImageRgb8(ImageBuffer::from_pixel(1, 1, image::Rgb([1, 2, 3]))),
                    1,
                    "a.raw",
                ),
            )
        });
        service.install_session(2, "b.raw");
        let current = frame_for(
            DynamicImage::ImageRgb8(ImageBuffer::from_pixel(1, 1, image::Rgb([4, 5, 6]))),
            2,
            "b.raw",
        );
        assert_eq!(
            service.publish(ViewerSampleCacheSlot::Edited, current),
            ViewerSamplePublishDisposition::Published
        );
        let _ = stale.join().unwrap();
        let stored = service.frame_for_key("edited").unwrap();
        assert_eq!(stored.artifact_identity.image_session, 2);
        assert_eq!(stored.image_identity, "b.raw");
    }

    #[test]
    fn service_rejects_stale_request_identity_and_samples_current_frame() {
        let service = service();
        service.install_session(1, "/fixture/color-patches.tif");
        assert_eq!(
            service.publish(
                ViewerSampleCacheSlot::Edited,
                frame(DynamicImage::ImageRgb8(ImageBuffer::from_pixel(
                    3,
                    1,
                    image::Rgb([32, 64, 128]),
                ))),
            ),
            ViewerSamplePublishDisposition::Published
        );
        assert!(matches!(
            service.sample(fixture_request(0)),
            ViewerSampleResponse::Available { .. }
        ));
        let mut stale = fixture_request(0);
        stale.graph_revision = "history_2".to_string();
        assert!(matches!(
            service.sample(stale),
            ViewerSampleResponse::Unavailable {
                reason: ViewerSampleUnavailableReason::StaleFrame,
                ..
            }
        ));
    }

    #[test]
    fn samples_known_display_encoded_patch_and_luma() {
        let image = DynamicImage::ImageRgb8(ImageBuffer::from_fn(3, 1, |x, _| match x {
            0 => image::Rgb([255, 0, 0]),
            1 => image::Rgb([0, 128, 0]),
            _ => image::Rgb([0, 0, 255]),
        }));
        let frame = frame(image);

        let (rgb, luma, point) = available(sample_viewer_frame(&fixture_request(0), &frame));
        assert!((rgb[1] - 128.0 / 255.0).abs() < 1e-6);
        assert!((luma - 0.7152 * 128.0 / 255.0).abs() < 1e-6);
        assert_eq!(point, ViewerSamplePointPx { x: 1, y: 0 });
    }

    #[test]
    fn radius_average_and_unsupported_domain_are_explicit() {
        let frame = frame(DynamicImage::ImageRgb8(ImageBuffer::from_fn(
            3,
            1,
            |x, _| image::Rgb(if x == 1 { [255, 255, 255] } else { [0, 0, 0] }),
        )));
        let (rgb, _, _) = available(sample_viewer_frame(&fixture_request(1), &frame));
        assert!((rgb[0] - 1.0 / 3.0).abs() < 1e-6);

        let mut linear_request = fixture_request(0);
        linear_request.requested_space = ViewerSampleSpace::WorkingLinear;
        assert!(matches!(
            sample_viewer_frame(&linear_request, &frame),
            ViewerSampleResponse::Unavailable {
                reason: ViewerSampleUnavailableReason::UnsupportedSpace,
                ..
            }
        ));
    }

    #[test]
    fn typed_response_preserves_frontend_wire_schema() {
        let response = sample_viewer_frame(
            &fixture_request(0),
            &frame(DynamicImage::ImageRgb8(ImageBuffer::from_pixel(
                1,
                1,
                image::Rgb([255, 0, 255]),
            ))),
        );
        assert_eq!(
            serde_json::to_value(response).unwrap(),
            serde_json::json!({
                "status": "available",
                "requestIdentity": "fixture-request",
                "imagePointPx": { "x": 1, "y": 0 },
                "rgb": [1.0, 0.0, 1.0],
                "luma": 0.2848,
                "clippedChannels": ["r", "b"],
                "spaceLabel": "Display encoded sRGB",
            })
        );
    }

    #[test]
    fn direct_native_formats_match_rgb32f_reference() {
        let images = [
            DynamicImage::ImageRgb8(ImageBuffer::from_pixel(3, 1, image::Rgb([64, 128, 255]))),
            DynamicImage::ImageRgba8(ImageBuffer::from_pixel(
                3,
                1,
                image::Rgba([64, 128, 255, 7]),
            )),
            DynamicImage::ImageRgb16(ImageBuffer::from_pixel(
                3,
                1,
                image::Rgb([16448, 32896, 65535]),
            )),
            DynamicImage::ImageRgba16(ImageBuffer::from_pixel(
                3,
                1,
                image::Rgba([16448, 32896, 65535, 12]),
            )),
            DynamicImage::ImageRgb32F(ImageBuffer::from_pixel(3, 1, image::Rgb([0.25, 0.5, 1.25]))),
            DynamicImage::ImageRgba32F(ImageBuffer::from_pixel(
                3,
                1,
                image::Rgba([0.25, 0.5, 1.25, -4.0]),
            )),
        ];
        for image in images {
            let reference = image.to_rgb32f().get_pixel(1, 0).0.map(f64::from);
            let (actual, _, _) = available(sample_viewer_frame(&fixture_request(0), &frame(image)));
            for channel in 0..3 {
                assert!((actual[channel] - reference[channel].clamp(0.0, 1.0)).abs() < 1e-5);
            }
        }
    }

    #[test]
    fn resolves_edges_radius_cap_and_invalid_dimensions() {
        let mut request = fixture_request(u32::MAX);
        request.normalized_image_point = ViewerSamplePoint { x: 0.0, y: 1.0 };
        request.source_image_size = ViewerSampleImageSize {
            width: 10,
            height: 10,
        };
        assert_eq!(
            resolve_sample_rect(&request, 100, 50),
            Some(ViewerSampleRect {
                min_x: 0,
                max_x: 16,
                min_y: 33,
                max_y: 49,
                image_point_px: ViewerSamplePointPx { x: 0, y: 9 },
            })
        );
        assert!(resolve_sample_rect(&request, 0, 50).is_none());
        request.normalized_image_point.x = f64::NAN;
        assert!(resolve_sample_rect(&request, 100, 50).is_none());
    }

    #[test]
    #[ignore = "manual 8K sampling benchmark"]
    fn benchmark_8k_10k_samples_are_radius_bounded() {
        let frame = frame(DynamicImage::ImageRgb8(ImageBuffer::from_pixel(
            7680,
            4320,
            image::Rgb([64, 128, 255]),
        )));
        let legacy_iterations = 3_u32;
        let legacy_started = Instant::now();
        for _ in 0..legacy_iterations {
            std::hint::black_box(frame.pixels.image().to_rgb32f());
        }
        let legacy_elapsed = legacy_started.elapsed();
        eprintln!(
            "8K legacy full-frame conversion: iterations={legacy_iterations} elapsed={legacy_elapsed:?} avg={:?} temporary_bytes_per_request={}",
            legacy_elapsed / legacy_iterations,
            7680_u64 * 4320 * 12,
        );
        for radius in [0, 4, 16] {
            let mut request = fixture_request(radius);
            request.source_image_size = ViewerSampleImageSize {
                width: 7680,
                height: 4320,
            };
            let before = VIEWER_SAMPLE_PIXELS_VISITED.load(std::sync::atomic::Ordering::Relaxed);
            let started = Instant::now();
            for _ in 0..10_000 {
                std::hint::black_box(sample_viewer_frame(&request, &frame));
            }
            let elapsed = started.elapsed();
            let visited =
                VIEWER_SAMPLE_PIXELS_VISITED.load(std::sync::atomic::Ordering::Relaxed) - before;
            eprintln!(
                "8K radius={radius}: elapsed={elapsed:?} visited={visited} old_rgb32f_temp_bytes_per_request={}",
                7680_u64 * 4320 * 12
            );
            assert!(visited <= 10_000 * u64::from((2 * radius.min(16) + 1).pow(2)));
        }
    }
}
