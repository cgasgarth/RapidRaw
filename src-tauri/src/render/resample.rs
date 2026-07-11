use image::{DynamicImage, GenericImageView, Rgb32FImage};
use once_cell::sync::Lazy;
use rayon::prelude::*;
use std::collections::{HashMap, VecDeque};
use std::fmt;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Instant;

pub const RESAMPLE_KERNEL_VERSION: u32 = 1;
const PLAN_CACHE_MAX_ENTRIES: usize = 64;
const PLAN_CACHE_MAX_BYTES: usize = 32 * 1024 * 1024;
const FULL_INTERMEDIATE_MAX_BYTES: usize = 64 * 1024 * 1024;
const BAND_SCRATCH_TARGET_BYTES: usize = 16 * 1024 * 1024;
const SCRATCH_POOL_MAX_BYTES: usize = 32 * 1024 * 1024;
const SCRATCH_POOL_MAX_BUFFER_BYTES: usize = 16 * 1024 * 1024;

#[derive(Clone, Debug, Eq, PartialEq, Hash)]
pub struct ResampleKey {
    pub source_width: u32,
    pub source_height: u32,
    pub target_width: u32,
    pub target_height: u32,
    pub kernel_version: u32,
}

#[derive(Clone, Copy, Debug)]
pub struct AxisSpan {
    pub source_start: u32,
    pub source_len: u32,
    pub weight_offset: u32,
}

#[derive(Debug)]
pub struct AxisPlan {
    pub spans: Box<[AxisSpan]>,
    pub weights: Box<[f32]>,
}

#[derive(Debug)]
pub struct ResamplePlan {
    pub key: ResampleKey,
    pub x: Arc<AxisPlan>,
    pub y: Arc<AxisPlan>,
}

pub enum ResampledImage<'a> {
    Borrowed(&'a DynamicImage),
    Owned(DynamicImage),
}

impl<'a> ResampledImage<'a> {
    pub fn into_owned(self) -> DynamicImage {
        match self {
            Self::Borrowed(image) => image.clone(),
            Self::Owned(image) => image,
        }
    }
}

impl AsRef<DynamicImage> for ResampledImage<'_> {
    fn as_ref(&self) -> &DynamicImage {
        match self {
            Self::Borrowed(image) => image,
            Self::Owned(image) => image,
        }
    }
}

#[derive(Clone, Copy)]
pub struct CancellationProbe<'a>(&'a AtomicBool);

impl<'a> CancellationProbe<'a> {
    pub fn new(cancelled: &'a AtomicBool) -> Self {
        Self(cancelled)
    }

    fn is_cancelled(self) -> bool {
        self.0.load(Ordering::Relaxed)
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ResampleError {
    InvalidDimensions { source: u32, target: u32 },
    DimensionOverflow,
    Cancelled,
}

impl fmt::Display for ResampleError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::InvalidDimensions { source, target } => {
                write!(f, "invalid resample axis {source} -> {target}")
            }
            Self::DimensionOverflow => f.write_str("resample dimensions exceed addressable memory"),
            Self::Cancelled => f.write_str("resample cancelled"),
        }
    }
}

impl std::error::Error for ResampleError {}

#[derive(Default)]
struct CacheMetrics {
    hits: AtomicU64,
    misses: AtomicU64,
    builds: AtomicU64,
    build_nanos: AtomicU64,
}

#[derive(Clone, Copy, Debug, Default)]
pub struct ResampleCacheMetrics {
    pub hits: u64,
    pub misses: u64,
    pub builds: u64,
    pub build_nanos: u64,
}

struct PlanCache {
    entries: HashMap<ResampleKey, Arc<ResamplePlan>>,
    lru: VecDeque<ResampleKey>,
    bytes: usize,
}

impl PlanCache {
    fn touch(&mut self, key: &ResampleKey) {
        if let Some(index) = self.lru.iter().position(|candidate| candidate == key) {
            self.lru.remove(index);
        }
        self.lru.push_back(key.clone());
    }
}

static PLAN_CACHE: Lazy<Mutex<PlanCache>> = Lazy::new(|| {
    Mutex::new(PlanCache {
        entries: HashMap::new(),
        lru: VecDeque::new(),
        bytes: 0,
    })
});
static CACHE_METRICS: CacheMetrics = CacheMetrics {
    hits: AtomicU64::new(0),
    misses: AtomicU64::new(0),
    builds: AtomicU64::new(0),
    build_nanos: AtomicU64::new(0),
};
static SCRATCH_POOL: Lazy<Mutex<Vec<Vec<f32>>>> = Lazy::new(|| Mutex::new(Vec::new()));

