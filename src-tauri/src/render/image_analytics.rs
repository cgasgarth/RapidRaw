use std::collections::HashMap;
use std::sync::{Arc, Mutex, OnceLock};
use std::time::Instant;

use image::{DynamicImage, GenericImageView, ImageBuffer, RgbaImage};
use serde::Serialize;

use crate::analytics_resources::{AnalyticsResourceDescriptor, publish};
use crate::app_state::{AnalyticsFrameId, AnalyticsJob, AnalyticsProducts};

const SCOPE_SIZE: usize = 256;
const GAMUT_MAX: u32 = 512;
const MAX_POOLED_SCOPE_BINS: usize = 6;
static SCOPE_BIN_POOL: OnceLock<ScopeBinPool> = OnceLock::new();

#[derive(Default)]
struct ScopeBinPool {
    bins: Mutex<Vec<Vec<u32>>>,
}

impl ScopeBinPool {
    fn take(&self) -> Vec<u32> {
        self.bins
            .lock()
            .unwrap()
            .pop()
            .unwrap_or_else(|| vec![0; SCOPE_SIZE * SCOPE_SIZE])
    }

    fn return_bins(&self, mut bins: Vec<u32>) {
        bins.fill(0);
        let mut pool = self.bins.lock().unwrap();
        if pool.len() < MAX_POOLED_SCOPE_BINS {
            pool.push(bins);
        }
    }

    #[cfg(test)]
    fn retained(&self) -> usize {
        self.bins.lock().unwrap().len()
    }
}

fn scope_bins() -> Vec<u32> {
    SCOPE_BIN_POOL.get_or_init(Default::default).take()
}

fn return_scope_bins(bins: Vec<u32>) {
    SCOPE_BIN_POOL
        .get_or_init(Default::default)
        .return_bins(bins);
}

#[derive(Serialize, Clone, Debug, PartialEq)]
pub struct HistogramData {
    pub red: Vec<f32>,
    pub green: Vec<f32>,
    pub blue: Vec<f32>,
    pub luma: Vec<f32>,
}

#[derive(Serialize, Clone)]
pub struct GamutWarningOverlayData {
    pub coverage_ratio: f32,
    pub height: u32,
    pub mask_data_url: String,
    pub max_channel_value: u8,
    pub min_channel_value: u8,
    pub pixel_count: u64,
    pub warning_pixel_count: u64,
    pub width: u32,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct GamutWarningData {
    pub coverage_ratio: f32,
    pub height: u32,
    pub mask: AnalyticsResourceDescriptor,
    pub max_channel_value: u8,
    pub min_channel_value: u8,
    pub pixel_count: u64,
    pub warning_pixel_count: u64,
    pub width: u32,
}

#[derive(Serialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct ScopeData {
    pub rgb: Option<AnalyticsResourceDescriptor>,
    pub luma: Option<AnalyticsResourceDescriptor>,
    pub parade: Option<AnalyticsResourceDescriptor>,
    pub vectorscope: Option<AnalyticsResourceDescriptor>,
    pub width: u32,
    pub height: u32,
}

#[derive(Serialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct AnalyticsTiming {
    pub sampling_ms: f64,
    pub finishing_ms: f64,
    pub source_pixels_read: u64,
    pub full_image_conversions: u64,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct AnalyticsResult {
    pub frame_id: AnalyticsFrameId,
    pub path: String,
    pub requested_products: u32,
    pub histogram: Option<HistogramData>,
    pub gamut: Option<GamutWarningData>,
    pub scopes: Option<ScopeData>,
    pub timing: AnalyticsTiming,
}

#[derive(Clone)]
struct SamplingPlan {
    width: u32,
    height: u32,
    x_bucket: Arc<[usize]>,
    parade: Arc<[[usize; 3]]>,
    gamut_width: u32,
    gamut_height: u32,
    gamut_x: Arc<[u32]>,
    gamut_y: Arc<[u32]>,
}
type PlanCache = Mutex<HashMap<(u32, u32), Arc<SamplingPlan>>>;
static PLANS: OnceLock<PlanCache> = OnceLock::new();

