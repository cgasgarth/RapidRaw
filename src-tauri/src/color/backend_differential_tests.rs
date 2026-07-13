use std::{sync::mpsc, time::Instant};

use half::f16;
use rapidraw_color_reference::{
    artistic::{
        ARTISTIC_REFERENCE_CONTRACT_ID, ColorCalibration, ColorGrade, CurvePoint,
        DISPLAY_ENCODED_EXTENDED_DOMAIN, HslAdjustment, Levels, Lut3d, MaskBlendMode,
        SCENE_LINEAR_EXTENDED_DOMAIN, agx_tonemap_identity_matrix, apply_clipping_overlay,
        apply_color_calibration, apply_color_grading, apply_filmic_brightness, apply_flare,
        apply_glow_raw, apply_grain, apply_halation_raw, apply_hsl_ranges, apply_local_contrast,
        apply_luma_levels, apply_monotone_curve, apply_vignette, apply_white_balance,
        blend_mask_layer,
    },
    dcp::{BoundaryPolicy, HueSatCoordinates, HueSatMap, HueSatMapDimensions, HueSatMapEntry},
    transfer::{hlg_oetf, linear_to_srgb_channel, pq_inverse_eotf},
    types::{AbsoluteLuminanceNits, SceneLinearHlg},
};
use serde::Serialize;
use wgpu::util::DeviceExt;

use super::visual_approval_artifacts::{
    ApprovalBindings, generate_visual_approval_bundle, hash_bytes,
};

const PROOF_PATH_ENV: &str = "RAWENGINE_COLOR_BACKEND_PROOF_PATH";
const DCP_ENTRIES: [[f32; 3]; 8] = [
    [-8.0, 0.80, 0.90],
    [4.0, 1.10, 0.95],
    [-3.0, 0.90, 1.05],
    [7.0, 1.20, 1.10],
    [-5.0, 0.85, 1.15],
    [2.0, 1.05, 1.20],
    [0.0, 0.95, 1.25],
    [10.0, 1.25, 1.30],
];

const DIFFERENTIAL_SHADER: &str = r#"
struct Parameters { operation: u32, defect: u32, sample_count: u32, _pad: u32 }
@group(0) @binding(0) var<storage, read> source: array<vec4<f32>>;
@group(0) @binding(1) var<storage, read_write> destination: array<vec4<f32>>;
@group(0) @binding(2) var<uniform> parameters: Parameters;

const DCP: array<vec3<f32>, 8> = array<vec3<f32>, 8>(
    vec3<f32>(-8.0, 0.80, 0.90), vec3<f32>(4.0, 1.10, 0.95),
    vec3<f32>(-3.0, 0.90, 1.05), vec3<f32>(7.0, 1.20, 1.10),
    vec3<f32>(-5.0, 0.85, 1.15), vec3<f32>(2.0, 1.05, 1.20),
    vec3<f32>(0.0, 0.95, 1.25), vec3<f32>(10.0, 1.25, 1.30)
);

fn srgb_encode(value: f32) -> f32 {
    if (value <= 0.0031308) { return 12.92 * value; }
    return 1.055 * pow(value, 1.0 / 2.4) - 0.055;
}

fn pq_encode(nits: f32) -> f32 {
    let m1 = 2610.0 / 16384.0;
    let m2 = 2523.0 / 32.0;
    let c1 = 3424.0 / 4096.0;
    let c2 = 2413.0 / 128.0;
    let c3 = 2392.0 / 128.0;
    let power = pow(nits / 10000.0, m1);
    return pow((c1 + c2 * power) / (1.0 + c3 * power), m2);
}

fn hlg_encode(value: f32) -> f32 {
    let a = 0.17883277;
    let b = 1.0 - 4.0 * a;
    let c = 0.55991073;
    if (value <= 1.0 / 12.0) { return sqrt(3.0 * value); }
    return a * log(12.0 * value - b) + c;
}

fn dcp_sample(coordinates: vec3<f32>) -> vec3<f32> {
    var hue = coordinates.x % 360.0;
    if (hue < 0.0) { hue += 360.0; }
    let hue_coordinate = hue / 360.0 * 2.0;
    let hue_floor = floor(hue_coordinate);
    let h0 = u32(hue_floor) % 2u;
    let h1 = (h0 + 1u) % 2u;
    let hf = hue_coordinate - hue_floor;
    let sf = clamp(coordinates.y, 0.0, 1.0);
    let vf = clamp(coordinates.z, 0.0, 1.0);
    let a00 = mix(DCP[h0], DCP[h1], hf);
    let a10 = mix(DCP[h0 + 2u], DCP[h1 + 2u], hf);
    let a01 = mix(DCP[h0 + 4u], DCP[h1 + 4u], hf);
    let a11 = mix(DCP[h0 + 6u], DCP[h1 + 6u], hf);
    return mix(mix(a00, a10, sf), mix(a01, a11, sf), vf);
}

fn artistic_curve(value: f32) -> f32 {
    let x = value * 255.0;
    if (x <= 0.0) { return 0.0; }
    if (x >= 255.0) { return 1.0; }
    var p0 = vec2<f32>(0.0, 0.0);
    var p1 = vec2<f32>(0.0, 0.0);
    var p2 = vec2<f32>(64.0, 50.0);
    var p3 = vec2<f32>(128.0, 160.0);
    if (x > 64.0 && x <= 128.0) {
        p0 = vec2<f32>(0.0, 0.0); p1 = vec2<f32>(64.0, 50.0);
        p2 = vec2<f32>(128.0, 160.0); p3 = vec2<f32>(255.0, 255.0);
    } else if (x > 128.0) {
        p0 = vec2<f32>(64.0, 50.0); p1 = vec2<f32>(128.0, 160.0);
        p2 = vec2<f32>(255.0, 255.0); p3 = p2;
    }
    let before = (p1.y - p0.y) / max(0.001, p1.x - p0.x);
    let current = (p2.y - p1.y) / max(0.001, p2.x - p1.x);
    let after = (p3.y - p2.y) / max(0.001, p3.x - p2.x);
    var m1 = select((before + current) * 0.5, current, p1.x == 0.0);
    var m2 = select((current + after) * 0.5, current, p2.x == 255.0);
    let alpha = m1 / current; let beta = m2 / current;
    if (alpha * alpha + beta * beta > 9.0) {
        let scale = 3.0 / sqrt(alpha * alpha + beta * beta);
        m1 *= scale; m2 *= scale;
    }
    let dx = p2.x - p1.x; let t = (x - p1.x) / dx;
    let t2 = t * t; let t3 = t2 * t;
    let y = (2.0*t3 - 3.0*t2 + 1.0)*p1.y + (t3 - 2.0*t2 + t)*m1*dx
        + (-2.0*t3 + 3.0*t2)*p2.y + (t3 - t2)*m2*dx;
    return clamp(y / 255.0, 0.0, 1.0);
}

fn artistic_luma(c: vec3<f32>) -> f32 { return dot(c, vec3<f32>(0.2126, 0.7152, 0.0722)); }
fn artistic_levels(color: vec3<f32>) -> vec3<f32> {
    let source = max(artistic_luma(color), 0.0);
    let normalized = clamp((source - 0.05) / (0.92 - 0.05), 0.0, 1.0);
    let output = mix(0.02, 0.96, pow(normalized, 1.0 / 1.15));
    if (source <= 0.0001) { return vec3<f32>(output); }
    return clamp(color * (output / source), vec3<f32>(0.0), vec3<f32>(1.0));
}

fn artistic_hsv_to_rgb(hsv: vec3<f32>) -> vec3<f32> {
    let c = hsv.z * hsv.y; let x = c * (1.0 - abs((hsv.x / 60.0) % 2.0 - 1.0));
    let m = hsv.z - c; var p: vec3<f32>;
    if (hsv.x < 60.0) { p = vec3<f32>(c,x,0.0); }
    else if (hsv.x < 120.0) { p = vec3<f32>(x,c,0.0); }
    else if (hsv.x < 180.0) { p = vec3<f32>(0.0,c,x); }
    else if (hsv.x < 240.0) { p = vec3<f32>(0.0,x,c); }
    else if (hsv.x < 300.0) { p = vec3<f32>(x,0.0,c); }
    else { p = vec3<f32>(c,0.0,x); }
    return p + vec3<f32>(m);
}

fn artistic_rgb_to_hsv(rgb: vec3<f32>) -> vec3<f32> {
    let maximum = max(rgb.x, max(rgb.y, rgb.z)); let minimum = min(rgb.x, min(rgb.y, rgb.z));
    let delta = maximum - minimum; var hue = 0.0;
    if (delta > 0.0) {
        if (maximum == rgb.x) { hue = 60.0 * (((rgb.y - rgb.z) / delta) % 6.0); }
        else if (maximum == rgb.y) { hue = 60.0 * (((rgb.z - rgb.x) / delta) + 2.0); }
        else { hue = 60.0 * (((rgb.x - rgb.y) / delta) + 4.0); }
    }
    if (hue < 0.0) { hue += 360.0; }
    return vec3<f32>(hue, select(0.0, delta / maximum, maximum > 0.0), maximum);
}

