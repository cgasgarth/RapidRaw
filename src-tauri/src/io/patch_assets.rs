use std::borrow::Cow;
use std::collections::{HashSet, hash_map::DefaultHasher};
use std::hash::{Hash, Hasher};
use std::sync::{Arc, Condvar, Mutex, OnceLock};

use anyhow::{Context, Result, anyhow};
use base64::{Engine as _, engine::general_purpose};
use image::{DynamicImage, GenericImageView, GrayImage, Rgb32FImage, RgbImage, imageops};
use rayon::prelude::*;
use serde_json::Value;

use crate::image_loader::PatchMaskInfo;
use crate::mask_generation::{MaskDefinition, generate_mask_bitmap};
use crate::render::native_cache::{
    CacheBudgetCoordinator, CachePolicy, CacheStats, MemoryLruCache,
};

const DECODE_VERSION: u32 = 1;
const MIB: u64 = 1024 * 1024;

pub type CompositeResult<'a> = Cow<'a, DynamicImage>;

#[derive(Clone, Debug, Eq, PartialEq, Hash)]
pub struct PatchAssetKey {
    pub patch_id: Arc<str>,
    pub patch_revision: u64,
    pub decode_version: u32,
}

#[derive(Clone)]
enum PatchMaskSource {
    Encoded(Arc<GrayImage>),
    Procedural(Arc<Value>),
}

#[derive(Clone)]
pub struct DecodedPatchAsset {
    pub key: PatchAssetKey,
    color: Arc<RgbImage>,
    mask: PatchMaskSource,
    bytes: usize,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct PixelRect {
    pub x: u32,
    pub y: u32,
    pub width: u32,
    pub height: u32,
}

pub struct PreparedPatchAsset {
    pub source_key: PatchAssetKey,
    pub target_width: u32,
    pub target_height: u32,
    pub bounds: PixelRect,
    pub color_rgb32f: Arc<Rgb32FImage>,
    pub mask_u8: Arc<GrayImage>,
}

impl PreparedPatchAsset {
    fn bytes(&self) -> usize {
        self.color_rgb32f.as_raw().capacity() * size_of::<f32>() + self.mask_u8.as_raw().capacity()
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Hash)]
struct PreparedKey {
    source: PatchAssetKey,
    width: u32,
    height: u32,
}

struct CacheState {
    empty_prepared: HashSet<PreparedKey>,
    loading_decoded: HashSet<PatchAssetKey>,
    loading_prepared: HashSet<PreparedKey>,
    #[cfg(test)]
    decode_count: usize,
    #[cfg(test)]
    prepared_count: usize,
}

struct PatchAssetCache {
    decoded: MemoryLruCache<PatchAssetKey, DecodedPatchAsset>,
    prepared: MemoryLruCache<PreparedKey, PreparedPatchAsset>,
    state: Mutex<CacheState>,
    ready: Condvar,
}

impl PatchAssetCache {
    fn new(coordinator: Arc<CacheBudgetCoordinator>) -> Self {
        Self {
            decoded: MemoryLruCache::new(
                CachePolicy {
                    name: "patch_decoded",
                    soft_limit_bytes: 96 * MIB,
                    hard_limit_bytes: 128 * MIB,
                    max_entries: Some(64),
                },
                Arc::clone(&coordinator),
            ),
            prepared: MemoryLruCache::new(
                CachePolicy {
                    name: "patch_prepared",
                    soft_limit_bytes: 160 * MIB,
                    hard_limit_bytes: 256 * MIB,
                    max_entries: Some(128),
                },
                coordinator,
            ),
            state: Mutex::new(CacheState {
                empty_prepared: HashSet::new(),
                loading_decoded: HashSet::new(),
                loading_prepared: HashSet::new(),
                #[cfg(test)]
                decode_count: 0,
                #[cfg(test)]
                prepared_count: 0,
            }),
            ready: Condvar::new(),
        }
    }