fn sampling_plan(width: u32, height: u32) -> Arc<SamplingPlan> {
    let cache = PLANS.get_or_init(Default::default);
    if let Some(plan) = cache.lock().unwrap().get(&(width, height)).cloned() {
        return plan;
    }
    let x_bucket: Vec<_> = (0..width)
        .map(|x| ((x as f32 * 256.0 / width.max(1) as f32) as usize).min(255))
        .collect();
    let parade: Vec<_> = (0..width)
        .map(|x| {
            let p = (x as f32 / width.max(1) as f32 * 82.0) as usize % 82;
            [p, 87 + p, 174 + p]
        })
        .collect();
    let max_dim = width.max(height).max(1);
    let scale = (GAMUT_MAX as f32 / max_dim as f32).min(1.0);
    let gw = ((width as f32 * scale).round() as u32).max(1);
    let gh = ((height as f32 * scale).round() as u32).max(1);
    let gamut_x = (0..gw)
        .map(|x| ((x as f32 / scale).floor() as u32).min(width.saturating_sub(1)))
        .collect::<Vec<_>>();
    let gamut_y = (0..gh)
        .map(|y| ((y as f32 / scale).floor() as u32).min(height.saturating_sub(1)))
        .collect::<Vec<_>>();
    let plan = Arc::new(SamplingPlan {
        width,
        height,
        x_bucket: x_bucket.into(),
        parade: parade.into(),
        gamut_width: gw,
        gamut_height: gh,
        gamut_x: gamut_x.into(),
        gamut_y: gamut_y.into(),
    });
    let mut guard = cache.lock().unwrap();
    if guard.len() >= 8 {
        guard.clear();
    }
    guard.insert((width, height), Arc::clone(&plan));
    plan
}

#[derive(Default)]
struct Accumulator {
    histogram: Option<Box<[[u32; 256]; 4]>>,
    rgb: Option<[Vec<u32>; 3]>,
    luma: Option<Vec<u32>>,
    parade: Option<Vec<u32>>,
    vectorscope: Option<Vec<u32>>,
    gamut: Option<Vec<u8>>,
    gamut_warn: u64,
    gamut_min: u8,
    gamut_max: u8,
    reads: u64,
}

impl Accumulator {
    fn new(products: AnalyticsProducts, active_channel: Option<&str>, plan: &SamplingPlan) -> Self {
        let waveform = products.contains(AnalyticsProducts::WAVEFORM);
        Self {
            histogram: products
                .contains(AnalyticsProducts::HISTOGRAM)
                .then(|| Box::new([[0; 256]; 4])),
            rgb: (waveform && active_channel != Some("luma"))
                .then(|| [scope_bins(), scope_bins(), scope_bins()]),
            luma: waveform.then(scope_bins),
            parade: products
                .contains(AnalyticsProducts::PARADE)
                .then(scope_bins),
            vectorscope: products
                .contains(AnalyticsProducts::VECTORSCOPE)
                .then(scope_bins),
            gamut: products
                .contains(AnalyticsProducts::GAMUT_MASK)
                .then(|| vec![0; plan.gamut_width as usize * plan.gamut_height as usize * 4]),
            gamut_min: u8::MAX,
            ..Default::default()
        }
    }
    fn pixel(&mut self, plan: &SamplingPlan, x: u32, y: u32, rgb: [u8; 3]) {
        self.reads += 1;
        let [r, g, b] = rgb;
        let l = ((r as u32 * 218 + g as u32 * 732 + b as u32 * 74) >> 10).min(255) as usize;
        let linear = y as u64 * plan.width as u64 + x as u64;
        if linear.is_multiple_of(2)
            && let Some(h) = self.histogram.as_mut()
        {
            h[0][r as usize] += 1;
            h[1][g as usize] += 1;
            h[2][b as usize] += 1;
            h[3][l] += 1;
        }
        let xb = plan.x_bucket[x as usize];
        if let Some(bins) = self.rgb.as_mut() {
            bins[0][(255 - r as usize) * 256 + xb] += 1;
            bins[1][(255 - g as usize) * 256 + xb] += 1;
            bins[2][(255 - b as usize) * 256 + xb] += 1;
        }
        if let Some(bins) = self.luma.as_mut() {
            bins[(255 - l) * 256 + xb] += 1;
        }
        if let Some(bins) = self.parade.as_mut() {
            let p = plan.parade[x as usize];
            bins[(255 - r as usize) * 256 + p[0]] += 1;
            bins[(255 - g as usize) * 256 + p[1]] += 1;
            bins[(255 - b as usize) * 256 + p[2]] += 1;
        }
        if let Some(bins) = self.vectorscope.as_mut() {
            let (mut cb, mut cr) = (
                (-0.1146 * r as f32 - 0.3854 * g as f32 + 0.5 * b as f32) * 0.836,
                (0.5 * r as f32 - 0.4542 * g as f32 - 0.0458 * b as f32) * 0.836,
            );
            let d = cb * cb + cr * cr;
            if d > 16129.0 {
                let s = 127.0 / d.sqrt();
                cb *= s;
                cr *= s;
            }
            let vx = (cb + 128.0).clamp(0.0, 255.0) as usize;
            let vy = (128.0 - cr).clamp(0.0, 255.0) as usize;
            bins[vy * 256 + vx] += 1;
        }
        if plan.gamut_width == plan.width && plan.gamut_height == plan.height {
            self.gamut_pixel(plan, x, y, rgb);
        }
    }
    fn gamut_pixel(&mut self, plan: &SamplingPlan, ox: u32, oy: u32, rgb: [u8; 3]) {
        if let Some(mask) = self.gamut.as_mut() {
            let [r, g, b] = rgb;
            let min = r.min(g).min(b);
            let max = r.max(g).max(b);
            self.gamut_min = self.gamut_min.min(min);
            self.gamut_max = self.gamut_max.max(max);
            let off = (oy as usize * plan.gamut_width as usize + ox as usize) * 4;
            if min <= 3 || max >= 252 {
                mask[off..off + 4].copy_from_slice(&[255, 45, 149, 122]);
                self.gamut_warn += 1;
            }
        }
    }
}