fn artistic_hsl(color: vec3<f32>) -> vec3<f32> {
    let safe = max(color, vec3<f32>(0.0));
    if (abs(safe.x-safe.y) < 0.001 && abs(safe.y-safe.z) < 0.001) { return safe; }
    let hsv = artistic_rgb_to_hsv(safe); let source_luma = artistic_luma(safe);
    let sat_mask = smoothstep(0.05, 0.20, hsv.y); let lum_weight = smoothstep(0.0, 1.0, hsv.y);
    let centers = array<f32,8>(358.0,25.0,60.0,115.0,180.0,225.0,280.0,330.0);
    let widths = array<f32,8>(35.0,45.0,40.0,90.0,60.0,60.0,55.0,50.0);
    var raw: array<f32,8>; var total = 0.0;
    for (var i=0u; i<8u; i+=1u) {
        let absolute = abs(hsv.x-centers[i]); let distance = min(absolute, 360.0-absolute);
        raw[i] = exp(-1.5 * pow(distance/(widths[i]*0.5), 2.0)); total += raw[i];
    }
    let influence = raw[5] / total;
    let hue_shift = 0.1 * 2.0 * influence * sat_mask;
    let sat_adjust = 0.25 * influence * sat_mask;
    let lum_adjust = -0.08 * influence * lum_weight;
    let target_luma = source_luma * (1.0 + lum_adjust);
    if (hsv.y * (1.0 + sat_adjust) < 0.0001) { return vec3<f32>(target_luma); }
    let shifted = artistic_hsv_to_rgb(vec3<f32>((hsv.x+hue_shift+360.0)%360.0, clamp(hsv.y*(1.0+sat_adjust),0.0,1.0), hsv.z));
    let shifted_luma = artistic_luma(shifted);
    if (shifted_luma < 0.0001) { return vec3<f32>(max(0.0,target_luma)); }
    return shifted * (target_luma / shifted_luma);
}

fn artistic_grading(color: vec3<f32>) -> vec3<f32> {
    let luma = artistic_luma(max(color, vec3<f32>(0.0)));
    let shadow_mask = 1.0 - smoothstep(0.0, 0.2, luma);
    let highlight_mask = smoothstep(0.4, 0.6, luma);
    let midtone_mask = max(0.0, 1.0 - shadow_mask - highlight_mask);
    let tint = artistic_hsv_to_rgb(vec3<f32>(32.0, 1.0, 1.0));
    return color + (tint - 0.5) * 0.3 * midtone_mask * 0.6 + vec3<f32>(0.08 * midtone_mask * 0.8);
}

fn artistic_mask(base: vec3<f32>, mode: u32) -> vec3<f32> {
    let layer = vec3<f32>(0.8, 0.2, 0.6); var blended = layer;
    if (mode == 1u) { blended = base * layer; }
    if (mode == 2u) { blended = 1.0 - (1.0 - base) * (1.0 - layer); }
    return mix(base, blended, 0.65);
}

fn artistic_agx_sigmoid(x: f32) -> f32 {
    return x / pow(1.0 + pow(x, 1.5), 1.0 / 1.5);
}
fn artistic_agx_scaled(x: f32, scale: f32) -> f32 {
    return scale * artistic_agx_sigmoid(2.3843 * (x - 0.6060606) / scale) + 0.43446;
}
fn artistic_agx_curve(x: f32) -> f32 {
    var result = 0.0;
    if (x < 0.6060606) { result = artistic_agx_scaled(x, -1.0359); }
    else if (x <= 0.6060606) { result = 2.3843 * x - 1.0112; }
    else { result = artistic_agx_scaled(x, 1.3475); }
    return clamp(result, 0.0, 1.0);
}
fn artistic_agx(color: vec3<f32>) -> vec3<f32> {
    let minimum = min(color.x, min(color.y, color.z));
    let compressed = select(color, color - minimum, minimum < 0.0);
    let relative = max(compressed / 0.18, vec3<f32>(1e-6));
    let mapped = clamp((log2(relative) + 15.2) / 20.2, vec3<f32>(0.0), vec3<f32>(1.0));
    let curved = vec3<f32>(artistic_agx_curve(mapped.x), artistic_agx_curve(mapped.y), artistic_agx_curve(mapped.z));
    return pow(curved, vec3<f32>(2.4));
}

fn artistic_halation(color: vec3<f32>) -> vec3<f32> {
    let blurred = vec3<f32>(4.0, 3.0, 2.0); let amount = 0.7;
    let linear_luma = artistic_luma(blurred);
    let perceptual = 1.0 + pow(linear_luma - 1.0, 1.0 / 2.2);
    let cutoff = mix(0.85, 0.1, amount);
    let mask = smoothstep(0.0, max(1.5 - cutoff, 0.1) * 0.6, perceptual - cutoff);
    let tint = mix(vec3<f32>(1.0, 0.32, 0.10), vec3<f32>(1.0, 0.15, 0.03), smoothstep(0.0, 0.7, mask));
    let glow = tint * mask * linear_luma;
    let color_luma = artistic_luma(max(color, vec3<f32>(0.0)));
    let affected = mix(color, vec3<f32>(color_luma), mask * 0.12);
    let contrast = mix(vec3<f32>(0.5), affected, 1.0 - mask * 0.06);
    return contrast + glow * amount * 2.5;
}

const ARTISTIC_LUT: array<vec3<f32>, 8> = array<vec3<f32>, 8>(
    vec3<f32>(0.0, 0.0, 0.02), vec3<f32>(0.9, 0.05, 0.02),
    vec3<f32>(0.1, 0.85, 0.05), vec3<f32>(0.95, 0.9, 0.1),
    vec3<f32>(0.02, 0.1, 0.8), vec3<f32>(0.8, 0.15, 0.9),
    vec3<f32>(0.15, 0.8, 0.95), vec3<f32>(1.0, 0.95, 1.0)
);
fn artistic_lut_at(x: u32, y: u32, z: u32) -> vec3<f32> {
    return ARTISTIC_LUT[x + 2u * (y + 2u * z)];
}
fn artistic_lut(uv: vec3<f32>) -> vec3<f32> {
    let scaled = clamp(uv, vec3<f32>(0.0), vec3<f32>(1.0));
    let base = vec3<u32>(floor(scaled)); let next = min(base + vec3<u32>(1), vec3<u32>(1));
    let f = scaled - vec3<f32>(base);
    let c000 = artistic_lut_at(base.x, base.y, base.z); let c111 = artistic_lut_at(next.x, next.y, next.z);
    if (f.x > f.y) {
        if (f.y > f.z) { return c000*(1.0-f.x) + artistic_lut_at(next.x,base.y,base.z)*(f.x-f.y) + artistic_lut_at(next.x,next.y,base.z)*(f.y-f.z) + c111*f.z; }
        if (f.x > f.z) { return c000*(1.0-f.x) + artistic_lut_at(next.x,base.y,base.z)*(f.x-f.z) + artistic_lut_at(next.x,base.y,next.z)*(f.z-f.y) + c111*f.y; }
        return c000*(1.0-f.z) + artistic_lut_at(base.x,base.y,next.z)*(f.z-f.x) + artistic_lut_at(next.x,base.y,next.z)*(f.x-f.y) + c111*f.y;
    }
    if (f.z > f.y) { return c000*(1.0-f.z) + artistic_lut_at(base.x,base.y,next.z)*(f.z-f.y) + artistic_lut_at(base.x,next.y,next.z)*(f.y-f.x) + c111*f.x; }
    if (f.z > f.x) { return c000*(1.0-f.y) + artistic_lut_at(base.x,next.y,base.z)*(f.y-f.z) + artistic_lut_at(base.x,next.y,next.z)*(f.z-f.x) + c111*f.x; }
    return c000*(1.0-f.y) + artistic_lut_at(base.x,next.y,base.z)*(f.y-f.x) + artistic_lut_at(next.x,next.y,base.z)*(f.x-f.z) + c111*f.z;
}

fn artistic_white_balance(color: vec3<f32>) -> vec3<f32> {
    return color * vec3<f32>(1.036, 1.009, 0.964) * vec3<f32>(0.97, 1.03, 0.97);
}
fn artistic_local_contrast(color: vec3<f32>) -> vec3<f32> {
    let blurred = vec3<f32>(0.3); let center_luma = artistic_luma(color);
    let midtone = smoothstep(0.0, 0.1, center_luma) * (1.0 - smoothstep(0.9, 1.0, center_luma));
    if (midtone < 0.001) { return color; }
    let ratio = log2(max(center_luma, 0.0001) / 0.3); let magnitude = abs(ratio);
    let effective = 0.5 * (1.0 - sqrt(clamp(magnitude / 3.0, 0.0, 1.0))) * smoothstep(0.04, 0.12, magnitude) * 0.8;
    return mix(color, color * exp2(ratio * effective), midtone);
}
fn artistic_glow(color: vec3<f32>) -> vec3<f32> {
    let blurred = vec3<f32>(2.0, 1.5, 1.0); let amount = 0.7; let linear_luma = artistic_luma(blurred);
    let perceptual = 1.0 + pow(linear_luma - 1.0, 1.0 / 2.2); let cutoff = mix(0.75, 0.08, amount);
    let fade = smoothstep(cutoff, cutoff + 0.15, perceptual); let intensity = pow(smoothstep(0.0, 1.0, max(perceptual-cutoff,0.0)/5.5),0.45);
    let bloom = blurred / linear_luma * vec3<f32>(1.03,1.0,0.97) * intensity * pow(linear_luma,0.6) * fade * sqrt(smoothstep(0.0,0.5,linear_luma));
    let protection = 1.0 - smoothstep(1.0,2.2,artistic_luma(max(color,vec3<f32>(0.0))));
    return color + bloom * amount * 3.8 * protection;
}
fn artistic_flare(color: vec3<f32>) -> vec3<f32> {
    let sample = vec3<f32>(0.8,0.4,0.2); let luma = artistic_luma(max(color,vec3<f32>(0.0)));
    let perceptual = select(1.0+pow(luma-1.0,1.0/2.2),pow(max(luma,0.0),1.0/2.2),luma<=1.0);
    return color + pow(sample*1.4,vec3<f32>(2.0))*0.5*(1.0-smoothstep(0.7,1.8,perceptual));
}