pub fn cache_metrics() -> ResampleCacheMetrics {
    ResampleCacheMetrics {
        hits: CACHE_METRICS.hits.load(Ordering::Relaxed),
        misses: CACHE_METRICS.misses.load(Ordering::Relaxed),
        builds: CACHE_METRICS.builds.load(Ordering::Relaxed),
        build_nanos: CACHE_METRICS.build_nanos.load(Ordering::Relaxed),
    }
}

pub fn build_axis_plan(source_len: u32, target_len: u32) -> Result<AxisPlan, ResampleError> {
    if source_len == 0 || target_len == 0 || target_len > source_len {
        return Err(ResampleError::InvalidDimensions {
            source: source_len,
            target: target_len,
        });
    }
    let target = usize::try_from(target_len).map_err(|_| ResampleError::DimensionOverflow)?;
    let source = usize::try_from(source_len).map_err(|_| ResampleError::DimensionOverflow)?;
    let max_weights = source
        .checked_add(target)
        .ok_or(ResampleError::DimensionOverflow)?;
    let mut spans = Vec::with_capacity(target);
    let mut weights = Vec::with_capacity(max_weights);
    let ratio = source_len as f32 / target_len as f32;

    for output in 0..target {
        let start = output as f32 * ratio;
        let end = (output + 1) as f32 * ratio;
        let first = start.floor() as usize;
        let last = (end.ceil() as usize).min(source);
        let weight_offset =
            u32::try_from(weights.len()).map_err(|_| ResampleError::DimensionOverflow)?;
        let source_start = u32::try_from(first).map_err(|_| ResampleError::DimensionOverflow)?;
        let mut sum = 0.0f32;
        for input in first..last {
            let weight = (end.min((input + 1) as f32) - start.max(input as f32)).max(0.0);
            if weight > 0.0 {
                weights.push(weight);
                sum += weight;
            }
        }
        let source_len = u32::try_from(weights.len() - weight_offset as usize)
            .map_err(|_| ResampleError::DimensionOverflow)?;
        if source_len == 0 || !sum.is_finite() {
            return Err(ResampleError::InvalidDimensions {
                source: source_len,
                target: target_len,
            });
        }
        let inverse = sum.recip();
        for weight in &mut weights[weight_offset as usize..] {
            *weight *= inverse;
        }
        spans.push(AxisSpan {
            source_start,
            source_len,
            weight_offset,
        });
    }
    Ok(AxisPlan {
        spans: spans.into_boxed_slice(),
        weights: weights.into_boxed_slice(),
    })
}

fn plan_bytes(plan: &ResamplePlan) -> usize {
    plan.x.spans.len() * std::mem::size_of::<AxisSpan>()
        + plan.x.weights.len() * std::mem::size_of::<f32>()
        + plan.y.spans.len() * std::mem::size_of::<AxisSpan>()
        + plan.y.weights.len() * std::mem::size_of::<f32>()
}

fn get_plan(key: ResampleKey) -> Result<Arc<ResamplePlan>, ResampleError> {
    {
        let mut cache = PLAN_CACHE.lock().unwrap();
        if let Some(plan) = cache.entries.get(&key).cloned() {
            CACHE_METRICS.hits.fetch_add(1, Ordering::Relaxed);
            cache.touch(&key);
            return Ok(plan);
        }
    }
    CACHE_METRICS.misses.fetch_add(1, Ordering::Relaxed);
    let started = Instant::now();
    let built = Arc::new(ResamplePlan {
        x: Arc::new(build_axis_plan(key.source_width, key.target_width)?),
        y: Arc::new(build_axis_plan(key.source_height, key.target_height)?),
        key: key.clone(),
    });
    CACHE_METRICS.builds.fetch_add(1, Ordering::Relaxed);
    CACHE_METRICS
        .build_nanos
        .fetch_add(started.elapsed().as_nanos() as u64, Ordering::Relaxed);

    let mut cache = PLAN_CACHE.lock().unwrap();
    if let Some(existing) = cache.entries.get(&key).cloned() {
        cache.touch(&key);
        return Ok(existing);
    }
    let bytes = plan_bytes(&built);
    cache.bytes = cache.bytes.saturating_add(bytes);
    cache.entries.insert(key.clone(), Arc::clone(&built));
    cache.touch(&key);
    while cache.entries.len() > PLAN_CACHE_MAX_ENTRIES || cache.bytes > PLAN_CACHE_MAX_BYTES {
        let Some(evicted_key) = cache.lru.pop_front() else {
            break;
        };
        if let Some(evicted) = cache.entries.remove(&evicted_key) {
            cache.bytes = cache.bytes.saturating_sub(plan_bytes(&evicted));
        }
    }
    Ok(built)
}