    fn decoded(&self, key: &PatchAssetKey, patch: &Value) -> Result<Arc<DecodedPatchAsset>> {
        let mut state = self.state.lock().unwrap();
        loop {
            if let Some(asset) = self.decoded.get(key) {
                return Ok(asset);
            }
            if state.loading_decoded.insert(key.clone()) {
                break;
            }
            state = self.ready.wait(state).unwrap();
        }
        drop(state);

        let decoded = decode_patch(key.clone(), patch).map(Arc::new);
        let mut state = self.state.lock().unwrap();
        state.loading_decoded.remove(key);
        if let Ok(asset) = &decoded {
            #[cfg(test)]
            {
                state.decode_count += 1;
            }
            self.decoded
                .insert(key.clone(), asset.clone(), asset.bytes as u64);
        }
        self.ready.notify_all();
        decoded
    }

    fn prepared(
        &self,
        source: Arc<DecodedPatchAsset>,
        width: u32,
        height: u32,
    ) -> Result<Option<Arc<PreparedPatchAsset>>> {
        let key = PreparedKey {
            source: source.key.clone(),
            width,
            height,
        };
        let mut state = self.state.lock().unwrap();
        loop {
            if let Some(asset) = self.prepared.get(&key) {
                return Ok(Some(asset));
            }
            if state.empty_prepared.contains(&key) {
                return Ok(None);
            }
            if state.loading_prepared.insert(key.clone()) {
                break;
            }
            state = self.ready.wait(state).unwrap();
        }
        drop(state);

        let prepared = prepare_patch(&source, width, height).map(|asset| asset.map(Arc::new));
        let mut state = self.state.lock().unwrap();
        state.loading_prepared.remove(&key);
        if let Ok(prepared) = &prepared {
            #[cfg(test)]
            {
                state.prepared_count += 1;
            }
            if let Some(asset) = prepared {
                self.prepared
                    .insert(key, asset.clone(), asset.bytes() as u64);
            } else {
                state.empty_prepared.insert(key);
            }
        }
        self.ready.notify_all();
        prepared
    }
}

static PATCH_CACHE: OnceLock<PatchAssetCache> = OnceLock::new();

fn cache() -> &'static PatchAssetCache {
    PATCH_CACHE
        .get_or_init(|| PatchAssetCache::new(CacheBudgetCoordinator::new(256 * MIB, 384 * MIB)))
}

pub fn initialize_patch_asset_cache(coordinator: Arc<CacheBudgetCoordinator>) {
    let _ = PATCH_CACHE.set(PatchAssetCache::new(coordinator));
}

pub fn patch_asset_cache_stats() -> Option<[CacheStats; 2]> {
    PATCH_CACHE
        .get()
        .map(|cache| [cache.decoded.stats(), cache.prepared.stats()])
}

pub fn clear_patch_asset_cache() {
    let Some(cache) = PATCH_CACHE.get() else {
        return;
    };
    cache.decoded.clear();
    cache.prepared.clear();
    let mut state = cache.state.lock().unwrap();
    state.empty_prepared.clear();
}

fn patch_key(patch: &Value) -> Result<PatchAssetKey> {
    let patch_id = patch
        .get("id")
        .and_then(Value::as_str)
        .filter(|id| !id.is_empty())
        .ok_or_else(|| anyhow!("PATCH_ID_MISSING"))?;
    // Persisted payloads do not always carry a native revision. Include the canonical JSON
    // content in either case so reused patch IDs/revision counters cannot alias across sessions.
    let mut hasher = DefaultHasher::new();
    patch
        .get("revision")
        .and_then(Value::as_u64)
        .hash(&mut hasher);
    patch
        .get("patchRevision")
        .and_then(Value::as_u64)
        .hash(&mut hasher);
    patch.get("patchData").hash(&mut hasher);
    patch.get("subMasks").hash(&mut hasher);
    patch.get("invert").hash(&mut hasher);
    let revision = hasher.finish();
    Ok(PatchAssetKey {
        patch_id: Arc::from(patch_id),
        patch_revision: revision,
        decode_version: DECODE_VERSION,
    })
}