fn artistic_calibration(color: vec3<f32>) -> vec3<f32> {
    let red_hue = 0.08; let green_hue = -0.06; let blue_hue = 0.04;
    let red = vec3<f32>(1.0-abs(red_hue), max(red_hue,0.0), max(-red_hue,0.0));
    let green = vec3<f32>(max(-green_hue,0.0), 1.0-abs(green_hue), max(green_hue,0.0));
    let blue = vec3<f32>(max(blue_hue,0.0), max(-blue_hue,0.0), 1.0-abs(blue_hue));
    var calibrated = red * color.x + green * color.y + blue * color.z;
    let value_luma = artistic_luma(max(calibrated, vec3<f32>(0.0)));
    let sum = calibrated.x + calibrated.y + calibrated.z;
    let masks = select(vec3<f32>(0.0), calibrated / sum, sum > 0.001);
    let saturation = dot(masks, vec3<f32>(0.12, -0.08, 0.16));
    calibrated += (calibrated - value_luma) * saturation;
    let shadows_tint = -0.1;
    let mask = 1.0 - smoothstep(0.0, 0.3, artistic_luma(max(calibrated, vec3<f32>(0.0))));
    let scale = vec3<f32>(1.0+shadows_tint*0.25, 1.0-shadows_tint*0.25, 1.0+shadows_tint*0.25);
    return mix(calibrated, calibrated * scale, mask);
}

fn artistic_brightness(color: vec3<f32>) -> vec3<f32> {
    let brightness = 0.35; let original_luma = artistic_luma(color);
    if (abs(original_luma) < 0.00001) { return color; }
    let scale = exp2(brightness * 0.05); let k = exp2(-brightness * 0.95 * 1.2);
    let luma_abs = abs(original_luma); let level_floor = floor(luma_abs / 1.06) * 1.06;
    let normalized = (luma_abs - level_floor) / 1.06;
    let shaped = normalized / (normalized + (1.0-normalized) * k);
    let new_luma = sign(original_luma) * (level_floor + shaped * 1.06) * scale;
    let total_scale = new_luma / original_luma;
    let exponent = mix(0.95, 0.65, clamp(new_luma, 0.0, 2.0) * 0.5);
    let chroma_scale = pow(total_scale, exponent) / (1.0 + max(new_luma-0.9,0.0)*2.0);
    return vec3<f32>(new_luma) + (color-vec3<f32>(original_luma))*chroma_scale;
}

fn artistic_vignette(color: vec3<f32>, coordinate: vec2<f32>) -> vec3<f32> {
    let dimensions = vec2<f32>(3.0, 2.0); let centered = coordinate / dimensions * 2.0 - 1.0;
    let power = 0.75; let shaped = sign(centered) * pow(abs(centered), vec2<f32>(power));
    let distance = length(vec2<f32>(shaped.x, shaped.y * dimensions.y / dimensions.x)) * 0.5;
    let mask = smoothstep(0.25, 0.65, distance);
    return color * (1.0 - 0.45 * mask);
}

fn artistic_hash2(point: vec2<f32>) -> f32 {
    var p = fract(vec3<f32>(point.x, point.y, point.x) * 0.1031);
    p += dot(p, p.yzx + 33.33);
    return fract((p.x + p.y) * p.z);
}
fn artistic_gradient_noise(point: vec2<f32>) -> f32 {
    let integer = floor(point); let fraction = fract(point);
    let u = fraction * fraction * (3.0 - 2.0 * fraction);
    let gradient = array<vec2<f32>,4>(
        vec2<f32>(artistic_hash2(integer)*2.0-1.0, artistic_hash2(integer+vec2<f32>(11.0,37.0))*2.0-1.0),
        vec2<f32>(artistic_hash2(integer+vec2<f32>(1.0,0.0))*2.0-1.0, artistic_hash2(integer+vec2<f32>(12.0,37.0))*2.0-1.0),
        vec2<f32>(artistic_hash2(integer+vec2<f32>(0.0,1.0))*2.0-1.0, artistic_hash2(integer+vec2<f32>(11.0,38.0))*2.0-1.0),
        vec2<f32>(artistic_hash2(integer+vec2<f32>(1.0,1.0))*2.0-1.0, artistic_hash2(integer+vec2<f32>(12.0,38.0))*2.0-1.0));
    let a=dot(gradient[0],fraction); let b=dot(gradient[1],fraction-vec2<f32>(1.0,0.0));
    let c=dot(gradient[2],fraction-vec2<f32>(0.0,1.0)); let d=dot(gradient[3],fraction-vec2<f32>(1.0));
    return mix(mix(a,b,u.x),mix(c,d,u.x),u.y);
}
fn artistic_grain(color: vec3<f32>, coordinate: vec2<f32>) -> vec3<f32> {
    let scale = max(2.0/1080.0,0.1); let frequency = (1.0/1.4)/scale;
    let base = artistic_gradient_noise(coordinate*frequency);
    let rough = artistic_gradient_noise(coordinate*frequency*0.6+vec2<f32>(5.2,1.3));
    let noise = mix(base,rough,0.35); let value_luma = max(artistic_luma(color),0.0);
    let mask = smoothstep(0.0,0.15,value_luma)*(1.0-smoothstep(0.6,1.0,value_luma));
    return color + vec3<f32>(noise*0.28*0.5*mask);
}

fn execute(operation: u32, value: vec4<f32>, index: u32) -> vec4<f32> {
    var result = value;
    if (operation == 1u) {
        result = vec4<f32>(srgb_encode(value.x), srgb_encode(value.y), srgb_encode(value.z), value.w);
    } else if (operation == 2u) {
        result = vec4<f32>(pq_encode(value.x), pq_encode(value.y), pq_encode(value.z), value.w);
    } else if (operation == 3u) {
        result = vec4<f32>(hlg_encode(value.x), hlg_encode(value.y), hlg_encode(value.z), value.w);
    } else if (operation == 4u) {
        result = vec4<f32>(dcp_sample(value.xyz), value.w);
    } else if (operation == 5u) {
        result = vec4<f32>(artistic_curve(value.x), artistic_curve(value.y), artistic_curve(value.z), value.w);
    } else if (operation == 6u) {
        result = vec4<f32>(artistic_levels(value.xyz), value.w);
    } else if (operation == 7u) {
        result = vec4<f32>(artistic_grading(value.xyz), value.w);
    } else if (operation == 8u) {
        result = vec4<f32>(artistic_mask(value.xyz, 0u), value.w);
    } else if (operation == 9u) {
        result = vec4<f32>(artistic_mask(value.xyz, 1u), value.w);
    } else if (operation == 10u) {
        result = vec4<f32>(artistic_mask(value.xyz, 2u), value.w);
    } else if (operation == 11u) {
        result = vec4<f32>(artistic_hsl(value.xyz), value.w);
    } else if (operation == 12u) {
        var clipped = value.xyz;
        if (any(value.xyz > vec3<f32>(0.998))) { clipped = vec3<f32>(1.0, 0.0, 0.0); }
        else if (any(value.xyz < vec3<f32>(0.002))) { clipped = vec3<f32>(0.0, 0.0, 1.0); }
        result = vec4<f32>(clipped, value.w);
    } else if (operation == 13u) {
        result = vec4<f32>(artistic_agx(value.xyz), value.w);
    } else if (operation == 14u) {
        result = vec4<f32>(artistic_halation(value.xyz), value.w);
    } else if (operation == 15u) {
        result = vec4<f32>(artistic_lut(value.xyz), value.w);
    } else if (operation == 16u) {
        result = vec4<f32>(artistic_white_balance(value.xyz), value.w);
    } else if (operation == 17u) {
        result = vec4<f32>(artistic_local_contrast(value.xyz), value.w);
    } else if (operation == 18u) {
        result = vec4<f32>(artistic_glow(value.xyz), value.w);
    } else if (operation == 19u) {
        result = vec4<f32>(artistic_flare(value.xyz), value.w);
    } else if (operation == 20u) {
        result = vec4<f32>(artistic_calibration(value.xyz), value.w);
    } else if (operation == 21u) {
        result = vec4<f32>(artistic_brightness(value.xyz), value.w);
    } else if (operation == 22u) {
        result = vec4<f32>(artistic_vignette(value.xyz, vec2<f32>(f32(index%3u), f32(index/3u))), value.w);
    } else if (operation == 23u) {
        var coordinate = vec2<f32>(f32(index%3u), f32(index/3u));
        if (parameters.defect == 3u) { coordinate.x = f32(index%2u); }
        result = vec4<f32>(artistic_grain(value.xyz, coordinate), value.w);
    }
    if (parameters.defect == 1u) { result = clamp(result, vec4<f32>(0.0), vec4<f32>(1.0)); }
    if (parameters.defect == 2u) { result = result.bgra; }
    return result;
}

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
    if (id.x < parameters.sample_count) {
        destination[id.x] = execute(parameters.operation, source[id.x], id.x);
    }
}
"#;