fn take_scratch(len: usize) -> Result<Vec<f32>, ResampleError> {
    let bytes = len
        .checked_mul(std::mem::size_of::<f32>())
        .ok_or(ResampleError::DimensionOverflow)?;
    let mut pool = SCRATCH_POOL.lock().unwrap();
    let best = pool
        .iter()
        .enumerate()
        .filter(|(_, buffer)| buffer.capacity() >= len)
        .min_by_key(|(_, buffer)| buffer.capacity())
        .map(|(index, _)| index);
    let mut buffer = best
        .map(|index| pool.swap_remove(index))
        .unwrap_or_default();
    drop(pool);
    buffer.resize(len, 0.0);
    if buffer.capacity() * std::mem::size_of::<f32>() < bytes {
        return Err(ResampleError::DimensionOverflow);
    }
    Ok(buffer)
}

fn return_scratch(mut buffer: Vec<f32>) {
    buffer.clear();
    let bytes = buffer.capacity() * std::mem::size_of::<f32>();
    if bytes > SCRATCH_POOL_MAX_BUFFER_BYTES {
        return;
    }
    let mut pool = SCRATCH_POOL.lock().unwrap();
    let retained: usize = pool
        .iter()
        .map(|item| item.capacity() * std::mem::size_of::<f32>())
        .sum();
    if retained.saturating_add(bytes) <= SCRATCH_POOL_MAX_BYTES {
        pool.push(buffer);
    }
}

enum FloatSource<'a> {
    Rgb(&'a [f32]),
    Rgba(&'a [f32]),
    Converted(Rgb32FImage),
}

impl FloatSource<'_> {
    #[inline]
    fn rgb(&self, pixel: usize) -> (f32, f32, f32) {
        let (raw, stride) = match self {
            Self::Rgb(raw) => (*raw, 3),
            Self::Rgba(raw) => (*raw, 4),
            Self::Converted(image) => (image.as_raw().as_slice(), 3),
        };
        let index = pixel * stride;
        (raw[index], raw[index + 1], raw[index + 2])
    }
}

fn cancelled(probe: Option<CancellationProbe<'_>>) -> bool {
    probe.is_some_and(CancellationProbe::is_cancelled)
}