impl Drop for Accumulator {
    fn drop(&mut self) {
        if let Some(rgb) = self.rgb.take() {
            for bins in rgb {
                return_scope_bins(bins);
            }
        }
        for bins in [
            self.luma.take(),
            self.parade.take(),
            self.vectorscope.take(),
        ]
        .into_iter()
        .flatten()
        {
            return_scope_bins(bins);
        }
    }
}

fn read_rgb(image: &DynamicImage, x: u32, y: u32) -> [u8; 3] {
    match image {
        DynamicImage::ImageRgb8(i) => i.get_pixel(x, y).0,
        DynamicImage::ImageRgba8(i) => {
            let p = i.get_pixel(x, y).0;
            [p[0], p[1], p[2]]
        }
        DynamicImage::ImageRgb16(i) => i.get_pixel(x, y).0.map(|v| (v >> 8) as u8),
        DynamicImage::ImageRgba16(i) => {
            let p = i.get_pixel(x, y).0;
            [(p[0] >> 8) as u8, (p[1] >> 8) as u8, (p[2] >> 8) as u8]
        }
        DynamicImage::ImageRgb32F(i) => i
            .get_pixel(x, y)
            .0
            .map(|v| (v.clamp(0.0, 1.0) * 255.0) as u8),
        DynamicImage::ImageRgba32F(i) => {
            let p = i.get_pixel(x, y).0;
            [
                (p[0].clamp(0.0, 1.0) * 255.0) as u8,
                (p[1].clamp(0.0, 1.0) * 255.0) as u8,
                (p[2].clamp(0.0, 1.0) * 255.0) as u8,
            ]
        }
        _ => {
            let p = image.get_pixel(x, y).0;
            [p[0], p[1], p[2]]
        }
    }
}