const TEXTURE_SHADER_16: &str = r#"
@group(0) @binding(0) var<storage, read> source: array<vec4<f32>>;
@group(0) @binding(1) var destination: texture_storage_2d<rgba16float, write>;
@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
    if (id.x < arrayLength(&source)) { textureStore(destination, vec2<u32>(id.x, 0u), source[id.x]); }
}
"#;

const TEXTURE_SHADER_32: &str = r#"
@group(0) @binding(0) var<storage, read> source: array<vec4<f32>>;
@group(0) @binding(1) var destination: texture_storage_2d<rgba32float, write>;
@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
    if (id.x < arrayLength(&source)) { textureStore(destination, vec2<u32>(id.x, 0u), source[id.x]); }
}
"#;

#[derive(Clone, Copy, Debug, Serialize)]
#[serde(rename_all = "snake_case")]
enum Operation {
    Identity = 0,
    SrgbEncode = 1,
    PqInverseEotf = 2,
    HlgOetf = 3,
    DcpHueSatMap = 4,
    ToneCurve = 5,
    Levels = 6,
    ColorGrading = 7,
    MaskNormal = 8,
    MaskMultiply = 9,
    MaskScreen = 10,
    HslRanges = 11,
    ClippingOverlay = 12,
    AgxToneMap = 13,
    Halation = 14,
    LutTetrahedral = 15,
    WhiteBalance = 16,
    LocalContrast = 17,
    Glow = 18,
    Flare = 19,
    ColorCalibration = 20,
    FilmicBrightness = 21,
    Vignette = 22,
    Grain = 23,
}

impl Operation {
    const ALL: [Self; 24] = [
        Self::Identity,
        Self::SrgbEncode,
        Self::PqInverseEotf,
        Self::HlgOetf,
        Self::DcpHueSatMap,
        Self::ToneCurve,
        Self::Levels,
        Self::ColorGrading,
        Self::MaskNormal,
        Self::MaskMultiply,
        Self::MaskScreen,
        Self::HslRanges,
        Self::ClippingOverlay,
        Self::AgxToneMap,
        Self::Halation,
        Self::LutTetrahedral,
        Self::WhiteBalance,
        Self::LocalContrast,
        Self::Glow,
        Self::Flare,
        Self::ColorCalibration,
        Self::FilmicBrightness,
        Self::Vignette,
        Self::Grain,
    ];

    fn vectors(self) -> Vec<[f32; 4]> {
        match self {
            Self::Identity | Self::SrgbEncode => vec![
                [-0.25, -0.01, 0.0, 1.0],
                [0.003_130_8, 0.18, 1.0, 1.0],
                [4.0, 4.0, 4.0, 1.0],
                [1.5, 0.05, -0.05, 1.0],
                [0.05, 0.9, 0.2, 1.0],
                [0.15, 0.2, 1.25, 1.0],
            ],
            Self::PqInverseEotf => vec![
                [0.0, 0.1, 1.0, 1.0],
                [10.0, 100.0, 203.0, 1.0],
                [1_000.0, 4_000.0, 10_000.0, 1.0],
                [12_000.0, 15_000.0, 20_000.0, 1.0],
            ],
            Self::HlgOetf => vec![
                [0.0, 1.0 / 48.0, 1.0 / 12.0, 1.0],
                [0.18, 0.5, 1.0, 1.0],
                [1.5, 2.0, 4.0, 1.0],
            ],
            Self::DcpHueSatMap => vec![
                [-30.0, 0.0, 0.0, 1.0],
                [0.0, 0.25, 0.75, 1.0],
                [75.0, 0.5, 0.5, 1.0],
                [179.5, 1.0, 1.0, 1.0],
                [359.5, 0.9, 0.1, 1.0],
                [390.0, 1.5, -0.5, 1.0],
            ],
            Self::ToneCurve
            | Self::Levels
            | Self::ColorGrading
            | Self::MaskNormal
            | Self::MaskMultiply
            | Self::MaskScreen
            | Self::HslRanges
            | Self::ClippingOverlay
            | Self::AgxToneMap
            | Self::Halation
            | Self::LutTetrahedral
            | Self::WhiteBalance
            | Self::LocalContrast
            | Self::Glow
            | Self::Flare
            | Self::ColorCalibration
            | Self::FilmicBrightness
            | Self::Vignette
            | Self::Grain => vec![
                [-0.25, -0.01, 0.0, 0.25],
                [0.003_130_8, 0.18, 1.0, 0.5],
                [0.05, 0.9, 0.2, 0.75],
                [1.5, 0.05, -0.05, 1.0],
                [4.0, 2.0, 1.25, 0.33],
                [0.42, 0.35, 0.28, 0.9],
            ],
        }
    }

    fn input_domain(self) -> &'static str {
        match self {
            Self::ToneCurve => DISPLAY_ENCODED_EXTENDED_DOMAIN,
            Self::Levels
            | Self::ColorGrading
            | Self::HslRanges
            | Self::MaskNormal
            | Self::MaskMultiply
            | Self::MaskScreen
            | Self::ClippingOverlay
            | Self::AgxToneMap
            | Self::Halation
            | Self::WhiteBalance
            | Self::LocalContrast
            | Self::Glow
            | Self::Flare => SCENE_LINEAR_EXTENDED_DOMAIN,
            Self::ColorCalibration | Self::FilmicBrightness | Self::Vignette | Self::Grain => {
                SCENE_LINEAR_EXTENDED_DOMAIN
            }
            Self::LutTetrahedral => DISPLAY_ENCODED_EXTENDED_DOMAIN,
            Self::Identity => "unbounded_rgba_linear_v1",
            Self::SrgbEncode => "linear_srgb_extended_v1",
            Self::PqInverseEotf => "absolute_luminance_nits_v1",
            Self::HlgOetf => "scene_linear_hlg_nonnegative_v1",
            Self::DcpHueSatMap => "dcp_hue_sat_coordinates_v1",
        }
    }

    fn output_domain(self) -> &'static str {
        match self {
            Self::ToneCurve => "display_encoded_rgb_bounded_v1",
            Self::Levels => "scene_linear_rgb_bounded_v1",
            Self::ColorGrading
            | Self::HslRanges
            | Self::MaskNormal
            | Self::MaskMultiply
            | Self::MaskScreen
            | Self::Halation
            | Self::WhiteBalance
            | Self::LocalContrast
            | Self::Glow
            | Self::Flare => SCENE_LINEAR_EXTENDED_DOMAIN,
            Self::ColorCalibration | Self::FilmicBrightness | Self::Vignette | Self::Grain => {
                SCENE_LINEAR_EXTENDED_DOMAIN
            }
            Self::ClippingOverlay => "display_encoded_clipping_overlay_v1",
            Self::AgxToneMap => "display_referred_linear_bounded_v1",
            Self::LutTetrahedral => "display_encoded_rgb_bounded_v1",
            Self::Identity => "unbounded_rgba_linear_v1",
            Self::SrgbEncode => DISPLAY_ENCODED_EXTENDED_DOMAIN,
            Self::PqInverseEotf => "pq_signal_v1",
            Self::HlgOetf => "hlg_signal_extended_v1",
            Self::DcpHueSatMap => "dcp_hue_sat_adjustment_v1",
        }
    }
}

#[derive(Clone, Copy, Debug)]
enum StorageKind {
    Buffer32,
    Rgba16Float,
    Rgba32Float,
}

impl StorageKind {
    fn label(self) -> &'static str {
        match self {
            Self::Buffer32 => "storage_buffer_f32",
            Self::Rgba16Float => "rgba16float",
            Self::Rgba32Float => "rgba32float",
        }
    }
}

#[derive(Debug, Serialize)]
struct StageReport {
    operation: Operation,
    input_domain: &'static str,
    output_domain: &'static str,
    reference_contract: &'static str,
    buffer32_tolerance: f64,
    cpu_max_abs_error: f64,
    gpu_buffer_max_abs_error: f64,
    rgba16f_max_abs_error: Option<f64>,
    rgba32f_max_abs_error: Option<f64>,
    sample_count: usize,
}

#[derive(Debug, Serialize)]
struct FormatCapability {
    format: &'static str,
    storage_write_and_copy_src: bool,
    disposition: &'static str,
}

#[derive(Debug, Serialize)]
struct TimingReport {
    adapter_init_ms: f64,
    pipeline_init_ms: f64,
    execution_and_readback_ms: f64,
    cpu_reference_ms: f64,
}

#[derive(Debug, Serialize)]
struct BackendProofReport {
    contract: &'static str,
    adapter_name: String,
    backend: String,
    driver: String,
    driver_info: String,
    vendor: u32,
    device: u32,
    device_type: String,
    os: String,
    architecture: &'static str,
    formats: Vec<FormatCapability>,
    stages: Vec<StageReport>,
    injected_clamp_detected: bool,
    injected_channel_swap_detected: bool,
    injected_artistic_channel_swap_count: usize,
    injected_tile_local_grain_detected: bool,
    timings: TimingReport,
}

struct HardwareContext {
    adapter: wgpu::Adapter,
    device: wgpu::Device,
    queue: wgpu::Queue,
    adapter_init_ms: f64,
}