/// RMS-area downscale. Peak intermediate memory is `source_height * target_width * 12`
/// bytes below 64 MiB; larger jobs use bands capped near 16 MiB and recycle small buffers.
pub fn downscale_f32_image_cow<'a>(
    image: &'a DynamicImage,
    nwidth: u32,
    nheight: u32,
    cancellation: Option<CancellationProbe<'_>>,
) -> Result<ResampledImage<'a>, ResampleError> {
    let (width, height) = image.dimensions();
    if nwidth == 0 || nheight == 0 || (nwidth >= width && nheight >= height) {
        return Ok(ResampledImage::Borrowed(image));
    }
    let ratio = (nwidth as f32 / width as f32).min(nheight as f32 / height as f32);
    let new_w = (width as f32 * ratio).round() as u32;
    let new_h = (height as f32 * ratio).round() as u32;
    if new_w == 0 || new_h == 0 {
        return Ok(ResampledImage::Borrowed(image));
    }
    if cancelled(cancellation) {
        return Err(ResampleError::Cancelled);
    }

    let key = ResampleKey {
        source_width: width,
        source_height: height,
        target_width: new_w,
        target_height: new_h,
        kernel_version: RESAMPLE_KERNEL_VERSION,
    };
    let plan = get_plan(key)?;
    let source = match image {
        DynamicImage::ImageRgb32F(rgb) => FloatSource::Rgb(rgb.as_raw()),
        DynamicImage::ImageRgba32F(rgba) => FloatSource::Rgba(rgba.as_raw()),
        _ => FloatSource::Converted(image.to_rgb32f()),
    };
    let row_len = (new_w as usize)
        .checked_mul(3)
        .ok_or(ResampleError::DimensionOverflow)?;
    let output_len = row_len
        .checked_mul(new_h as usize)
        .ok_or(ResampleError::DimensionOverflow)?;
    let mut output = vec![0.0f32; output_len];
    let full_bytes = row_len
        .checked_mul(height as usize)
        .and_then(|v| v.checked_mul(4))
        .ok_or(ResampleError::DimensionOverflow)?;
    let max_source_rows = if full_bytes <= FULL_INTERMEDIATE_MAX_BYTES {
        height as usize
    } else {
        (BAND_SCRATCH_TARGET_BYTES / (row_len * 4)).max(1)
    };

    let mut output_start = 0usize;
    while output_start < new_h as usize {
        if cancelled(cancellation) {
            return Err(ResampleError::Cancelled);
        }
        let first_source = plan.y.spans[output_start].source_start as usize;
        let mut output_end = output_start;
        let mut source_end = first_source;
        while output_end < new_h as usize {
            let span = plan.y.spans[output_end];
            let candidate_end = span.source_start as usize + span.source_len as usize;
            if output_end > output_start && candidate_end - first_source > max_source_rows {
                break;
            }
            source_end = candidate_end;
            output_end += 1;
            if max_source_rows == height as usize {
                continue;
            }
        }
        let scratch_len = (source_end - first_source)
            .checked_mul(row_len)
            .ok_or(ResampleError::DimensionOverflow)?;
        let mut scratch = take_scratch(scratch_len)?;
        scratch
            .par_chunks_exact_mut(row_len)
            .enumerate()
            .for_each(|(local_y, row)| {
                if cancelled(cancellation) {
                    return;
                }
                let source_row = first_source + local_y;
                for (x_out, span) in plan.x.spans.iter().enumerate() {
                    let mut sums = [0.0f32; 3];
                    let weights = &plan.x.weights[span.weight_offset as usize
                        ..(span.weight_offset + span.source_len) as usize];
                    for (offset, &weight) in weights.iter().enumerate() {
                        let pixel =
                            source_row * width as usize + span.source_start as usize + offset;
                        let (r, g, b) = source.rgb(pixel);
                        let values = [r.max(0.0), g.max(0.0), b.max(0.0)];
                        for channel in 0..3 {
                            sums[channel] += values[channel] * values[channel] * weight;
                        }
                    }
                    row[x_out * 3..x_out * 3 + 3].copy_from_slice(&sums);
                }
            });
        if cancelled(cancellation) {
            return_scratch(scratch);
            return Err(ResampleError::Cancelled);
        }
        output[output_start * row_len..output_end * row_len]
            .par_chunks_exact_mut(row_len)
            .enumerate()
            .for_each(|(local_y, row)| {
                let span = plan.y.spans[output_start + local_y];
                let weights = &plan.y.weights
                    [span.weight_offset as usize..(span.weight_offset + span.source_len) as usize];
                for x in 0..new_w as usize {
                    let mut sums = [0.0f32; 3];
                    for (offset, &weight) in weights.iter().enumerate() {
                        let source_y = span.source_start as usize + offset - first_source;
                        let base = source_y * row_len + x * 3;
                        for channel in 0..3 {
                            sums[channel] += scratch[base + channel] * weight;
                        }
                    }
                    for channel in 0..3 {
                        row[x * 3 + channel] = sums[channel].sqrt();
                    }
                }
            });
        return_scratch(scratch);
        output_start = output_end;
    }

    let image =
        Rgb32FImage::from_raw(new_w, new_h, output).ok_or(ResampleError::DimensionOverflow)?;
    Ok(ResampledImage::Owned(DynamicImage::ImageRgb32F(image)))
}

#[cfg(test)]
mod tests {
    use super::*;
    use image::{ImageBuffer, Rgb, Rgba};