fn decode_patch(key: PatchAssetKey, patch: &Value) -> Result<DecodedPatchAsset> {
    let data = patch.get("patchData").context("PATCH_DATA_MISSING")?;
    let color = decode_base64_image(data, "color", "PATCH_COLOR_INVALID")?.to_rgb8();
    let mask = match data
        .get("mask")
        .and_then(Value::as_str)
        .filter(|s| !s.is_empty())
    {
        Some(_) => PatchMaskSource::Encoded(Arc::new(
            decode_base64_image(data, "mask", "PATCH_MASK_INVALID")?.to_luma8(),
        )),
        None => PatchMaskSource::Procedural(Arc::new(patch.clone())),
    };
    let mask_bytes = match &mask {
        PatchMaskSource::Encoded(image) => image.as_raw().capacity(),
        PatchMaskSource::Procedural(value) => value.to_string().len(),
    };
    let bytes = color.as_raw().capacity() + mask_bytes;
    Ok(DecodedPatchAsset {
        key,
        color: Arc::new(color),
        mask,
        bytes,
    })
}

fn decode_base64_image(data: &Value, field: &str, code: &str) -> Result<DynamicImage> {
    let encoded = data
        .get(field)
        .and_then(Value::as_str)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| anyhow!(code.to_string()))?;
    let bytes = general_purpose::STANDARD
        .decode(encoded)
        .with_context(|| code.to_string())?;
    image::load_from_memory(&bytes).with_context(|| code.to_string())
}

fn prepare_patch(
    source: &DecodedPatchAsset,
    width: u32,
    height: u32,
) -> Result<Option<PreparedPatchAsset>> {
    let mask = match &source.mask {
        PatchMaskSource::Encoded(mask) => resize_gray(mask, width, height),
        PatchMaskSource::Procedural(patch) => {
            let info: PatchMaskInfo = serde_json::from_value((**patch).clone())
                .context("PATCH_MASK_DEFINITION_INVALID")?;
            let definition = MaskDefinition {
                id: info.id,
                name: info.name,
                visible: true,
                invert: info.invert,
                blend_mode: "normal".to_string(),
                opacity: 100.0,
                adjustments: Value::Null,
                sub_masks: info.sub_masks,
            };
            generate_mask_bitmap(&definition, width, height, 1.0, (0.0, 0.0), None)
                .context("PATCH_MASK_GENERATION_FAILED")?
        }
    };
    let Some(bounds) = nonzero_bounds(&mask) else {
        return Ok(None);
    };
    let color = if source.color.dimensions() == (width, height) {
        source.color.as_ref().clone()
    } else {
        imageops::resize(
            &*source.color,
            width,
            height,
            imageops::FilterType::Lanczos3,
        )
    };
    let cropped_mask =
        imageops::crop_imm(&mask, bounds.x, bounds.y, bounds.width, bounds.height).to_image();
    let cropped_color_u8 =
        imageops::crop_imm(&color, bounds.x, bounds.y, bounds.width, bounds.height).to_image();
    let cropped_color = DynamicImage::ImageRgb8(cropped_color_u8).to_rgb32f();
    Ok(Some(PreparedPatchAsset {
        source_key: source.key.clone(),
        target_width: width,
        target_height: height,
        bounds,
        color_rgb32f: Arc::new(cropped_color),
        mask_u8: Arc::new(cropped_mask),
    }))
}

fn resize_gray(image: &GrayImage, width: u32, height: u32) -> GrayImage {
    if image.dimensions() == (width, height) {
        image.clone()
    } else {
        imageops::resize(image, width, height, imageops::FilterType::Lanczos3)
    }
}