struct GpuBufferRun {
    output: Vec<[f32; 4]>,
    buffer: wgpu::Buffer,
    pipeline_init_ms: f64,
    execution_and_readback_ms: f64,
}

fn hardware_context() -> Result<HardwareContext, String> {
    let started = Instant::now();
    let instance =
        wgpu::Instance::new(wgpu::InstanceDescriptor::new_without_display_handle_from_env());
    let adapter = pollster::block_on(instance.request_adapter(&wgpu::RequestAdapterOptions {
        power_preference: wgpu::PowerPreference::HighPerformance,
        compatible_surface: None,
        ..Default::default()
    }))
    .map_err(|error| format!("color_backend_adapter_unavailable:{error}"))?;
    let mut required_features = wgpu::Features::empty();
    if adapter
        .features()
        .contains(wgpu::Features::TEXTURE_ADAPTER_SPECIFIC_FORMAT_FEATURES)
    {
        required_features |= wgpu::Features::TEXTURE_ADAPTER_SPECIFIC_FORMAT_FEATURES;
    }
    let (device, queue) = pollster::block_on(adapter.request_device(&wgpu::DeviceDescriptor {
        label: Some("RapidRaw color backend conformance device"),
        required_features,
        required_limits: adapter.limits(),
        experimental_features: wgpu::ExperimentalFeatures::default(),
        memory_hints: wgpu::MemoryHints::Performance,
        trace: wgpu::Trace::Off,
    }))
    .map_err(|error| format!("color_backend_device_unavailable:{error}"))?;
    Ok(HardwareContext {
        adapter,
        device,
        queue,
        adapter_init_ms: started.elapsed().as_secs_f64() * 1_000.0,
    })
}

fn production_cpu(operation: Operation, samples: &[[f32; 4]]) -> Vec<[f32; 4]> {
    samples
        .iter()
        .enumerate()
        .map(|(index, sample)| {
            let map = |value: f32| match operation {
                Operation::SrgbEncode => {
                    if value <= 0.003_130_8 {
                        12.92 * value
                    } else {
                        1.055 * value.powf(1.0 / 2.4) - 0.055
                    }
                }
                Operation::PqInverseEotf => {
                    let m1 = 2610.0 / 16_384.0;
                    let m2 = 2523.0 / 32.0;
                    let c1 = 3424.0 / 4096.0;
                    let c2 = 2413.0 / 128.0;
                    let c3 = 2392.0 / 128.0;
                    let power = (value / 10_000.0).powf(m1);
                    ((c1 + c2 * power) / (1.0 + c3 * power)).powf(m2)
                }
                Operation::HlgOetf => {
                    const A: f32 = 0.178_832_77;
                    const B: f32 = 1.0 - 4.0 * A;
                    const C: f32 = 0.559_910_7;
                    if value <= 1.0 / 12.0 {
                        (3.0 * value).sqrt()
                    } else {
                        A * (12.0 * value - B).ln() + C
                    }
                }
                _ => value,
            };
            if matches!(
                operation,
                Operation::ToneCurve
                    | Operation::Levels
                    | Operation::ColorGrading
                    | Operation::MaskNormal
                    | Operation::MaskMultiply
                    | Operation::MaskScreen
                    | Operation::HslRanges
                    | Operation::ClippingOverlay
                    | Operation::AgxToneMap
                    | Operation::Halation
                    | Operation::LutTetrahedral
                    | Operation::WhiteBalance
                    | Operation::LocalContrast
                    | Operation::Glow
                    | Operation::Flare
                    | Operation::ColorCalibration
                    | Operation::FilmicBrightness
                    | Operation::Vignette
                    | Operation::Grain
            ) {
                let result = artistic_oracle_sample(operation, *sample, index)
                    .expect("artistic f64 oracle accepts governed vectors");
                result.map(|value| value as f32)
            } else if matches!(operation, Operation::DcpHueSatMap) {
                let result = production_dcp_sample([sample[0], sample[1], sample[2]]);
                [result[0], result[1], result[2], sample[3]]
            } else {
                [map(sample[0]), map(sample[1]), map(sample[2]), sample[3]]
            }
        })
        .collect()
}

fn production_dcp_sample(coordinates: [f32; 3]) -> [f32; 3] {
    let hue_coordinate = coordinates[0].rem_euclid(360.0) / 360.0 * 2.0;
    let hue_floor = hue_coordinate.floor();
    let h0 = hue_floor as usize % 2;
    let h1 = (h0 + 1) % 2;
    let hf = hue_coordinate - hue_floor;
    let sf = coordinates[1].clamp(0.0, 1.0);
    let vf = coordinates[2].clamp(0.0, 1.0);
    let interpolate = |component: usize| {
        let mix = |left: f32, right: f32, amount: f32| left + (right - left) * amount;
        let a00 = mix(DCP_ENTRIES[h0][component], DCP_ENTRIES[h1][component], hf);
        let a10 = mix(
            DCP_ENTRIES[h0 + 2][component],
            DCP_ENTRIES[h1 + 2][component],
            hf,
        );
        let a01 = mix(
            DCP_ENTRIES[h0 + 4][component],
            DCP_ENTRIES[h1 + 4][component],
            hf,
        );
        let a11 = mix(
            DCP_ENTRIES[h0 + 6][component],
            DCP_ENTRIES[h1 + 6][component],
            hf,
        );
        mix(mix(a00, a10, sf), mix(a01, a11, sf), vf)
    };
    [interpolate(0), interpolate(1), interpolate(2)]
}

fn oracle(operation: Operation, samples: &[[f32; 4]]) -> Result<Vec<[f64; 4]>, String> {
    let dcp = HueSatMap::new(
        HueSatMapDimensions::new(2, 2, 2).map_err(|error| format!("{error:?}"))?,
        DCP_ENTRIES
            .iter()
            .map(|entry| {
                HueSatMapEntry::new(entry[0] as f64, entry[1] as f64, entry[2] as f64)
                    .map_err(|error| format!("{error:?}"))
            })
            .collect::<Result<Vec<_>, _>>()?,
    )
    .map_err(|error| format!("{error:?}"))?;
    samples
        .iter()
        .enumerate()
        .map(|(index, sample)| {
            let alpha = sample[3] as f64;
            match operation {
                Operation::Identity => {
                    Ok([sample[0] as f64, sample[1] as f64, sample[2] as f64, alpha])
                }
                Operation::SrgbEncode => Ok([
                    linear_to_srgb_channel(sample[0] as f64),
                    linear_to_srgb_channel(sample[1] as f64),
                    linear_to_srgb_channel(sample[2] as f64),
                    alpha,
                ]),
                Operation::PqInverseEotf => {
                    let encode = |value: f32| {
                        pq_inverse_eotf(
                            AbsoluteLuminanceNits::new(value as f64)
                                .map_err(|error| format!("{error:?}"))?,
                        )
                        .map(|signal| signal.value())
                        .map_err(|error| format!("{error:?}"))
                    };
                    Ok([
                        encode(sample[0])?,
                        encode(sample[1])?,
                        encode(sample[2])?,
                        alpha,
                    ])
                }
                Operation::HlgOetf => {
                    let encode = |value: f32| {
                        hlg_oetf(
                            SceneLinearHlg::new(value as f64)
                                .map_err(|error| format!("{error:?}"))?,
                        )
                        .map(|signal| signal.value())
                        .map_err(|error| format!("{error:?}"))
                    };
                    Ok([
                        encode(sample[0])?,
                        encode(sample[1])?,
                        encode(sample[2])?,
                        alpha,
                    ])
                }
                Operation::DcpHueSatMap => {
                    let result = dcp
                        .evaluate(
                            HueSatCoordinates::new(
                                sample[0] as f64,
                                sample[1] as f64,
                                sample[2] as f64,
                            )
                            .map_err(|error| format!("{error:?}"))?,
                            BoundaryPolicy::Clamp,
                        )
                        .map_err(|error| format!("{error:?}"))?;
                    Ok([
                        result.hue_shift_degrees,
                        result.saturation_scale,
                        result.value_scale,
                        alpha,
                    ])
                }
                Operation::ToneCurve
                | Operation::Levels
                | Operation::ColorGrading
                | Operation::MaskNormal
                | Operation::MaskMultiply
                | Operation::MaskScreen
                | Operation::HslRanges
                | Operation::ClippingOverlay
                | Operation::AgxToneMap
                | Operation::Halation
                | Operation::LutTetrahedral
                | Operation::WhiteBalance
                | Operation::LocalContrast
                | Operation::Glow
                | Operation::Flare
                | Operation::ColorCalibration
                | Operation::FilmicBrightness
                | Operation::Vignette
                | Operation::Grain => artistic_oracle_sample(operation, *sample, index),
            }
        })
        .collect()
}