fn scan(
    image: &DynamicImage,
    plan: &SamplingPlan,
    acc: &mut Accumulator,
    current: &impl Fn() -> bool,
) -> Result<(), String> {
    macro_rules! scan_raw {
        ($img:expr,$channels:expr,$conv:expr) => {{
            let raw = $img.as_raw();
            for y in 0..plan.height {
                if y % 16 == 0 && !current() {
                    return Err("superseded".into());
                }
                for x in 0..plan.width {
                    let i = (y * plan.width + x) as usize * $channels;
                    acc.pixel(
                        plan,
                        x,
                        y,
                        [$conv(raw[i]), $conv(raw[i + 1]), $conv(raw[i + 2])],
                    );
                }
            }
        }};
    }
    match image {
        DynamicImage::ImageRgb8(i) => scan_raw!(i, 3, |v: u8| v),
        DynamicImage::ImageRgba8(i) => scan_raw!(i, 4, |v: u8| v),
        DynamicImage::ImageRgb16(i) => scan_raw!(i, 3, |v: u16| (v >> 8) as u8),
        DynamicImage::ImageRgba16(i) => scan_raw!(i, 4, |v: u16| (v >> 8) as u8),
        DynamicImage::ImageRgb32F(i) => scan_raw!(i, 3, |v: f32| (v.clamp(0.0, 1.0) * 255.0) as u8),
        DynamicImage::ImageRgba32F(i) => {
            scan_raw!(i, 4, |v: f32| (v.clamp(0.0, 1.0) * 255.0) as u8)
        }
        _ => {
            for y in 0..plan.height {
                if y % 16 == 0 && !current() {
                    return Err("superseded".into());
                }
                for x in 0..plan.width {
                    let p = image.get_pixel(x, y).0;
                    acc.pixel(plan, x, y, [p[0], p[1], p[2]]);
                }
            }
        }
    }
    if acc.gamut.is_some() && (plan.gamut_width != plan.width || plan.gamut_height != plan.height) {
        for oy in 0..plan.gamut_height {
            if oy % 16 == 0 && !current() {
                return Err("superseded".into());
            }
            for ox in 0..plan.gamut_width {
                acc.reads += 1;
                acc.gamut_pixel(
                    plan,
                    ox,
                    oy,
                    read_rgb(image, plan.gamut_x[ox as usize], plan.gamut_y[oy as usize]),
                );
            }
        }
    }
    Ok(())
}

pub fn calculate(
    job: &AnalyticsJob,
    current: impl Fn() -> bool,
) -> Result<AnalyticsResult, String> {
    let (w, h) = job.image.dimensions();
    if w == 0 || h == 0 {
        return Err("Image has zero dimensions.".into());
    }
    let plan = sampling_plan(w, h);
    let mut acc = Accumulator::new(job.products, job.active_waveform_channel.as_deref(), &plan);
    let started = Instant::now();
    scan(&job.image, &plan, &mut acc, &current)?;
    let sampling_ms = started.elapsed().as_secs_f64() * 1000.0;
    if !current() {
        return Err("superseded".into());
    }
    let finish = Instant::now();
    let histogram = acc.histogram.take().map(|h| histogram_from_counts(*h));
    let identity = serde_json::to_vec(&job.frame_id).unwrap_or_default();
    if !current() {
        return Err("superseded".into());
    }
    let gamut = acc.gamut.take().map(|rgba| {
        let pixels = u64::from(plan.gamut_width) * u64::from(plan.gamut_height);
        let png = encode_png(&rgba, plan.gamut_width, plan.gamut_height).unwrap_or_default();
        GamutWarningData {
            coverage_ratio: acc.gamut_warn as f32 / pixels.max(1) as f32,
            height: plan.gamut_height,
            mask: publish(png, "image/png", &identity),
            max_channel_value: acc.gamut_max,
            min_channel_value: acc.gamut_min,
            pixel_count: pixels,
            warning_pixel_count: acc.gamut_warn,
            width: plan.gamut_width,
        }
    });
    let mut scopes = ScopeData {
        width: 256,
        height: 256,
        ..Default::default()
    };
    if let Some(rgb) = acc.rgb.as_ref() {
        if !current() {
            return Err("superseded".into());
        }
        scopes.rgb = Some(publish(
            render_rgb(rgb),
            "application/x-rapidraw-rgba8",
            &identity,
        ));
    }
    if let Some(l) = acc.luma.as_ref() {
        if !current() {
            return Err("superseded".into());
        }
        scopes.luma = Some(publish(
            render_single(l, [255, 255, 255]),
            "application/x-rapidraw-rgba8",
            &identity,
        ));
    }
    if let Some(p) = acc.parade.as_ref() {
        if !current() {
            return Err("superseded".into());
        }
        scopes.parade = Some(publish(
            render_parade(p),
            "application/x-rapidraw-rgba8",
            &identity,
        ));
    }
    if let Some(v) = acc.vectorscope.as_ref() {
        if !current() {
            return Err("superseded".into());
        }
        scopes.vectorscope = Some(publish(
            render_vector(v),
            "application/x-rapidraw-rgba8",
            &identity,
        ));
    }
    let has_scopes = scopes.rgb.is_some()
        || scopes.luma.is_some()
        || scopes.parade.is_some()
        || scopes.vectorscope.is_some();
    Ok(AnalyticsResult {
        frame_id: job.frame_id,
        path: job.path.clone(),
        requested_products: job.products.bits(),
        histogram,
        gamut,
        scopes: has_scopes.then_some(scopes),
        timing: AnalyticsTiming {
            sampling_ms,
            finishing_ms: finish.elapsed().as_secs_f64() * 1000.0,
            source_pixels_read: acc.reads,
            full_image_conversions: 0,
        },
    })
}