fn nonzero_bounds(mask: &GrayImage) -> Option<PixelRect> {
    let (width, height) = mask.dimensions();
    let mut min_x = width;
    let mut min_y = height;
    let mut max_x = 0;
    let mut max_y = 0;
    let mut found = false;
    for (index, value) in mask.as_raw().iter().copied().enumerate() {
        if value == 0 {
            continue;
        }
        let x = index as u32 % width;
        let y = index as u32 / width;
        min_x = min_x.min(x);
        min_y = min_y.min(y);
        max_x = max_x.max(x);
        max_y = max_y.max(y);
        found = true;
    }
    if found {
        Some(PixelRect {
            x: min_x,
            y: min_y,
            width: max_x - min_x + 1,
            height: max_y - min_y + 1,
        })
    } else {
        None
    }
}

pub fn composite_patches<'a>(
    base: &'a DynamicImage,
    adjustments: &Value,
) -> Result<CompositeResult<'a>> {
    let Some(patches) = adjustments.get("aiPatches").and_then(Value::as_array) else {
        return Ok(Cow::Borrowed(base));
    };
    let (width, height) = base.dimensions();
    let mut prepared = Vec::new();
    for patch in patches {
        if !patch
            .get("visible")
            .and_then(Value::as_bool)
            .unwrap_or(true)
        {
            continue;
        }
        let has_color = patch
            .get("patchData")
            .and_then(|data| data.get("color"))
            .and_then(Value::as_str)
            .is_some_and(|color| !color.is_empty());
        if !has_color {
            continue;
        }
        let key = patch_key(patch)?;
        let source = cache().decoded(&key, patch)?;
        if let Some(asset) = cache().prepared(source, width, height)? {
            prepared.push(asset);
        }
    }
    if prepared.is_empty() {
        return Ok(Cow::Borrowed(base));
    }

    // DynamicImage's conversion preserves the existing Rgba32F output contract. Integer
    // inputs are normalized; existing float values, including out-of-range values, pass through.
    let mut output = base.to_rgba32f();
    let output_stride = width as usize * 4;
    for patch in prepared {
        debug_assert_eq!((patch.target_width, patch.target_height), (width, height));
        debug_assert_eq!(patch.source_key.decode_version, DECODE_VERSION);
        let bounds = patch.bounds;
        let mask = patch.mask_u8.as_raw();
        let color = patch.color_rgb32f.as_raw();
        let patch_stride = bounds.width as usize;
        output
            .as_mut()
            .par_chunks_mut(output_stride)
            .skip(bounds.y as usize)
            .take(bounds.height as usize)
            .enumerate()
            .for_each(|(local_y, row)| {
                let patch_row = local_y * patch_stride;
                let output_x = bounds.x as usize;
                for local_x in 0..patch_stride {
                    let mask_value = mask[patch_row + local_x];
                    if mask_value == 0 {
                        continue;
                    }
                    let alpha = mask_value as f32 / 255.0;
                    let inverse = 1.0 - alpha;
                    let output_index = (output_x + local_x) * 4;
                    let color_index = (patch_row + local_x) * 3;
                    row[output_index] = color[color_index] * alpha + row[output_index] * inverse;
                    row[output_index + 1] =
                        color[color_index + 1] * alpha + row[output_index + 1] * inverse;
                    row[output_index + 2] =
                        color[color_index + 2] * alpha + row[output_index + 2] * inverse;
                }
            });
    }
    Ok(Cow::Owned(DynamicImage::ImageRgba32F(output)))
}

#[cfg(test)]
mod tests {
    use std::io::Cursor;
    use std::sync::{Barrier, MutexGuard, OnceLock};
    use std::time::Instant;

    use base64::engine::general_purpose;
    use image::{ImageBuffer, ImageFormat, Luma, Rgb, Rgba};
    use serde_json::json;

    use super::*;

    fn encoded(image: DynamicImage) -> String {
        let mut bytes = Cursor::new(Vec::new());
        image.write_to(&mut bytes, ImageFormat::Png).unwrap();
        general_purpose::STANDARD.encode(bytes.into_inner())
    }