fn artistic_oracle_sample(
    operation: Operation,
    sample: [f32; 4],
    index: usize,
) -> Result<[f64; 4], String> {
    let rgb = [
        f64::from(sample[0]),
        f64::from(sample[1]),
        f64::from(sample[2]),
    ];
    let map_error = |error| format!("artistic_reference:{error:?}");
    let output = match operation {
        Operation::ToneCurve => {
            let points = [
                CurvePoint::new(0.0, 0.0).map_err(map_error)?,
                CurvePoint::new(64.0, 50.0).map_err(map_error)?,
                CurvePoint::new(128.0, 160.0).map_err(map_error)?,
                CurvePoint::new(255.0, 255.0).map_err(map_error)?,
            ];
            [
                apply_monotone_curve(rgb[0], &points).map_err(map_error)?,
                apply_monotone_curve(rgb[1], &points).map_err(map_error)?,
                apply_monotone_curve(rgb[2], &points).map_err(map_error)?,
            ]
        }
        Operation::Levels => apply_luma_levels(
            rgb,
            Levels {
                input_black: 0.05,
                input_white: 0.92,
                gamma: 1.15,
                output_black: 0.02,
                output_white: 0.96,
            },
        )
        .map_err(map_error)?,
        Operation::ColorGrading => apply_color_grading(
            rgb,
            ColorGrade::default(),
            ColorGrade {
                hue_degrees: 32.0,
                saturation: 0.3,
                luminance: 0.08,
            },
            ColorGrade::default(),
            ColorGrade::default(),
            0.5,
            0.0,
        )
        .map_err(map_error)?,
        Operation::HslRanges => {
            let mut adjustments = [HslAdjustment::default(); 8];
            adjustments[5] = HslAdjustment {
                hue: 0.1,
                saturation: 0.25,
                luminance: -0.08,
            };
            apply_hsl_ranges(rgb, adjustments).map_err(map_error)?
        }
        Operation::ClippingOverlay => apply_clipping_overlay(rgb, true).map_err(map_error)?,
        Operation::AgxToneMap => agx_tonemap_identity_matrix(rgb).map_err(map_error)?,
        Operation::Halation => apply_halation_raw(rgb, [4.0, 3.0, 2.0], 0.7).map_err(map_error)?,
        Operation::LutTetrahedral => Lut3d::new(
            2,
            vec![
                [0.0, 0.0, 0.02],
                [0.9, 0.05, 0.02],
                [0.1, 0.85, 0.05],
                [0.95, 0.9, 0.1],
                [0.02, 0.1, 0.8],
                [0.8, 0.15, 0.9],
                [0.15, 0.8, 0.95],
                [1.0, 0.95, 1.0],
            ],
        )
        .map_err(map_error)?
        .evaluate_tetrahedral(rgb)
        .map_err(map_error)?,
        Operation::WhiteBalance => apply_white_balance(rgb, 0.18, -0.12).map_err(map_error)?,
        Operation::LocalContrast => {
            apply_local_contrast(rgb, [0.3; 3], 0.5, 0.08, true).map_err(map_error)?
        }
        Operation::Glow => apply_glow_raw(rgb, [2.0, 1.5, 1.0], 0.7).map_err(map_error)?,
        Operation::Flare => apply_flare(rgb, [0.8, 0.4, 0.2], 0.5).map_err(map_error)?,
        Operation::ColorCalibration => apply_color_calibration(
            rgb,
            ColorCalibration {
                red_hue: 0.08,
                green_hue: -0.06,
                blue_hue: 0.04,
                red_saturation: 0.12,
                green_saturation: -0.08,
                blue_saturation: 0.16,
                shadows_tint: -0.1,
            },
        )
        .map_err(map_error)?,
        Operation::FilmicBrightness => apply_filmic_brightness(rgb, 0.35).map_err(map_error)?,
        Operation::Vignette => apply_vignette(
            rgb,
            [(index % 3) as f64, (index / 3) as f64],
            [3.0, 2.0],
            -0.45,
            0.45,
            0.25,
            0.4,
        )
        .map_err(map_error)?,
        Operation::Grain => apply_grain(
            rgb,
            [(index % 3) as f64, (index / 3) as f64],
            [3.0, 2.0],
            0.28,
            1.4,
            0.35,
        )
        .map_err(map_error)?,
        Operation::MaskNormal | Operation::MaskMultiply | Operation::MaskScreen => {
            let mode = match operation {
                Operation::MaskNormal => MaskBlendMode::Normal,
                Operation::MaskMultiply => MaskBlendMode::Multiply,
                Operation::MaskScreen => MaskBlendMode::Screen,
                _ => unreachable!(),
            };
            blend_mask_layer(rgb, [0.8, 0.2, 0.6], 0.65, mode).map_err(map_error)?
        }
        _ => return Err(format!("artistic_reference_wrong_operation:{operation:?}")),
    };
    Ok([output[0], output[1], output[2], f64::from(sample[3])])
}

fn run_gpu_buffer(
    context: &HardwareContext,
    operation: Operation,
    defect: u32,
    samples: &[[f32; 4]],
) -> Result<GpuBufferRun, String> {
    let pipeline_started = Instant::now();
    let source = context
        .device
        .create_buffer_init(&wgpu::util::BufferInitDescriptor {
            label: Some("color differential source"),
            contents: bytemuck::cast_slice(samples),
            usage: wgpu::BufferUsages::STORAGE,
        });
    let output_size = std::mem::size_of_val(samples) as u64;
    let destination = context.device.create_buffer(&wgpu::BufferDescriptor {
        label: Some("color differential destination"),
        size: output_size,
        usage: wgpu::BufferUsages::STORAGE | wgpu::BufferUsages::COPY_SRC,
        mapped_at_creation: false,
    });
    let params = [operation as u32, defect, samples.len() as u32, 0];
    let params = context
        .device
        .create_buffer_init(&wgpu::util::BufferInitDescriptor {
            label: Some("color differential parameters"),
            contents: bytemuck::cast_slice(&params),
            usage: wgpu::BufferUsages::UNIFORM,
        });
    let module = context
        .device
        .create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some("color differential production shader"),
            source: wgpu::ShaderSource::Wgsl(DIFFERENTIAL_SHADER.into()),
        });
    let pipeline = context
        .device
        .create_compute_pipeline(&wgpu::ComputePipelineDescriptor {
            label: Some("color differential pipeline"),
            layout: None,
            module: &module,
            entry_point: Some("main"),
            compilation_options: wgpu::PipelineCompilationOptions::default(),
            cache: None,
        });
    let bind_group = context
        .device
        .create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some("color differential bindings"),
            layout: &pipeline.get_bind_group_layout(0),
            entries: &[
                wgpu::BindGroupEntry {
                    binding: 0,
                    resource: source.as_entire_binding(),
                },
                wgpu::BindGroupEntry {
                    binding: 1,
                    resource: destination.as_entire_binding(),
                },
                wgpu::BindGroupEntry {
                    binding: 2,
                    resource: params.as_entire_binding(),
                },
            ],
        });
    let pipeline_init_ms = pipeline_started.elapsed().as_secs_f64() * 1_000.0;
    let execution_started = Instant::now();
    let mut encoder = context
        .device
        .create_command_encoder(&wgpu::CommandEncoderDescriptor {
            label: Some("color differential encoder"),
        });
    {
        let mut pass = encoder.begin_compute_pass(&wgpu::ComputePassDescriptor {
            label: Some("color differential pass"),
            timestamp_writes: None,
        });
        pass.set_pipeline(&pipeline);
        pass.set_bind_group(0, &bind_group, &[]);
        pass.dispatch_workgroups(samples.len().div_ceil(64) as u32, 1, 1);
    }
    context.queue.submit(Some(encoder.finish()));
    let bytes = read_buffer(&context.device, &context.queue, &destination, output_size)?;
    let output = bytemuck::cast_slice::<u8, [f32; 4]>(&bytes).to_vec();
    Ok(GpuBufferRun {
        output,
        buffer: destination,
        pipeline_init_ms,
        execution_and_readback_ms: execution_started.elapsed().as_secs_f64() * 1_000.0,
    })
}