    fn reference(image: &DynamicImage, target_w: u32, target_h: u32) -> DynamicImage {
        let (width, height) = image.dimensions();
        let ratio = (target_w as f32 / width as f32).min(target_h as f32 / height as f32);
        let new_w = (width as f32 * ratio).round() as u32;
        let new_h = (height as f32 * ratio).round() as u32;
        let source = image.to_rgb32f();
        let x = build_axis_plan(width, new_w).unwrap();
        let y = build_axis_plan(height, new_h).unwrap();
        let mut output = vec![0.0; new_w as usize * new_h as usize * 3];
        output
            .par_chunks_exact_mut(new_w as usize * 3)
            .enumerate()
            .for_each(|(y_out, row)| {
                let y_span = y.spans[y_out];
                let y_weights = &y.weights[y_span.weight_offset as usize
                    ..(y_span.weight_offset + y_span.source_len) as usize];
                for (x_out, x_span) in x.spans.iter().enumerate() {
                    let x_weights = &x.weights[x_span.weight_offset as usize
                        ..(x_span.weight_offset + x_span.source_len) as usize];
                    let mut sums = [0.0f32; 3];
                    for (dy, &wy) in y_weights.iter().enumerate() {
                        for (dx, &wx) in x_weights.iter().enumerate() {
                            let pixel = ((y_span.source_start as usize + dy) * width as usize
                                + x_span.source_start as usize
                                + dx)
                                * 3;
                            for (channel, sum) in sums.iter_mut().enumerate() {
                                let value = source.as_raw()[pixel + channel].max(0.0);
                                *sum += value * value * wx * wy;
                            }
                        }
                    }
                    for channel in 0..3 {
                        row[x_out * 3 + channel] = sums[channel].sqrt();
                    }
                }
            });
        DynamicImage::ImageRgb32F(Rgb32FImage::from_raw(new_w, new_h, output).unwrap())
    }

    fn assert_parity(image: &DynamicImage, width: u32, height: u32) {
        let expected = reference(image, width, height).to_rgb32f();
        let actual = downscale_f32_image_cow(image, width, height, None)
            .unwrap()
            .into_owned()
            .to_rgb32f();
        let mut max_absolute = 0.0f32;
        let mut max_relative = 0.0f32;
        for (&left, &right) in expected.as_raw().iter().zip(actual.as_raw()) {
            let absolute = (left - right).abs();
            max_absolute = max_absolute.max(absolute);
            max_relative = max_relative.max(absolute / left.abs().max(1.0e-6));
        }
        assert!(max_absolute <= 2.0e-6, "absolute error {max_absolute}");
        assert!(max_relative <= 2.0e-5, "relative error {max_relative}");
    }

    #[test]
    fn axis_plans_are_bounded_normalized_and_finite() {
        for (source, target) in [(1, 1), (17, 7), (64, 8), (997, 2), (101, 100)] {
            let plan = build_axis_plan(source, target).unwrap();
            assert_eq!(plan.spans.len(), target as usize);
            for span in &plan.spans {
                assert!(span.source_len > 0);
                assert!(span.source_start + span.source_len <= source);
                let weights = &plan.weights
                    [span.weight_offset as usize..(span.weight_offset + span.source_len) as usize];
                assert!(
                    weights
                        .iter()
                        .all(|weight| weight.is_finite() && *weight >= 0.0)
                );
                let sum = weights.iter().sum::<f32>();
                assert!(
                    (sum - 1.0).abs() <= 1.0e-5,
                    "axis {source}->{target} weight sum {sum}"
                );
            }
        }
        assert!(matches!(
            build_axis_plan(0, 1),
            Err(ResampleError::InvalidDimensions { .. })
        ));
        assert!(matches!(
            build_axis_plan(1, 0),
            Err(ResampleError::InvalidDimensions { .. })
        ));
        assert!(matches!(
            build_axis_plan(2, 3),
            Err(ResampleError::InvalidDimensions { .. })
        ));
    }

    #[test]
    fn separable_pixels_match_cartesian_rms_reference() {
        let gradient = ImageBuffer::from_fn(37, 23, |x, y| {
            Rgb([x as f32 / 13.0 - 0.8, y as f32 / 7.0, (x ^ y) as f32 / 5.0])
        });
        assert_parity(&DynamicImage::ImageRgb32F(gradient), 11, 9);

        let mut state = 0x4d59_5df4_d0f3_3173u64;
        let random = ImageBuffer::from_fn(53, 31, |_, _| {
            let mut sample = || {
                state ^= state << 13;
                state ^= state >> 7;
                state ^= state << 17;
                (state as u32 as f32 / u32::MAX as f32) * 5.0 - 1.0
            };
            Rgb([sample(), sample(), sample()])
        });
        assert_parity(&DynamicImage::ImageRgb32F(random), 13, 7);

        let mut impulse = Rgb32FImage::new(19, 29);
        impulse.put_pixel(0, 0, Rgb([4.0, -2.0, 1.0]));
        impulse.put_pixel(9, 14, Rgb([2.0, 3.0, 8.0]));
        impulse.put_pixel(18, 28, Rgb([1.0, 9.0, -1.0]));
        assert_parity(&DynamicImage::ImageRgb32F(impulse), 5, 5);
    }