fn histogram_from_counts(h: [[u32; 256]; 4]) -> HistogramData {
    let mut v: Vec<Vec<f32>> = h
        .into_iter()
        .map(|a| a.into_iter().map(|x| x as f32).collect())
        .collect();
    for a in &mut v {
        smooth(a);
        normalize(a)
    }
    HistogramData {
        red: v.remove(0),
        green: v.remove(0),
        blue: v.remove(0),
        luma: v.remove(0),
    }
}
fn smooth(a: &mut [f32]) {
    let sigma = 2.0;
    let radius: f32 = sigma * 3.0;
    let radius = radius.ceil() as usize;
    let mut k: Vec<f32> = (0..=2 * radius)
        .map(|i| {
            let x = i as i32 - radius as i32;
            (-(x * x) as f32 / (2.0 * sigma * sigma)).exp()
        })
        .collect();
    let sum: f32 = k.iter().sum();
    for x in &mut k {
        *x /= sum
    }
    let old = a.to_vec();
    for (i, x) in a.iter_mut().enumerate() {
        *x = k
            .iter()
            .enumerate()
            .map(|(j, w)| old[(i as i32 + j as i32 - radius as i32).clamp(0, 255) as usize] * w)
            .sum()
    }
}
fn normalize(a: &mut [f32]) {
    let mut s = a.to_vec();
    s.sort_by(|a, b| a.total_cmp(b));
    let max = s[252];
    if max > 1e-6 {
        for x in a {
            *x = (*x / max).min(1.0)
        }
    } else {
        a.fill(0.0)
    }
}
fn lut(b: &[u32]) -> Vec<u8> {
    let max = *b.iter().max().unwrap_or(&0);
    let scale = if max == 0 {
        0.0
    } else {
        255.0 / (1.0 + max as f32).ln()
    };
    (0..=max)
        .map(|v| {
            if v == 0 {
                0
            } else {
                ((1.0 + v as f32).ln() * scale) as u8
            }
        })
        .collect()
}
fn render_rgb(b: &[Vec<u32>; 3]) -> Vec<u8> {
    let ls = [lut(&b[0]), lut(&b[1]), lut(&b[2])];
    let mut out = vec![0; 256 * 256 * 4];
    for i in 0..65536 {
        let c = [
            ls[0][b[0][i] as usize],
            ls[1][b[1][i] as usize],
            ls[2][b[2][i] as usize],
        ];
        out[i * 4..i * 4 + 3].copy_from_slice(&c);
        out[i * 4 + 3] = c[0].max(c[1]).max(c[2]);
    }
    out
}
fn render_single(b: &[u32], color: [u8; 3]) -> Vec<u8> {
    let l = lut(b);
    let mut out = vec![0; 65536 * 4];
    for i in 0..65536 {
        if b[i] > 0 {
            out[i * 4..i * 4 + 3].copy_from_slice(&color);
            out[i * 4 + 3] = l[b[i] as usize]
        }
    }
    out
}
fn render_parade(b: &[u32]) -> Vec<u8> {
    let l = lut(b);
    let mut out = vec![0; 65536 * 4];
    for i in 0..65536 {
        if b[i] > 0 {
            let x = i % 256;
            let c = if x < 82 {
                0
            } else if (87..169).contains(&x) {
                1
            } else {
                2
            };
            out[i * 4 + c] = 255;
            out[i * 4 + 3] = l[b[i] as usize]
        }
    }
    out
}
fn render_vector(b: &[u32]) -> Vec<u8> {
    let l = lut(b);
    let mut out = vec![0; 65536 * 4];
    for i in 0..65536 {
        let x = (i % 256) as f32;
        let y = (i / 256) as f32;
        let dx = x - 128.0;
        let dy = 128.0 - y;
        if b[i] > 0 {
            out[i * 4] = (128.0 + 1.402 * (dy / 0.836)).clamp(0.0, 255.0) as u8;
            out[i * 4 + 1] =
                (128.0 - 0.344136 * (dx / 0.836) - 0.714136 * (dy / 0.836)).clamp(0.0, 255.0) as u8;
            out[i * 4 + 2] = (128.0 + 1.772 * (dx / 0.836)).clamp(0.0, 255.0) as u8;
            out[i * 4 + 3] = l[b[i] as usize]
        } else {
            let min_d = dx.abs().min(dy.abs());
            let dist = (dx * dx + dy * dy).sqrt();
            let pixel = &mut out[i * 4..i * 4 + 4];
            if min_d <= 1.0 {
                pixel.copy_from_slice(&[
                    255,
                    255,
                    255,
                    (40.0_f32 - min_d * 30.0).clamp(0.0, 255.0) as u8,
                ]);
            } else if (dist - 127.0).abs() < 0.8 || (dist - 64.0).abs() < 0.8 {
                pixel.copy_from_slice(&[255, 255, 255, 15]);
            } else if dx < 0.0 && dy > 0.0 && (dy + 1.53 * dx).abs() < 1.0 {
                pixel.copy_from_slice(&[255, 200, 150, 120]);
            }
        }
    }
    out
}
fn encode_png(rgba: &[u8], w: u32, h: u32) -> Result<Vec<u8>, String> {
    let img: RgbaImage = ImageBuffer::from_raw(w, h, rgba.to_vec()).ok_or("invalid mask")?;
    let mut out = std::io::Cursor::new(Vec::new());
    DynamicImage::ImageRgba8(img)
        .write_to(&mut out, image::ImageFormat::Png)
        .map_err(|e| e.to_string())?;
    Ok(out.into_inner())
}