    fn patch(mask: GrayImage, color: RgbImage, id: &str, revision: u64) -> Value {
        json!({
            "id": id,
            "revision": revision,
            "visible": true,
            "patchData": {
                "mask": encoded(DynamicImage::ImageLuma8(mask)),
                "color": encoded(DynamicImage::ImageRgb8(color))
            },
            "subMasks": []
        })
    }

    fn reset() {
        clear_patch_asset_cache();
        let cache = cache();
        let mut state = cache.state.lock().unwrap();
        state.decode_count = 0;
        state.prepared_count = 0;
    }

    fn test_lock() -> MutexGuard<'static, ()> {
        static LOCK: OnceLock<Mutex<()>> = OnceLock::new();
        LOCK.get_or_init(|| Mutex::new(())).lock().unwrap()
    }

    #[test]
    fn no_effect_returns_the_borrowed_base() {
        let _guard = test_lock();
        reset();
        let base = DynamicImage::new_rgb8(8, 8);
        let result = composite_patches(&base, &json!({"aiPatches": []})).unwrap();
        assert!(matches!(result, Cow::Borrowed(_)));

        let empty = patch(GrayImage::new(8, 8), RgbImage::new(8, 8), "empty", 1);
        let adjustments = json!({"aiPatches": [empty]});
        let first = composite_patches(&base, &adjustments).unwrap();
        let second = composite_patches(&base, &adjustments).unwrap();
        assert!(matches!(first, Cow::Borrowed(_)));
        assert!(matches!(second, Cow::Borrowed(_)));
        let state = cache().state.lock().unwrap();
        assert_eq!(state.decode_count, 1);
        assert_eq!(state.prepared_count, 1);
    }

    #[test]
    fn warm_revision_reuses_decode_and_geometry_change_only_reprepares() {
        let _guard = test_lock();
        reset();
        let mask = GrayImage::from_pixel(4, 4, Luma([255]));
        let color = RgbImage::from_pixel(4, 4, Rgb([255, 0, 0]));
        let patch = patch(mask, color, "cache", 7);
        let adjustments = json!({"aiPatches": [patch]});
        let base_4 = DynamicImage::new_rgb8(4, 4);
        let base_8 = DynamicImage::new_rgb8(8, 8);
        composite_patches(&base_4, &adjustments).unwrap();
        composite_patches(&base_4, &adjustments).unwrap();
        composite_patches(&base_8, &adjustments).unwrap();
        let state = cache().state.lock().unwrap();
        assert_eq!(state.decode_count, 1);
        assert_eq!(state.prepared_count, 2);
    }

    #[test]
    fn composites_only_exact_nonzero_bounds_with_feathered_alpha() {
        let _guard = test_lock();
        reset();
        let mut mask = GrayImage::new(12, 10);
        mask.put_pixel(4, 3, Luma([1]));
        mask.put_pixel(5, 3, Luma([128]));
        mask.put_pixel(6, 4, Luma([255]));
        let color = RgbImage::from_pixel(12, 10, Rgb([255, 0, 0]));
        let value = patch(mask, color, "bounded", 1);
        let key = patch_key(&value).unwrap();
        let source = cache().decoded(&key, &value).unwrap();
        let prepared = cache().prepared(source, 12, 10).unwrap().unwrap();
        assert_eq!(
            prepared.bounds,
            PixelRect {
                x: 4,
                y: 3,
                width: 3,
                height: 2
            }
        );
        assert_eq!(prepared.mask_u8.as_raw().len(), 6);

        let base = DynamicImage::ImageRgba32F(ImageBuffer::from_pixel(
            12,
            10,
            Rgba([0.25, 0.5, 0.75, 0.4]),
        ));
        let result = composite_patches(&base, &json!({"aiPatches": [value]}))
            .unwrap()
            .into_owned()
            .to_rgba32f();
        assert_eq!(result.get_pixel(0, 0), base.to_rgba32f().get_pixel(0, 0));
        assert_eq!(result.get_pixel(6, 4), &Rgba([1.0, 0.0, 0.0, 0.4]));
        let feather = result.get_pixel(5, 3);
        let alpha = 128.0 / 255.0;
        assert!((feather[0] - (alpha + 0.25 * (1.0 - alpha))).abs() < 1e-6);
        assert_eq!(feather[3], 0.4);
    }

    #[test]
    fn overlapping_patches_preserve_order() {
        let _guard = test_lock();
        reset();
        let mask = GrayImage::from_pixel(2, 2, Luma([128]));
        let red = patch(
            mask.clone(),
            RgbImage::from_pixel(2, 2, Rgb([255, 0, 0])),
            "red",
            1,
        );
        let blue = patch(
            mask,
            RgbImage::from_pixel(2, 2, Rgb([0, 0, 255])),
            "blue",
            1,
        );
        let base = DynamicImage::new_rgb8(2, 2);
        let result = composite_patches(&base, &json!({"aiPatches": [red, blue]}))
            .unwrap()
            .into_owned()
            .to_rgba32f();
        let alpha = 128.0 / 255.0;
        let pixel = result.get_pixel(0, 0);
        assert!((pixel[0] - alpha * (1.0 - alpha)).abs() < 1e-6);
        assert!((pixel[2] - alpha).abs() < 1e-6);
    }

    #[test]
    fn concurrent_revision_decode_is_single_flight() {
        let _guard = test_lock();
        reset();
        let value = Arc::new(patch(
            GrayImage::from_pixel(256, 256, Luma([255])),
            RgbImage::from_pixel(256, 256, Rgb([10, 20, 30])),
            "concurrent",
            1,
        ));
        let key = patch_key(&value).unwrap();
        let barrier = Arc::new(Barrier::new(8));
        std::thread::scope(|scope| {
            for _ in 0..8 {
                let value = value.clone();
                let key = key.clone();
                let barrier = barrier.clone();
                scope.spawn(move || {
                    barrier.wait();
                    cache().decoded(&key, &value).unwrap();
                });
            }
        });
        assert_eq!(cache().state.lock().unwrap().decode_count, 1);
    }

    #[test]
    fn malformed_color_has_stable_patch_error() {
        let _guard = test_lock();
        reset();
        let value = json!({
            "id": "invalid",
            "patchData": {"color": "not-base64", "mask": "not-base64"},
            "subMasks": []
        });
        let error = composite_patches(
            &DynamicImage::new_rgb8(1, 1),
            &json!({"aiPatches": [value]}),
        )
        .unwrap_err();
        assert!(format!("{error:#}").contains("PATCH_COLOR_INVALID"));
    }

    #[test]
    #[ignore = "performance evidence; run explicitly with --release --nocapture"]
    fn benchmark_cold_and_warm_sparse_patch() {
        let _guard = test_lock();
        reset();
        let size = 4096;
        let mut mask = GrayImage::new(size, size);
        for y in 1900..2000 {
            for x in 1900..2000 {
                mask.put_pixel(x, y, Luma([255]));
            }
        }
        let value = patch(
            mask,
            RgbImage::from_pixel(size, size, Rgb([200, 100, 50])),
            "benchmark",
            1,
        );
        let adjustments = json!({"aiPatches": [value]});
        let base = DynamicImage::new_rgb8(size, size);
        let cold_start = Instant::now();
        composite_patches(&base, &adjustments).unwrap();
        let cold = cold_start.elapsed();
        let warm_start = Instant::now();
        composite_patches(&base, &adjustments).unwrap();
        let warm = warm_start.elapsed();
        println!(
            "patch-benchmark total_pixels={} bounded_pixels={} cold_ms={} warm_ms={}",
            size as u64 * size as u64,
            10_000,
            cold.as_millis(),
            warm.as_millis()
        );
    }
}