    #[test]
    fn rgba_direct_read_matches_rgb_conversion() {
        let rgba = ImageBuffer::from_fn(23, 17, |x, y| {
            Rgba([
                x as f32 / 10.0 - 0.5,
                y as f32 / 9.0,
                (x + y) as f32 / 7.0,
                0.25,
            ])
        });
        let rgba = DynamicImage::ImageRgba32F(rgba);
        assert_parity(&rgba, 7, 5);
    }

    #[test]
    fn no_op_borrows_the_original_image() {
        let image = DynamicImage::ImageRgb32F(Rgb32FImage::new(7, 5));
        let result = downscale_f32_image_cow(&image, 7, 5, None).unwrap();
        assert!(
            matches!(result, ResampledImage::Borrowed(candidate) if std::ptr::eq(candidate, &image))
        );
    }

    #[test]
    fn repeated_dimensions_hit_the_bounded_plan_cache() {
        let image = DynamicImage::ImageRgb32F(Rgb32FImage::new(113, 71));
        let before = cache_metrics();
        downscale_f32_image_cow(&image, 31, 31, None).unwrap();
        downscale_f32_image_cow(&image, 31, 31, None).unwrap();
        let after = cache_metrics();
        assert!(after.hits > before.hits);
        assert!(after.misses >= before.misses);
        let cache = PLAN_CACHE.lock().unwrap();
        assert!(cache.entries.len() <= PLAN_CACHE_MAX_ENTRIES);
        assert!(cache.bytes <= PLAN_CACHE_MAX_BYTES);
    }

    #[test]
    fn cancellation_returns_scratch_and_no_partial_image() {
        let image = DynamicImage::ImageRgb32F(Rgb32FImage::new(400, 300));
        let flag = AtomicBool::new(true);
        let result = downscale_f32_image_cow(&image, 100, 100, Some(CancellationProbe::new(&flag)));
        assert!(matches!(result, Err(ResampleError::Cancelled)));
    }

    #[test]
    fn oversized_scratch_is_not_retained() {
        let buffer = vec![0.0f32; SCRATCH_POOL_MAX_BUFFER_BYTES / 4 + 1];
        return_scratch(buffer);
        assert!(
            SCRATCH_POOL
                .lock()
                .unwrap()
                .iter()
                .all(|item| item.capacity() * std::mem::size_of::<f32>()
                    <= SCRATCH_POOL_MAX_BUFFER_BYTES)
        );
    }

    #[test]
    #[ignore = "release-mode runtime benchmark"]
    fn benchmark_cartesian_vs_separable() {
        let source_width = 4_000;
        let source_height = 3_000;
        let image =
            DynamicImage::ImageRgb32F(ImageBuffer::from_fn(source_width, source_height, |x, y| {
                Rgb([
                    (x % 1024) as f32 / 1023.0,
                    (y % 1024) as f32 / 1023.0,
                    ((x * 31 + y * 17) % 1024) as f32 / 1023.0,
                ])
            }));
        for target in [256, 720] {
            let started = Instant::now();
            let expected = reference(&image, target, target);
            let baseline = started.elapsed();

            let cold_started = Instant::now();
            let actual = downscale_f32_image_cow(&image, target, target, None)
                .unwrap()
                .into_owned();
            let cold = cold_started.elapsed();
            let warm_started = Instant::now();
            let warm = downscale_f32_image_cow(&image, target, target, None)
                .unwrap()
                .into_owned();
            let warm_time = warm_started.elapsed();
            let max_error = expected
                .to_rgb32f()
                .as_raw()
                .iter()
                .zip(actual.to_rgb32f().as_raw())
                .map(|(left, right)| (left - right).abs())
                .fold(0.0f32, f32::max);
            assert_eq!(actual.dimensions(), warm.dimensions());
            assert!(max_error <= 2.0e-6);
            let intermediate_mib =
                source_height as usize * actual.width() as usize * 12 / (1024 * 1024);
            eprintln!(
                "resample_bench source={}x{} target={}x{} cartesian_ms={:.2} cold_ms={:.2} warm_ms={:.2} speedup={:.2}x source_mpix_s={:.1} full_intermediate_mib={} max_abs_error={:.3e}",
                source_width,
                source_height,
                actual.width(),
                actual.height(),
                baseline.as_secs_f64() * 1000.0,
                cold.as_secs_f64() * 1000.0,
                warm_time.as_secs_f64() * 1000.0,
                baseline.as_secs_f64() / warm_time.as_secs_f64(),
                source_width as f64 * source_height as f64 / 1_000_000.0 / warm_time.as_secs_f64(),
                intermediate_mib,
                max_error,
            );
        }
    }
}