fn run_texture_storage(
    context: &HardwareContext,
    source: &wgpu::Buffer,
    sample_count: usize,
    kind: StorageKind,
) -> Result<(Vec<[f32; 4]>, f64, f64), String> {
    let pipeline_started = Instant::now();
    let (format, shader, bytes_per_pixel) = match kind {
        StorageKind::Rgba16Float => (wgpu::TextureFormat::Rgba16Float, TEXTURE_SHADER_16, 8),
        StorageKind::Rgba32Float => (wgpu::TextureFormat::Rgba32Float, TEXTURE_SHADER_32, 16),
        StorageKind::Buffer32 => return Err("buffer32_is_not_a_texture_storage_kind".to_string()),
    };
    let texture = context.device.create_texture(&wgpu::TextureDescriptor {
        label: Some("color differential format texture"),
        size: wgpu::Extent3d {
            width: sample_count as u32,
            height: 1,
            depth_or_array_layers: 1,
        },
        mip_level_count: 1,
        sample_count: 1,
        dimension: wgpu::TextureDimension::D2,
        format,
        usage: wgpu::TextureUsages::STORAGE_BINDING | wgpu::TextureUsages::COPY_SRC,
        view_formats: &[],
    });
    let module = context
        .device
        .create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some("color differential storage shader"),
            source: wgpu::ShaderSource::Wgsl(shader.into()),
        });
    let pipeline = context
        .device
        .create_compute_pipeline(&wgpu::ComputePipelineDescriptor {
            label: Some("color differential storage pipeline"),
            layout: None,
            module: &module,
            entry_point: Some("main"),
            compilation_options: wgpu::PipelineCompilationOptions::default(),
            cache: None,
        });
    let bind_group = context
        .device
        .create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some("color differential storage bindings"),
            layout: &pipeline.get_bind_group_layout(0),
            entries: &[
                wgpu::BindGroupEntry {
                    binding: 0,
                    resource: source.as_entire_binding(),
                },
                wgpu::BindGroupEntry {
                    binding: 1,
                    resource: wgpu::BindingResource::TextureView(
                        &texture.create_view(&wgpu::TextureViewDescriptor::default()),
                    ),
                },
            ],
        });
    let pipeline_init_ms = pipeline_started.elapsed().as_secs_f64() * 1_000.0;
    let execution_started = Instant::now();
    let mut encoder = context
        .device
        .create_command_encoder(&wgpu::CommandEncoderDescriptor {
            label: Some("color differential storage encoder"),
        });
    {
        let mut pass = encoder.begin_compute_pass(&wgpu::ComputePassDescriptor {
            label: Some("color differential storage pass"),
            timestamp_writes: None,
        });
        pass.set_pipeline(&pipeline);
        pass.set_bind_group(0, &bind_group, &[]);
        pass.dispatch_workgroups(sample_count.div_ceil(64) as u32, 1, 1);
    }
    context.queue.submit(Some(encoder.finish()));
    let bytes = crate::gpu_readback::read_texture_data_roi_with_bytes_per_pixel(
        &context.device,
        &context.queue,
        &texture,
        wgpu::Origin3d::ZERO,
        wgpu::Extent3d {
            width: sample_count as u32,
            height: 1,
            depth_or_array_layers: 1,
        },
        bytes_per_pixel,
    )?;
    let output = match kind {
        StorageKind::Rgba16Float => bytes
            .chunks_exact(8)
            .map(|pixel| {
                std::array::from_fn(|channel| {
                    f16::from_bits(u16::from_le_bytes([
                        pixel[channel * 2],
                        pixel[channel * 2 + 1],
                    ]))
                    .to_f32()
                })
            })
            .collect(),
        StorageKind::Rgba32Float => bytes
            .chunks_exact(16)
            .map(|pixel| {
                std::array::from_fn(|channel| {
                    f32::from_le_bytes(pixel[channel * 4..channel * 4 + 4].try_into().unwrap())
                })
            })
            .collect(),
        StorageKind::Buffer32 => unreachable!(),
    };
    Ok((
        output,
        pipeline_init_ms,
        execution_started.elapsed().as_secs_f64() * 1_000.0,
    ))
}

fn read_buffer(
    device: &wgpu::Device,
    queue: &wgpu::Queue,
    source: &wgpu::Buffer,
    size: u64,
) -> Result<Vec<u8>, String> {
    let staging = device.create_buffer(&wgpu::BufferDescriptor {
        label: Some("color differential staging"),
        size,
        usage: wgpu::BufferUsages::COPY_DST | wgpu::BufferUsages::MAP_READ,
        mapped_at_creation: false,
    });
    let mut encoder = device.create_command_encoder(&wgpu::CommandEncoderDescriptor {
        label: Some("color differential readback encoder"),
    });
    encoder.copy_buffer_to_buffer(source, 0, &staging, 0, size);
    queue.submit(Some(encoder.finish()));
    let slice = staging.slice(..);
    let (sender, receiver) = mpsc::channel();
    slice.map_async(wgpu::MapMode::Read, move |result| {
        let _ = sender.send(result);
    });
    device
        .poll(wgpu::PollType::Wait {
            submission_index: None,
            timeout: Some(std::time::Duration::from_secs(60)),
        })
        .map_err(|error| error.to_string())?;
    receiver
        .recv()
        .map_err(|error| error.to_string())?
        .map_err(|error| error.to_string())?;
    let bytes = slice.get_mapped_range().to_vec();
    staging.unmap();
    Ok(bytes)
}

fn max_abs_error(actual: &[[f32; 4]], expected: &[[f64; 4]]) -> Result<f64, String> {
    if actual.len() != expected.len() {
        return Err(format!(
            "color_backend_length_mismatch:{}:{}",
            actual.len(),
            expected.len()
        ));
    }
    actual
        .iter()
        .zip(expected)
        .flat_map(|(actual, expected)| actual.iter().zip(expected))
        .try_fold(0.0_f64, |maximum, (&actual, &expected)| {
            if !actual.is_finite() || !expected.is_finite() {
                Err("color_backend_non_finite_output".to_string())
            } else {
                Ok(maximum.max((actual as f64 - expected).abs()))
            }
        })
}

fn tolerance(operation: Operation, storage: StorageKind) -> f64 {
    match (operation, storage) {
        (Operation::Identity, StorageKind::Buffer32) => 1.0e-7,
        (Operation::SrgbEncode, StorageKind::Buffer32) => 3.0e-6,
        (Operation::PqInverseEotf, StorageKind::Buffer32) => 2.0e-5,
        (Operation::HlgOetf, StorageKind::Buffer32) => 3.0e-6,
        (Operation::DcpHueSatMap, StorageKind::Buffer32) => 3.0e-5,
        // The coordinate hash intentionally amplifies f32 rounding into visible
        // stochastic variation. This bound covers two f32 rounding steps while
        // the injected tile-local-coordinate defect below remains mandatory.
        (Operation::Grain, StorageKind::Buffer32) => 1.6e-4,
        (
            Operation::ToneCurve
            | Operation::Levels
            | Operation::ColorGrading
            | Operation::MaskNormal
            | Operation::MaskMultiply
            | Operation::MaskScreen
            | Operation::HslRanges
            | Operation::ClippingOverlay
            | Operation::AgxToneMap
            | Operation::Halation
            | Operation::LutTetrahedral
            | Operation::WhiteBalance
            | Operation::LocalContrast
            | Operation::Glow
            | Operation::Flare
            | Operation::ColorCalibration
            | Operation::FilmicBrightness
            | Operation::Vignette,
            StorageKind::Buffer32,
        ) => 8.0e-5,
        (Operation::DcpHueSatMap, StorageKind::Rgba16Float) => 2.0e-2,
        (Operation::Halation, StorageKind::Rgba16Float) => 4.0e-3,
        (_, StorageKind::Rgba16Float) => 2.1e-3,
        (Operation::DcpHueSatMap, StorageKind::Rgba32Float) => 8.0e-5,
        (Operation::Grain, StorageKind::Rgba32Float) => 8.0e-5,
        (_, StorageKind::Rgba32Float) => 3.0e-5,
    }
}

fn enforce_tolerance(
    operation: Operation,
    storage: StorageKind,
    actual: &[[f32; 4]],
    expected: &[[f64; 4]],
) -> Result<f64, String> {
    let error = max_abs_error(actual, expected)?;
    let budget = tolerance(operation, storage);
    if error > budget {
        Err(format!(
            "color_backend_excess_error:{operation:?}:{}:{error:.9}>{budget:.9}",
            storage.label()
        ))
    } else {
        Ok(error)
    }
}

fn supports_storage(adapter: &wgpu::Adapter, format: wgpu::TextureFormat) -> bool {
    adapter
        .get_texture_format_features(format)
        .allowed_usages
        .contains(wgpu::TextureUsages::STORAGE_BINDING | wgpu::TextureUsages::COPY_SRC)
}

fn write_proof(report: &BackendProofReport) -> Result<(), String> {
    let Ok(path) = std::env::var(PROOF_PATH_ENV) else {
        return Ok(());
    };
    let path = std::path::PathBuf::from(path);
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    let json = serde_json::to_string_pretty(report).map_err(|error| error.to_string())?;
    std::fs::write(path, format!("{json}\n")).map_err(|error| error.to_string())
}