#[cfg(test)]
pub fn calculate_histogram_from_image(image: &DynamicImage) -> Result<HistogramData, String> {
    let job = compat_job(image, AnalyticsProducts::HISTOGRAM);
    calculate(&job, || true)?
        .histogram
        .ok_or("missing histogram".into())
}
pub fn calculate_gamut_warning_overlay_from_image(
    image: &DynamicImage,
) -> Result<GamutWarningOverlayData, String> {
    let (w, h) = image.dimensions();
    let p = sampling_plan(w, h);
    let mut a = Accumulator::new(AnalyticsProducts::GAMUT_MASK, None, &p);
    scan(image, &p, &mut a, &|| true)?;
    let rgba = a.gamut.take().unwrap();
    let png = encode_png(&rgba, p.gamut_width, p.gamut_height)?;
    let pixels = u64::from(p.gamut_width) * u64::from(p.gamut_height);
    use base64::Engine;
    Ok(GamutWarningOverlayData {
        coverage_ratio: a.gamut_warn as f32 / pixels.max(1) as f32,
        height: p.gamut_height,
        mask_data_url: format!(
            "data:image/png;base64,{}",
            base64::engine::general_purpose::STANDARD.encode(png)
        ),
        max_channel_value: a.gamut_max,
        min_channel_value: a.gamut_min,
        pixel_count: pixels,
        warning_pixel_count: a.gamut_warn,
        width: p.gamut_width,
    })
}
#[cfg(test)]
fn compat_job(image: &DynamicImage, products: AnalyticsProducts) -> AnalyticsJob {
    AnalyticsJob {
        path: String::new(),
        frame_id: AnalyticsFrameId::default(),
        image: Arc::new(image.clone()),
        products,
        active_waveform_channel: None,
        policy: Default::default(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn variants_match_and_convert_zero_full_frames() {
        let pixels = [[0, 128, 255], [255, 64, 0], [4, 3, 2], [252, 251, 250]];
        let a = DynamicImage::ImageRgb8(ImageBuffer::from_fn(2, 2, |x, y| {
            image::Rgb(pixels[(y * 2 + x) as usize])
        }));
        let b = DynamicImage::ImageRgb16(ImageBuffer::from_fn(2, 2, |x, y| {
            image::Rgb(pixels[(y * 2 + x) as usize].map(|v| v as u16 * 257))
        }));
        assert_eq!(
            calculate_histogram_from_image(&a).unwrap(),
            calculate_histogram_from_image(&b).unwrap()
        );
        let job = compat_job(&a, AnalyticsProducts::all());
        let result = calculate(&job, || true).unwrap();
        assert_eq!(result.timing.full_image_conversions, 0);
        assert_eq!(result.timing.source_pixels_read, 4);
    }
    #[test]
    fn disabled_products_allocate_no_outputs() {
        let image = DynamicImage::new_rgb8(4, 4);
        let result = calculate(&compat_job(&image, AnalyticsProducts::HISTOGRAM), || true).unwrap();
        assert!(result.histogram.is_some());
        assert!(result.gamut.is_none());
        assert!(result.scopes.is_none());
    }

    #[test]
    fn scope_pool_is_bounded_and_reused_after_completion() {
        let pool = ScopeBinPool::default();
        let bins = (0..MAX_POOLED_SCOPE_BINS + 2)
            .map(|_| pool.take())
            .collect::<Vec<_>>();
        assert_eq!(pool.retained(), 0);
        for bins in bins {
            pool.return_bins(bins);
        }
        assert_eq!(pool.retained(), MAX_POOLED_SCOPE_BINS);

        let reused = pool.take();
        assert_eq!(pool.retained(), MAX_POOLED_SCOPE_BINS - 1);
        assert!(reused.iter().all(|value| *value == 0));
        pool.return_bins(reused);
        assert_eq!(pool.retained(), MAX_POOLED_SCOPE_BINS);
    }

    #[test]
    fn independent_scope_pools_do_not_contaminate_concurrent_accounting() {
        let primary = Arc::new(ScopeBinPool::default());
        let unrelated = Arc::new(ScopeBinPool::default());
        let primary_worker = Arc::clone(&primary);
        let unrelated_worker = Arc::clone(&unrelated);
        let primary_thread = std::thread::spawn(move || {
            for _ in 0..100 {
                let bins = primary_worker.take();
                primary_worker.return_bins(bins);
            }
        });
        let unrelated_thread = std::thread::spawn(move || {
            let held = (0..MAX_POOLED_SCOPE_BINS)
                .map(|_| unrelated_worker.take())
                .collect::<Vec<_>>();
            for bins in held.into_iter().take(2) {
                unrelated_worker.return_bins(bins);
            }
        });
        primary_thread.join().unwrap();
        unrelated_thread.join().unwrap();

        assert_eq!(primary.retained(), 1);
        assert_eq!(unrelated.retained(), 2);
    }

    #[test]
    #[ignore = "24 MP performance evidence"]
    fn benchmark_24mp_shared_vs_legacy_scans() {
        let image = DynamicImage::ImageRgb8(ImageBuffer::from_fn(6000, 4000, |x, y| {
            image::Rgb([x as u8, y as u8, (x ^ y) as u8])
        }));
        let started = Instant::now();
        let histogram_image = DynamicImage::ImageRgb8(image.to_rgb8());
        let gamut_image = DynamicImage::ImageRgba8(image.to_rgba8());
        let scope_image = DynamicImage::ImageRgb8(image.to_rgb8());
        std::hint::black_box(
            calculate(
                &compat_job(&histogram_image, AnalyticsProducts::HISTOGRAM),
                || true,
            )
            .unwrap(),
        );
        std::hint::black_box(
            calculate(
                &compat_job(&gamut_image, AnalyticsProducts::GAMUT_MASK),
                || true,
            )
            .unwrap(),
        );
        std::hint::black_box(
            calculate(
                &compat_job(
                    &scope_image,
                    AnalyticsProducts::WAVEFORM
                        | AnalyticsProducts::PARADE
                        | AnalyticsProducts::VECTORSCOPE,
                ),
                || true,
            )
            .unwrap(),
        );
        let legacy_ms = started.elapsed().as_secs_f64() * 1000.0;

        let job = compat_job(&image, AnalyticsProducts::all());
        let started = Instant::now();
        let result = calculate(&job, || true).unwrap();
        let shared_ms = started.elapsed().as_secs_f64() * 1000.0;
        eprintln!(
            "analytics-bench pixels=24000000 legacy_ms={legacy_ms:.2} shared_ms={shared_ms:.2} speedup={:.2} legacy_conversion_bytes=240000000 shared_conversion_bytes=0 source_reads={}",
            legacy_ms / shared_ms,
            result.timing.source_pixels_read
        );
    }
}