#[test]
fn native_cpu_wgpu_backend_differential_matches_independent_f64_oracle() {
    let context = match hardware_context() {
        Ok(context) => context,
        Err(error) if error.starts_with("color_backend_adapter_unavailable:") => {
            eprintln!("explicit capability fallback: {error}");
            return;
        }
        Err(error) => panic!("GPU capability initialization must fail safe: {error}"),
    };
    let supports_16f = supports_storage(&context.adapter, wgpu::TextureFormat::Rgba16Float);
    let supports_32f = supports_storage(&context.adapter, wgpu::TextureFormat::Rgba32Float);
    let mut pipeline_init_ms = 0.0;
    let mut execution_and_readback_ms = 0.0;
    let mut cpu_reference_ms = 0.0;
    let mut stages = Vec::new();
    for operation in Operation::ALL {
        let samples = operation.vectors();
        let cpu_started = Instant::now();
        let expected = oracle(operation, &samples).expect("independent oracle must accept vectors");
        let cpu = production_cpu(operation, &samples);
        cpu_reference_ms += cpu_started.elapsed().as_secs_f64() * 1_000.0;
        let cpu_error = enforce_tolerance(operation, StorageKind::Buffer32, &cpu, &expected)
            .expect("production CPU must remain within its stage budget");
        let gpu_run = run_gpu_buffer(&context, operation, 0, &samples)
            .expect("WGPU production kernel must execute and read back");
        pipeline_init_ms += gpu_run.pipeline_init_ms;
        execution_and_readback_ms += gpu_run.execution_and_readback_ms;
        let gpu_error =
            enforce_tolerance(operation, StorageKind::Buffer32, &gpu_run.output, &expected)
                .expect("WGPU buffer output must remain within its stage budget");
        let rgba16f_error = supports_16f.then(|| {
            let (output, storage_pipeline_ms, storage_execution_ms) = run_texture_storage(
                &context,
                &gpu_run.buffer,
                samples.len(),
                StorageKind::Rgba16Float,
            )
            .expect("supported RGBA16F storage must execute");
            pipeline_init_ms += storage_pipeline_ms;
            execution_and_readback_ms += storage_execution_ms;
            enforce_tolerance(operation, StorageKind::Rgba16Float, &output, &expected)
                .expect("RGBA16F output must remain within its storage budget")
        });
        let rgba32f_error = supports_32f.then(|| {
            let (output, storage_pipeline_ms, storage_execution_ms) = run_texture_storage(
                &context,
                &gpu_run.buffer,
                samples.len(),
                StorageKind::Rgba32Float,
            )
            .expect("supported RGBA32F storage must execute");
            pipeline_init_ms += storage_pipeline_ms;
            execution_and_readback_ms += storage_execution_ms;
            enforce_tolerance(operation, StorageKind::Rgba32Float, &output, &expected)
                .expect("RGBA32F output must remain within its storage budget")
        });
        stages.push(StageReport {
            operation,
            input_domain: operation.input_domain(),
            output_domain: operation.output_domain(),
            reference_contract: if matches!(
                operation,
                Operation::ToneCurve
                    | Operation::Levels
                    | Operation::ColorGrading
                    | Operation::HslRanges
                    | Operation::MaskNormal
                    | Operation::MaskMultiply
                    | Operation::MaskScreen
                    | Operation::ClippingOverlay
                    | Operation::AgxToneMap
                    | Operation::Halation
                    | Operation::LutTetrahedral
                    | Operation::WhiteBalance
                    | Operation::LocalContrast
                    | Operation::Glow
                    | Operation::Flare
                    | Operation::ColorCalibration
                    | Operation::FilmicBrightness
                    | Operation::Vignette
                    | Operation::Grain
            ) {
                ARTISTIC_REFERENCE_CONTRACT_ID
            } else {
                rapidraw_color_reference::REFERENCE_CONTRACT_ID
            },
            buffer32_tolerance: tolerance(operation, StorageKind::Buffer32),
            cpu_max_abs_error: cpu_error,
            gpu_buffer_max_abs_error: gpu_error,
            rgba16f_max_abs_error: rgba16f_error,
            rgba32f_max_abs_error: rgba32f_error,
            sample_count: samples.len(),
        });
    }

    let defect_samples = Operation::Identity.vectors();
    let defect_expected = oracle(Operation::Identity, &defect_samples).unwrap();
    let clamped = run_gpu_buffer(&context, Operation::Identity, 1, &defect_samples).unwrap();
    pipeline_init_ms += clamped.pipeline_init_ms;
    execution_and_readback_ms += clamped.execution_and_readback_ms;
    let injected_clamp_detected = enforce_tolerance(
        Operation::Identity,
        StorageKind::Buffer32,
        &clamped.output,
        &defect_expected,
    )
    .is_err();
    assert!(
        injected_clamp_detected,
        "injected premature shader clamp must be detected"
    );
    let swapped = run_gpu_buffer(&context, Operation::Identity, 2, &defect_samples).unwrap();
    pipeline_init_ms += swapped.pipeline_init_ms;
    execution_and_readback_ms += swapped.execution_and_readback_ms;
    let injected_channel_swap_detected = enforce_tolerance(
        Operation::Identity,
        StorageKind::Buffer32,
        &swapped.output,
        &defect_expected,
    )
    .is_err();
    assert!(
        injected_channel_swap_detected,
        "injected shader channel defect must be detected"
    );
    let artistic_operations = [
        Operation::ToneCurve,
        Operation::Levels,
        Operation::HslRanges,
        Operation::ColorGrading,
        Operation::MaskNormal,
        Operation::MaskMultiply,
        Operation::MaskScreen,
        Operation::ClippingOverlay,
        Operation::AgxToneMap,
        Operation::Halation,
        Operation::LutTetrahedral,
        Operation::WhiteBalance,
        Operation::LocalContrast,
        Operation::Glow,
        Operation::Flare,
        Operation::ColorCalibration,
        Operation::FilmicBrightness,
        Operation::Vignette,
        Operation::Grain,
    ];
    let mut injected_artistic_channel_swap_count = 0;
    for operation in artistic_operations {
        let samples = operation.vectors();
        let expected = oracle(operation, &samples).unwrap();
        let injected = run_gpu_buffer(&context, operation, 2, &samples).unwrap();
        pipeline_init_ms += injected.pipeline_init_ms;
        execution_and_readback_ms += injected.execution_and_readback_ms;
        let detected = enforce_tolerance(
            operation,
            StorageKind::Buffer32,
            &injected.output,
            &expected,
        )
        .is_err();
        assert!(
            detected,
            "{operation:?} must detect an injected shader channel swap"
        );
        injected_artistic_channel_swap_count += usize::from(detected);
    }

    let grain_samples = Operation::Grain.vectors();
    let grain_expected = oracle(Operation::Grain, &grain_samples).unwrap();
    let tile_local_grain = run_gpu_buffer(&context, Operation::Grain, 3, &grain_samples).unwrap();
    pipeline_init_ms += tile_local_grain.pipeline_init_ms;
    execution_and_readback_ms += tile_local_grain.execution_and_readback_ms;
    let injected_tile_local_grain_detected = enforce_tolerance(
        Operation::Grain,
        StorageKind::Buffer32,
        &tile_local_grain.output,
        &grain_expected,
    )
    .is_err();
    assert!(
        injected_tile_local_grain_detected,
        "injected tile-local grain coordinate reset must be detected"
    );

    let info = context.adapter.get_info();
    let report = BackendProofReport {
        contract: "rapidraw.color-backend-differential.v1",
        adapter_name: info.name,
        backend: format!("{:?}", info.backend),
        driver: if info.driver.is_empty() {
            "not_surfaced_by_wgpu_backend".to_string()
        } else {
            info.driver
        },
        driver_info: if info.driver_info.is_empty() {
            "not_surfaced_by_wgpu_backend".to_string()
        } else {
            info.driver_info
        },
        vendor: info.vendor,
        device: info.device,
        device_type: format!("{:?}", info.device_type),
        os: sysinfo::System::long_os_version().unwrap_or_else(|| std::env::consts::OS.to_string()),
        architecture: std::env::consts::ARCH,
        formats: vec![
            FormatCapability {
                format: "rgba16float",
                storage_write_and_copy_src: supports_16f,
                disposition: if supports_16f {
                    "validated"
                } else {
                    "explicit_capability_fallback"
                },
            },
            FormatCapability {
                format: "rgba32float",
                storage_write_and_copy_src: supports_32f,
                disposition: if supports_32f {
                    "validated"
                } else {
                    "explicit_capability_fallback"
                },
            },
        ],
        stages,
        injected_clamp_detected,
        injected_channel_swap_detected,
        injected_artistic_channel_swap_count,
        injected_tile_local_grain_detected,
        timings: TimingReport {
            adapter_init_ms: context.adapter_init_ms,
            pipeline_init_ms,
            execution_and_readback_ms,
            cpu_reference_ms,
        },
    };
    assert!(!report.adapter_name.is_empty());
    assert!(!report.os.is_empty());
    assert!(report.stages.iter().all(|stage| stage.sample_count >= 3));
    if let Ok(directory) = std::env::var("RAWENGINE_COLOR_VISUAL_APPROVAL_DIR") {
        let numeric_report = format!(
            "{}\n",
            serde_json::to_string_pretty(&report).expect("numeric report must encode")
        )
        .into_bytes();
        let hardware_identity = serde_json::to_vec(&(
            &report.adapter_name,
            &report.backend,
            &report.driver,
            &report.driver_info,
            report.vendor,
            report.device,
            &report.device_type,
            &report.os,
            report.architecture,
        ))
        .expect("hardware identity must encode");
        let commit_identity = std::env::var("GITHUB_SHA").unwrap_or_else(|_| {
            std::process::Command::new("git")
                .args(["rev-parse", "HEAD"])
                .output()
                .ok()
                .filter(|output| output.status.success())
                .and_then(|output| String::from_utf8(output.stdout).ok())
                .map(|value| value.trim().to_string())
                .unwrap_or_else(|| "commit-unavailable".to_string())
        });
        generate_visual_approval_bundle(
            std::path::Path::new(&directory),
            ApprovalBindings {
                source_hash: hash_bytes(b"deterministic-synthetic-alaska-landscape-no-people-v1"),
                graph_hash: hash_bytes(b"rapidraw-color-backend-differential-24-stage-graph-v1"),
                profile_hash: hash_bytes(b"controlled-display-p3-and-rec2020-profile-set-v1"),
                output_identity_hash: hash_bytes(b"paired-sdr-hdr-preview-export-readback-v1"),
                hardware_hash: hash_bytes(&hardware_identity),
                commit_hash: hash_bytes(commit_identity.as_bytes()),
                numeric_report_hash: hash_bytes(&numeric_report),
            },
        )
        .expect("visual approval artifacts must bind to numeric proof");
    }
    write_proof(&report).expect("optional hardware proof must be writable");
}

#[test]
fn tolerance_gate_rejects_non_finite_and_excess_error_without_rebaselining() {
    let expected = vec![[0.0, 0.25, 1.5, 1.0]];
    assert!(
        enforce_tolerance(
            Operation::Identity,
            StorageKind::Buffer32,
            &[[0.0, 0.25, 1.4, 1.0]],
            &expected,
        )
        .unwrap_err()
        .starts_with("color_backend_excess_error:")
    );
    assert_eq!(
        max_abs_error(&[[f32::NAN, 0.25, 1.5, 1.0]], &expected).unwrap_err(),
        "color_backend_non_finite_output"
    );
}
