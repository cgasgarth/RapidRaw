struct Point {
    x: f32,
    y: f32,
    _pad1: f32,
    _pad2: f32,
}

struct HslColor {
    hue: f32,
    saturation: f32,
    luminance: f32,
    _pad: f32,
}

struct ColorGradeSettings {
    hue: f32,
    saturation: f32,
    luminance: f32,
    _pad: f32,
}

struct ColorCalibrationSettings {
    shadows_tint: f32,
    red_hue: f32,
    red_saturation: f32,
    green_hue: f32,
    green_saturation: f32,
    blue_hue: f32,
    blue_saturation: f32,
    _pad1: f32,
}

struct ChannelMixerRow {
    red: f32,
    green: f32,
    blue: f32,
    constant: f32,
}

struct ChannelMixerSettings {
    red: ChannelMixerRow,
    green: ChannelMixerRow,
    blue: ChannelMixerRow,
    enabled: u32,
    preserve_luminance: u32,
    _pad1: u32,
    _pad2: u32,
}

struct LevelsSettings {
    input_black: f32,
    input_white: f32,
    gamma: f32,
    output_black: f32,
    output_white: f32,
    enabled: u32,
    _pad1: u32,
    _pad2: u32,
}

struct ColorBalanceRgbSettings {
    shadows: vec4<f32>,
    midtones: vec4<f32>,
    highlights: vec4<f32>,
    enabled: u32,
    preserve_luminance: u32,
    _pad1: u32,
    _pad2: u32,
}

struct BlackWhiteMixerSettings {
    reds: f32,
    oranges: f32,
    yellows: f32,
    greens: f32,
    aquas: f32,
    blues: f32,
    purples: f32,
    magentas: f32,
    enabled: u32,
    process: u32,
    implementation_version: u32,
    _pad3: u32,
}

struct ToneEqualizerGpuSettings {
    bands0: vec4<f32>,
    bands1: vec4<f32>,
    bands2: vec4<f32>,
    params0: vec4<f32>,
    params1: vec4<f32>,
}

struct PointColorGpuPoint {
    samples: array<vec4<f32>, 4>,
    range: vec4<f32>,
    edit: vec4<f32>,
    control: vec4<f32>,
}

struct PointColorGpuSettings {
    points: array<PointColorGpuPoint, 8>,
    control: vec4<u32>,
    skin_range: PointColorGpuPoint,
    skin_target: vec4<f32>,
    skin_control: vec4<f32>,
}

struct GlobalAdjustments {
    exposure: f32,
    brightness: f32,
    contrast: f32,
    highlights: f32,
    shadows: f32,
    whites: f32,
    blacks: f32,
    saturation: f32,
    temperature: f32,
    tint: f32,
    vibrance: f32,
    hue: f32,
    edit_graph_version: f32,
    dehaze_atmosphere_r: f32,
    dehaze_atmosphere_g: f32,
    dehaze_atmosphere_b: f32,
    technical_white_balance: mat3x3<f32>,

    sharpness: f32,
    luma_noise_reduction: f32,
    color_noise_reduction: f32,
    clarity: f32,
    dehaze: f32,
    structure: f32,
    centre: f32,
    vignette_amount: f32,
    vignette_midpoint: f32,
    vignette_roundness: f32,
    vignette_feather: f32,
    grain_amount: f32,
    grain_size: f32,
    grain_roughness: f32,

    chromatic_aberration_red_cyan: f32,
    chromatic_aberration_blue_yellow: f32,
    show_clipping: u32,
    is_raw_image: u32,
    dehaze_atmosphere_confidence: f32,

    has_lut: u32,
    lut_intensity: f32,
    tonemapper_mode: u32,
    _pad_lut2: f32,
    _pad_lut3: f32,
    _pad_lut4: f32,
    _pad_lut5: f32,

    _pad_agx1: f32,
    _pad_agx2: f32,
    _pad_agx3: f32,
    agx_pipe_to_rendering_matrix: mat3x3<f32>,
    agx_rendering_to_pipe_matrix: mat3x3<f32>,
    rapid_view_parameters0: vec4<f32>,
    rapid_view_parameters1: vec4<f32>,
    rapid_view_parameters2: vec4<f32>,

    _pad_cg1: f32,
    _pad_cg2: f32,
    _pad_cg3: f32,
    _pad_cg4: f32,
    color_grading_shadows: ColorGradeSettings,
    color_grading_midtones: ColorGradeSettings,
    color_grading_highlights: ColorGradeSettings,
    color_grading_global: ColorGradeSettings,
    color_grading_blending: f32,
    color_grading_balance: f32,
    _pad2: f32,
    _pad3: f32,

    color_calibration: ColorCalibrationSettings,
    color_balance_rgb: ColorBalanceRgbSettings,
    channel_mixer: ChannelMixerSettings,
    black_white_mixer: BlackWhiteMixerSettings,
    levels: LevelsSettings,

    hsl: array<HslColor, 8>,
    luma_curve: array<Point, 16>,
    red_curve: array<Point, 16>,
    green_curve: array<Point, 16>,
    blue_curve: array<Point, 16>,
    luma_curve_count: u32,
    red_curve_count: u32,
    green_curve_count: u32,
    blue_curve_count: u32,
    _pad_end1: f32,
    _pad_end2: f32,
    _pad_end3: f32,
    _pad_end4: f32,

    glow_amount: f32,
    halation_amount: f32,
    flare_amount: f32,
    sharpness_threshold: f32,
    tone_equalizer: ToneEqualizerGpuSettings,
    point_color: PointColorGpuSettings,
}

struct MaskAdjustments {
    exposure: f32,
    brightness: f32,
    contrast: f32,
    highlights: f32,
    shadows: f32,
    whites: f32,
    blacks: f32,
    saturation: f32,
    temperature: f32,
    tint: f32,
    vibrance: f32,

    sharpness: f32,
    luma_noise_reduction: f32,
    color_noise_reduction: f32,
    clarity: f32,
    dehaze: f32,
    structure: f32,

    glow_amount: f32,
    halation_amount: f32,
    flare_amount: f32,
    sharpness_threshold: f32,

    hue: f32,
    blend_mode: f32,
    _pad_cg2: f32,
    color_grading_shadows: ColorGradeSettings,
    color_grading_midtones: ColorGradeSettings,
    color_grading_highlights: ColorGradeSettings,
    color_grading_global: ColorGradeSettings,
    color_grading_blending: f32,
    color_grading_balance: f32,
    _pad5: f32,
    _pad6: f32,

    hsl: array<HslColor, 8>,
    luma_curve: array<Point, 16>,
    red_curve: array<Point, 16>,
    green_curve: array<Point, 16>,
    blue_curve: array<Point, 16>,
    luma_curve_count: u32,
    red_curve_count: u32,
    green_curve_count: u32,
    blue_curve_count: u32,
    _pad_end4: f32,
    _pad_end5: f32,
    _pad_end6: f32,
    _pad_end7: f32,
    tone_equalizer: ToneEqualizerGpuSettings,
    point_color: PointColorGpuSettings,
}

struct AllAdjustments {
    global: GlobalAdjustments,
    mask_adjustments: array<MaskAdjustments, 32>,
    mask_count: u32,
    tile_offset_x: u32,
    tile_offset_y: u32,
    mask_atlas_cols: u32,
    blur_pass_flags: u32,
    execution_phase: u32,
    source_width: u32,
    source_height: u32,
}

struct HslRange {
    center: f32,
    width: f32,
}

const HSL_RANGES: array<HslRange, 8> = array<HslRange, 8>(
    HslRange(358.0, 35.0),  // Red
    HslRange(25.0, 45.0),   // Orange
    HslRange(60.0, 40.0),   // Yellow
    HslRange(115.0, 90.0),  // Green
    HslRange(180.0, 60.0),  // Aqua
    HslRange(225.0, 60.0),  // Blue
    HslRange(280.0, 55.0),  // Purple
    HslRange(330.0, 50.0)   // Magenta
);

const BLACK_WHITE_MIXER_RANGE_CENTERS: array<f32, 8> = array<f32, 8>(
    358.0,
    25.0,
    60.0,
    115.0,
    180.0,
    225.0,
    280.0,
    330.0,
);

fn blend_mask_layer(base: vec3<f32>, layer: vec3<f32>, influence: f32, blend_mode: f32) -> vec3<f32> {
    var blended = layer;
    if (blend_mode > 0.5 && blend_mode < 1.5) {
        blended = base * layer;
    } else if (blend_mode > 1.5 && blend_mode < 2.5) {
        blended = 1.0 - (1.0 - base) * (1.0 - layer);
    }
    return mix(base, blended, influence);
}

const BLACK_WHITE_MIXER_RANGE_WIDTHS: array<f32, 8> = array<f32, 8>(
    35.0,
    45.0,
    40.0,
    90.0,
    60.0,
    60.0,
    55.0,
    50.0,
);

@group(0) @binding(0) var input_texture: texture_2d<f32>;
@group(0) @binding(1) var output_texture: texture_storage_2d<rgba16float, write>;
@group(0) @binding(2) var<storage, read> adjustments: AllAdjustments;

@group(0) @binding(3) var mask_textures: texture_2d_array<f32>;

@group(0) @binding(4) var lut_texture: texture_3d<f32>;
@group(0) @binding(5) var lut_sampler: sampler;

@group(0) @binding(6) var sharpness_blur_texture: texture_2d<f32>;
@group(0) @binding(7) var tonal_blur_texture: texture_2d<f32>;
@group(0) @binding(8) var clarity_blur_texture: texture_2d<f32>;
@group(0) @binding(9) var structure_blur_texture: texture_2d<f32>;

@group(0) @binding(10) var flare_texture: texture_2d<f32>;
@group(0) @binding(11) var flare_sampler: sampler;

const ACESCG_LUMINANCE_COEFF = vec3<f32>(0.27222872, 0.67408174, 0.05368952);
const VIEW_ENCODED_LUMA_COEFF = vec3<f32>(0.2126, 0.7152, 0.0722);

fn scene_luminance_coefficients() -> vec3<f32> {
    return select(
        VIEW_ENCODED_LUMA_COEFF,
        ACESCG_LUMINANCE_COEFF,
        adjustments.global.edit_graph_version >= 2.0,
    );
}

fn scene_luminance(c: vec3<f32>) -> f32 {
    return dot(c, scene_luminance_coefficients());
}

fn tone_equalizer_band(bands0: vec4<f32>, bands1: vec4<f32>, bands2: vec4<f32>, index: u32) -> f32 {
    switch index {
        case 0u: { return bands0.x; }
        case 1u: { return bands0.y; }
        case 2u: { return bands0.z; }
        case 3u: { return bands0.w; }
        case 4u: { return bands1.x; }
        case 5u: { return bands1.y; }
        case 6u: { return bands1.z; }
        case 7u: { return bands1.w; }
        default: { return bands2.x; }
    }
}

fn tone_equalizer_macro_band(
    index: u32,
    brightness: f32,
    contrast: f32,
    highlights: f32,
    shadows: f32,
    whites: f32,
    blacks: f32,
) -> f32 {
    var black_weight = 0.0;
    var shadow_weight = 0.0;
    var highlight_weight = 0.0;
    var white_weight = 0.0;
    var contrast_weight = 0.0;
    var brightness_weight = 0.0;
    switch index {
        case 0u: { black_weight = 0.9; contrast_weight = -1.0; brightness_weight = 0.05; }
        case 1u: { black_weight = 0.65; shadow_weight = 0.1; contrast_weight = -0.85; brightness_weight = 0.15; }
        case 2u: { black_weight = 0.25; shadow_weight = 0.45; contrast_weight = -0.6; brightness_weight = 0.4; }
        case 3u: { black_weight = 0.05; shadow_weight = 1.0; highlight_weight = 0.1; contrast_weight = -0.3; brightness_weight = 0.8; }
        case 4u: { shadow_weight = 0.55; highlight_weight = 0.45; brightness_weight = 1.0; }
        case 5u: { shadow_weight = 0.1; highlight_weight = 1.0; white_weight = 0.05; contrast_weight = 0.3; brightness_weight = 0.8; }
        case 6u: { highlight_weight = 0.55; white_weight = 0.25; contrast_weight = 0.6; brightness_weight = 0.4; }
        case 7u: { highlight_weight = 0.1; white_weight = 0.65; contrast_weight = 0.85; brightness_weight = 0.15; }
        default: { white_weight = 0.9; contrast_weight = 1.0; brightness_weight = 0.05; }
    }
    return clamp(blacks, -1.0, 1.0) * black_weight * 2.0
        + clamp(shadows, -1.0, 1.0) * shadow_weight * 2.0
        + clamp(highlights, -1.0, 1.0) * highlight_weight * 2.0
        + clamp(whites, -1.0, 1.0) * white_weight * 2.0
        + clamp(contrast, -1.0, 1.0) * contrast_weight * 1.25
        + clamp(brightness, -5.0, 5.0) * brightness_weight;
}

fn tone_equalizer_compensation(
    exposure_ev: f32,
    bands0: vec4<f32>,
    bands1: vec4<f32>,
    bands2: vec4<f32>,
    params0: vec4<f32>,
    params1: vec4<f32>,
    brightness: f32,
    contrast: f32,
    highlights: f32,
    shadows: f32,
    whites: f32,
    blacks: f32,
) -> f32 {
    let pivot = params0.y;
    let scale = clamp(params0.z, 4.0, 24.0) / 16.0;
    let sigma = max(2.0 * scale, 0.5);
    let bounded_ev = clamp(exposure_ev, pivot - 8.0 * scale, pivot + 8.0 * scale);
    var weighted = 0.0;
    var total = 0.0;
    for (var index = 0u; index < 9u; index = index + 1u) {
        let center = pivot + (-8.0 + f32(index) * 2.0) * scale;
        let distance = (bounded_ev - center) / sigma;
        let weight = exp(-0.5 * distance * distance);
        let advanced = select(0.0, tone_equalizer_band(bands0, bands1, bands2, index), params0.x > 0.5);
        let macro_band = tone_equalizer_macro_band(index, brightness, contrast, highlights, shadows, whites, blacks);
        weighted += clamp(advanced + macro_band, -4.0, 4.0) * weight;
        total += weight;
    }
    return select(0.0, weighted / total, total > 0.0) + clamp(params1.z, -4.0, 4.0);
}

fn tone_equalizer_band_weight(exposure_ev: f32, selected_band: u32, params0: vec4<f32>) -> f32 {
    let pivot = params0.y;
    let scale = clamp(params0.z, 4.0, 24.0) / 16.0;
    let sigma = max(2.0 * scale, 0.5);
    let bounded_ev = clamp(exposure_ev, pivot - 8.0 * scale, pivot + 8.0 * scale);
    var selected_weight = 0.0;
    var total = 0.0;
    for (var index = 0u; index < 9u; index = index + 1u) {
        let center = pivot + (-8.0 + f32(index) * 2.0) * scale;
        let distance = (bounded_ev - center) / sigma;
        let weight = exp(-0.5 * distance * distance);
        if (index == min(selected_band, 8u)) { selected_weight = weight; }
        total += weight;
    }
    return select(0.0, selected_weight / total, total > 0.0);
}

fn apply_tone_equalizer(
    color: vec3<f32>,
    coordinate_color: vec3<f32>,
    smoothed_color: vec3<f32>,
    bands0: vec4<f32>,
    bands1: vec4<f32>,
    bands2: vec4<f32>,
    params0: vec4<f32>,
    params1: vec4<f32>,
    brightness: f32,
    contrast: f32,
    highlights: f32,
    shadows: f32,
    whites: f32,
    blacks: f32,
) -> vec3<f32> {
    let luminance = scene_luminance(coordinate_color);
    if (luminance <= 1.0e-8) { return color; }
    let middle_grey = max(adjustments.global.rapid_view_parameters0.x, 1.0e-8);
    let source_ev = log2(max(luminance, 1.0e-8) / middle_grey);
    let smoothed_ev = log2(max(scene_luminance(smoothed_color), 1.0e-8) / middle_grey);
    let edge_delta = abs(source_ev - smoothed_ev);
    let edge_weight = 1.0 - exp(-edge_delta * clamp(params1.x, 0.0, 8.0));
    let detail = clamp(params0.w, 0.0, 1.0);
    let source_weight = detail + edge_weight * (1.0 - detail);
    let guidance_ev = mix(smoothed_ev, source_ev, source_weight);
    let compensation = tone_equalizer_compensation(
        guidance_ev, bands0, bands1, bands2, params0, params1,
        brightness, contrast, highlights, shadows, whites, blacks,
    );
    return color * exp2(compensation);
}

fn tone_equalizer_false_color(exposure_ev: f32, pivot_ev: f32, range_ev: f32) -> vec3<f32> {
    let normalized = clamp((exposure_ev - pivot_ev) / max(range_ev, 4.0) + 0.5, 0.0, 1.0);
    let cold = vec3<f32>(0.05, 0.2, 1.0);
    let middle = vec3<f32>(0.1, 0.9, 0.25);
    let warm = vec3<f32>(1.0, 0.15, 0.03);
    return select(
        mix(cold, middle, normalized * 2.0),
        mix(middle, warm, (normalized - 0.5) * 2.0),
        normalized >= 0.5,
    );
}

fn view_encoded_luma(c: vec3<f32>) -> f32 {
    return dot(c, VIEW_ENCODED_LUMA_COEFF);
}

fn srgb_to_linear(c: vec3<f32>) -> vec3<f32> {
    let cutoff = vec3<f32>(0.04045);
    let a = vec3<f32>(0.055);
    let higher = pow((c + a) / (1.0 + a), vec3<f32>(2.4));
    let lower = c / 12.92;
    return select(higher, lower, c <= cutoff);
}

fn linear_to_srgb(c: vec3<f32>) -> vec3<f32> {
    let c_clamped = clamp(c, vec3<f32>(0.0), vec3<f32>(1.0));
    let cutoff = vec3<f32>(0.0031308);
    let a = vec3<f32>(0.055);
    let higher = (1.0 + a) * pow(c_clamped, vec3<f32>(1.0 / 2.4)) - a;
    let lower = c_clamped * 12.92;
    return select(higher, lower, c_clamped <= cutoff);
}

fn linear_to_srgb_extended(c: vec3<f32>) -> vec3<f32> {
    let magnitude = abs(c);
    let cutoff = vec3<f32>(0.0031308);
    let a = vec3<f32>(0.055);
    let higher = (1.0 + a) * pow(magnitude, vec3<f32>(1.0 / 2.4)) - a;
    let lower = magnitude * 12.92;
    return sign(c) * select(higher, lower, magnitude <= cutoff);
}

fn rgb_to_hsv(c: vec3<f32>) -> vec3<f32> {
    let c_max = max(c.r, max(c.g, c.b));
    let c_min = min(c.r, min(c.g, c.b));
    let delta = c_max - c_min;
    var h: f32 = 0.0;
    if (delta > 0.0) {
        if (c_max == c.r) { h = 60.0 * (((c.g - c.b) / delta) % 6.0); }
        else if (c_max == c.g) { h = 60.0 * (((c.b - c.r) / delta) + 2.0); }
        else { h = 60.0 * (((c.r - c.g) / delta) + 4.0); }
    }
    if (h < 0.0) { h += 360.0; }
    let s = select(0.0, delta / c_max, c_max > 0.0);
    return vec3<f32>(h, s, c_max);
}

fn hsv_to_rgb(c: vec3<f32>) -> vec3<f32> {
    let h = c.x; let s = c.y; let v = c.z;
    let C = v * s;
    let X = C * (1.0 - abs((h / 60.0) % 2.0 - 1.0));
    let m = v - C;
    var rgb_prime: vec3<f32>;
    if (h < 60.0) { rgb_prime = vec3<f32>(C, X, 0.0); }
    else if (h < 120.0) { rgb_prime = vec3<f32>(X, C, 0.0); }
    else if (h < 180.0) { rgb_prime = vec3<f32>(0.0, C, X); }
    else if (h < 240.0) { rgb_prime = vec3<f32>(0.0, X, C); }
    else if (h < 300.0) { rgb_prime = vec3<f32>(X, 0.0, C); }
    else { rgb_prime = vec3<f32>(C, 0.0, X); }
    return rgb_prime + vec3<f32>(m, m, m);
}

fn apply_hue_shift(color: vec3<f32>, shift_degrees: f32) -> vec3<f32> {
    if (abs(shift_degrees) < 0.01) {
        return color;
    }
    let srgb_color = linear_to_srgb_extended(color);
    let hsv = rgb_to_hsv(srgb_color);
    var shifted_h = hsv.x + shift_degrees;
    shifted_h = (shifted_h + 360.0) % 360.0;
    let shifted_srgb = hsv_to_rgb(vec3<f32>(shifted_h, hsv.y, hsv.z));
    return srgb_to_linear(shifted_srgb);
}

fn get_raw_hsl_influence(hue: f32, center: f32, width: f32) -> f32 {
    let dist = min(abs(hue - center), 360.0 - abs(hue - center));
    const sharpness = 1.5;
    let falloff = dist / (width * 0.5);
    return exp(-sharpness * falloff * falloff);
}

fn hash(p: vec2<f32>) -> f32 {
    var p3  = fract(vec3<f32>(p.xyx) * .1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
}

fn gradient_noise(p: vec2<f32>) -> f32 {
    let i = floor(p);
    let f = fract(p);
    let u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);

    let ga = vec2<f32>(hash(i + vec2(0.0, 0.0)), hash(i + vec2(0.0, 0.0) + vec2(11.0, 37.0))) * 2.0 - 1.0;
    let gb = vec2<f32>(hash(i + vec2(1.0, 0.0)), hash(i + vec2(1.0, 0.0) + vec2(11.0, 37.0))) * 2.0 - 1.0;
    let gc = vec2<f32>(hash(i + vec2(0.0, 1.0)), hash(i + vec2(0.0, 1.0) + vec2(11.0, 37.0))) * 2.0 - 1.0;
    let gd = vec2<f32>(hash(i + vec2(1.0, 1.0)), hash(i + vec2(1.0, 1.0) + vec2(11.0, 37.0))) * 2.0 - 1.0;

    let dot_00 = dot(ga, f - vec2(0.0, 0.0));
    let dot_10 = dot(gb, f - vec2(1.0, 0.0));
    let dot_01 = dot(gc, f - vec2(0.0, 1.0));
    let dot_11 = dot(gd, f - vec2(1.0, 1.0));

    let bottom_interp = mix(dot_00, dot_10, u.x);
    let top_interp = mix(dot_01, dot_11, u.x);

    return mix(bottom_interp, top_interp, u.y);
}

fn dither(coords: vec2<u32>) -> f32 {
    let p = vec2<f32>(coords);
    return fract(sin(dot(p, vec2<f32>(12.9898, 78.233))) * 43758.5453) - 0.5;
}

fn interpolate_cubic_hermite(x: f32, p1: Point, p2: Point, m1: f32, m2: f32) -> f32 {
    let dx = p2.x - p1.x;
    if (dx <= 0.0) { return p1.y; }
    let t = (x - p1.x) / dx;
    let t2 = t * t;
    let t3 = t2 * t;
    let h00 = 2.0 * t3 - 3.0 * t2 + 1.0;
    let h10 = t3 - 2.0 * t2 + t;
    let h01 = -2.0 * t3 + 3.0 * t2;
    let h11 = t3 - t2;
    return h00 * p1.y + h10 * m1 * dx + h01 * p2.y + h11 * m2 * dx;
}

fn apply_curve(val: f32, points: array<Point, 16>, count: u32, preserve_extended: bool) -> f32 {
    if (count < 2u) { return val; }
    var local_points = points;
    let x = val * 255.0;
    if (x <= local_points[0].x) {
        return select(local_points[0].y / 255.0, val + (local_points[0].y - local_points[0].x) / 255.0, preserve_extended);
    }
    if (x >= local_points[count - 1u].x) {
        let endpoint = local_points[count - 1u];
        return select(endpoint.y / 255.0, val + (endpoint.y - endpoint.x) / 255.0, preserve_extended);
    }
    for (var i = 0u; i < 15u; i = i + 1u) {
        if (i >= count - 1u) { break; }
        let p1 = local_points[i];
        let p2 = local_points[i + 1u];
        if (x <= p2.x) {
            let p0 = local_points[max(0u, i - 1u)];
            let p3 = local_points[min(count - 1u, i + 2u)];
            let delta_before = (p1.y - p0.y) / max(0.001, p1.x - p0.x);
            let delta_current = (p2.y - p1.y) / max(0.001, p2.x - p1.x);
            let delta_after = (p3.y - p2.y) / max(0.001, p3.x - p2.x);
            var tangent_at_p1: f32;
            var tangent_at_p2: f32;
            if (i == 0u) { tangent_at_p1 = delta_current; } else {
                if (delta_before * delta_current <= 0.0) { tangent_at_p1 = 0.0; } else { tangent_at_p1 = (delta_before + delta_current) / 2.0; }
            }
            if (i + 1u == count - 1u) { tangent_at_p2 = delta_current; } else {
                if (delta_current * delta_after <= 0.0) { tangent_at_p2 = 0.0; } else { tangent_at_p2 = (delta_current + delta_after) / 2.0; }
            }
            if (delta_current != 0.0) {
                let alpha = tangent_at_p1 / delta_current;
                let beta = tangent_at_p2 / delta_current;
                if (alpha * alpha + beta * beta > 9.0) {
                    let tau = 3.0 / sqrt(alpha * alpha + beta * beta);
                    tangent_at_p1 = tangent_at_p1 * tau;
                    tangent_at_p2 = tangent_at_p2 * tau;
                }
            }
            let result_y = interpolate_cubic_hermite(x, p1, p2, tangent_at_p1, tangent_at_p2);
            return select(clamp(result_y / 255.0, 0.0, 1.0), result_y / 255.0, preserve_extended);
        }
    }
    return local_points[count - 1u].y / 255.0;
}

fn get_shadow_mult(luma: f32, sh: f32, bl: f32) -> f32 {
    var mult = 1.0;
    let safe_luma = max(luma, 0.0001);

    if (bl != 0.0) {
        let limit = 0.05;
        if (safe_luma < limit) {
            let x = safe_luma / limit;
            let mask = (1.0 - x) * (1.0 - x);
            let factor = min(exp2(bl * 0.75), 3.9);
            mult *= mix(1.0, factor, mask);
        }
    }
    if (sh != 0.0) {
        let limit = 0.1;
        if (safe_luma < limit) {
            let x = safe_luma / limit;
            let mask = (1.0 - x) * (1.0 - x);
            let factor = min(exp2(sh * 1.5), 3.9);
            mult *= mix(1.0, factor, mask);
        }
    }
    return mult;
}

fn apply_tonal_adjustments(
    color: vec3<f32>,
    blurred_color_input_space: vec3<f32>,
    is_raw: u32,
    con: f32,
    sh: f32,
    wh: f32,
    bl: f32
) -> vec3<f32> {
    var rgb = color;

    var blurred_linear: vec3<f32>;
    if (is_raw == 1u) {
        blurred_linear = blurred_color_input_space;
    } else {
        blurred_linear = srgb_to_linear(blurred_color_input_space);
    }

    if (wh != 0.0) {
        let white_level = 1.0 - wh * 0.25;
        let w_mult = 1.0 / max(white_level, 0.01);
        rgb *= w_mult;
        blurred_linear *= w_mult;
    }

    let pixel_luma = scene_luminance(max(rgb, vec3<f32>(0.0)));
    let blurred_luma = scene_luminance(max(blurred_linear, vec3<f32>(0.0)));

    let safe_pixel_luma = max(pixel_luma, 0.0001);
    let safe_blurred_luma = max(blurred_luma, 0.0001);

    let perc_pixel = pow(safe_pixel_luma, 0.5);
    let perc_blurred = pow(safe_blurred_luma, 0.5);
    let edge_diff = abs(perc_pixel - perc_blurred);
    let halo_protection = smoothstep(0.05, 0.25, edge_diff);

    if (sh != 0.0 || bl != 0.0) {
        let spatial_mult = get_shadow_mult(safe_blurred_luma, sh, bl);
        let pixel_mult   = get_shadow_mult(safe_pixel_luma, sh, bl);

        let final_mult = mix(spatial_mult, pixel_mult, halo_protection);
        rgb *= final_mult;
    }

    if (con != 0.0) {
        let safe_rgb = max(rgb, vec3<f32>(0.0));
        let g = 2.2;
        let perceptual = pow(safe_rgb, vec3<f32>(1.0 / g));
        let clamped_perceptual = clamp(perceptual, vec3<f32>(0.0), vec3<f32>(1.0));
        let strength = pow(2.0, con * 1.25);
        let condition = clamped_perceptual < vec3<f32>(0.5);
        let high_part = 1.0 - 0.5 * pow(2.0 * (1.0 - clamped_perceptual), vec3<f32>(strength));
        let low_part = 0.5 * pow(2.0 * clamped_perceptual, vec3<f32>(strength));
        let curved_perceptual = select(high_part, low_part, condition);
        let contrast_adjusted_rgb = pow(curved_perceptual, vec3<f32>(g));
        let mix_factor = smoothstep(vec3<f32>(1.0), vec3<f32>(1.01), safe_rgb);
        rgb = mix(contrast_adjusted_rgb, rgb, mix_factor);
    }
    return rgb;
}

fn apply_highlights_adjustment(
    color_in: vec3<f32>,
    blurred_color_input_space: vec3<f32>,
    is_raw: u32,
    highlights_adj: f32
) -> vec3<f32> {
    if (highlights_adj == 0.0) { return color_in; }

    let pixel_luma = scene_luminance(max(color_in, vec3<f32>(0.0)));
    let safe_pixel_luma = max(pixel_luma, 0.0001);

    // Above this bound tanh is saturated to f32 precision. Bounding the argument keeps
    // CPU and Metal transcendental approximations deterministic for extended scene values.
    let pixel_mask_input = tanh(min(safe_pixel_luma * 1.5, 8.0));
    let highlight_mask = smoothstep(0.3, 0.95, pixel_mask_input);

    if (highlight_mask < 0.001) {
        return color_in;
    }

    let luma = pixel_luma;
    var final_adjusted_color: vec3<f32>;

    if (highlights_adj < 0.0) {
        var new_luma: f32;
        if (luma <= 1.0) {
            let gamma = 1.0 - highlights_adj * 1.75;
            new_luma = pow(luma, gamma);
        } else {
            let luma_excess = luma - 1.0;
            let compression_strength = -highlights_adj * 6.0;
            let compressed_excess = luma_excess / (1.0 + luma_excess * compression_strength);
            new_luma = 1.0 + compressed_excess;
        }
        let tonally_adjusted_color = color_in * (new_luma / max(luma, 0.0001));
        let desaturation_amount = smoothstep(1.0, 10.0, luma);
        let white_point = vec3<f32>(new_luma);
        final_adjusted_color = mix(tonally_adjusted_color, white_point, desaturation_amount);
    } else {
        let adjustment = highlights_adj * 1.75;
        let factor = pow(2.0, adjustment);
        final_adjusted_color = color_in * factor;
    }

    return mix(color_in, final_adjusted_color, highlight_mask);
}

fn apply_linear_exposure(color_in: vec3<f32>, exposure_adj: f32) -> vec3<f32> {
    if (exposure_adj == 0.0) {
        return color_in;
    }
    return color_in * pow(2.0, exposure_adj);
}

fn apply_filmic_exposure(color_in: vec3<f32>, brightness_adj: f32) -> vec3<f32> {
    if (brightness_adj == 0.0) {
        return color_in;
    }
    const RATIONAL_CURVE_MIX: f32 = 0.95;
    const MIDTONE_STRENGTH: f32 = 1.2;
    const TOP_ANCHOR: f32 = 1.06;
    let original_luma = scene_luminance(color_in);
    if (abs(original_luma) < 0.00001) {
        return color_in;
    }
    let direct_adj = brightness_adj * (1.0 - RATIONAL_CURVE_MIX);
    let rational_adj = brightness_adj * RATIONAL_CURVE_MIX;
    let scale = pow(2.0, direct_adj);
    let k = pow(2.0, -rational_adj * MIDTONE_STRENGTH);
    let luma_abs = abs(original_luma);
    let luma_floor = floor(luma_abs / TOP_ANCHOR) * TOP_ANCHOR;
    let luma_norm = (luma_abs - luma_floor) / TOP_ANCHOR;
    let shaped_norm = luma_norm / (luma_norm + (1.0 - luma_norm) * k);
    let shaped_luma_abs = luma_floor + (shaped_norm * TOP_ANCHOR);
    let new_luma = sign(original_luma) * shaped_luma_abs * scale;
    let chroma = color_in - vec3<f32>(original_luma);
    let total_luma_scale = new_luma / original_luma;
    let luma_weight = clamp(new_luma, 0.0, 2.0) * 0.5;
    let dynamic_exp = mix(0.95, 0.65, luma_weight);
    let base_chroma_scale = pow(total_luma_scale, dynamic_exp);
    let highlight_rolloff = 1.0 / (1.0 + max(0.0, new_luma - 0.9) * 2.0);
    let chroma_scale = base_chroma_scale * highlight_rolloff;
    return vec3<f32>(new_luma) + chroma * chroma_scale;
}

fn apply_color_calibration(color: vec3<f32>, cal: ColorCalibrationSettings) -> vec3<f32> {
    let h_r = cal.red_hue;
    let h_g = cal.green_hue;
    let h_b = cal.blue_hue;
    let r_prime = vec3<f32>(1.0 - abs(h_r), max(0.0, h_r), max(0.0, -h_r));
    let g_prime = vec3<f32>(max(0.0, -h_g), 1.0 - abs(h_g), max(0.0, h_g));
    let b_prime = vec3<f32>(max(0.0, h_b), max(0.0, -h_b), 1.0 - abs(h_b));
    let hue_matrix = mat3x3<f32>(r_prime, g_prime, b_prime);
    var c = hue_matrix * color;

    let luma = scene_luminance(max(vec3(0.0), c));
    let desaturated_color = vec3<f32>(luma);
    let sat_vector = c - desaturated_color;

    let color_sum = c.r + c.g + c.b;
    var masks = vec3<f32>(0.0);
    if (color_sum > 0.001) {
        masks = c / color_sum;
    }

    let total_sat_adjustment =
        masks.r * cal.red_saturation +
        masks.g * cal.green_saturation +
        masks.b * cal.blue_saturation;

    c += sat_vector * total_sat_adjustment;

    let st = cal.shadows_tint;
    if (abs(st) > 0.001) {
        let shadow_luma = scene_luminance(max(vec3(0.0), c));
        let mask = 1.0 - smoothstep(0.0, 0.3, shadow_luma);
        let tint_mult = vec3<f32>(1.0 + st * 0.25, 1.0 - st * 0.25, 1.0 + st * 0.25);
        c = mix(c, c * tint_mult, mask);
    }

    return c;
}

fn apply_white_balance(color: vec3<f32>, temp: f32, tnt: f32) -> vec3<f32> {
    var rgb = color;
    let temp_kelvin_mult = vec3<f32>(1.0 + temp * 0.2, 1.0 + temp * 0.05, 1.0 - temp * 0.2);
    let tint_mult = vec3<f32>(1.0 + tnt * 0.25, 1.0 - tnt * 0.25, 1.0 + tnt * 0.25);
    rgb *= temp_kelvin_mult * tint_mult;
    return rgb;
}

fn apply_creative_color(color: vec3<f32>, sat: f32, vib: f32) -> vec3<f32> {
    var processed = color;
    let luma = scene_luminance(processed);

    if (sat != 0.0) {
        processed = mix(vec3<f32>(luma), processed, 1.0 + sat);
    }
    if (vib == 0.0) { return processed; }
    let c_max = max(processed.r, max(processed.g, processed.b));
    let c_min = min(processed.r, min(processed.g, processed.b));
    let delta = c_max - c_min;
    if (delta < 0.02) {
        return processed;
    }
    let current_sat = delta / max(c_max, 0.001);
    if (vib > 0.0) {
        let sat_mask = 1.0 - smoothstep(0.4, 0.9, current_sat);
        let hsv = rgb_to_hsv(processed);
        let hue = hsv.x;
        let skin_center = 25.0;
        let hue_dist = min(abs(hue - skin_center), 360.0 - abs(hue - skin_center));
        let is_skin = smoothstep(35.0, 10.0, hue_dist);
        let skin_dampener = mix(1.0, 0.6, is_skin);
        let amount = vib * sat_mask * skin_dampener * 3.0;
        processed = mix(vec3<f32>(luma), processed, 1.0 + amount);
    } else {
        let desat_mask = 1.0 - smoothstep(0.2, 0.8, current_sat);
        let amount = vib * desat_mask;
        processed = mix(vec3<f32>(luma), processed, 1.0 + amount);
    }
    return processed;
}

fn apply_channel_mixer_row(color: vec3<f32>, row: ChannelMixerRow, preserve_extended: bool) -> f32 {
    let mixed = dot(color, vec3<f32>(row.red, row.green, row.blue)) + row.constant;
    return select(clamp(mixed, 0.0, 1.0), mixed, preserve_extended);
}

fn apply_channel_mixer(color: vec3<f32>, settings: ChannelMixerSettings, preserve_extended: bool) -> vec3<f32> {
    if (settings.enabled == 0u) {
        return color;
    }

    var mixed = vec3<f32>(
        apply_channel_mixer_row(color, settings.red, preserve_extended),
        apply_channel_mixer_row(color, settings.green, preserve_extended),
        apply_channel_mixer_row(color, settings.blue, preserve_extended),
    );

    if (settings.preserve_luminance == 0u) {
        return mixed;
    }

    let source_luma = scene_luminance(color);
    let mixed_luma = scene_luminance(mixed);
    if (source_luma <= 0.0 || mixed_luma <= 0.0) {
        return mixed;
    }

    mixed *= source_luma / mixed_luma;
    if (!preserve_extended) {
        mixed = clamp(mixed, vec3<f32>(0.0), vec3<f32>(1.0));
    }
    return mixed;
}

fn circular_hue_distance(left: f32, right: f32) -> f32 {
    let delta = abs(left - right) % 360.0;
    return min(delta, 360.0 - delta);
}

fn rgb_to_hue_degrees(color: vec3<f32>) -> f32 {
    let c_max = max(color.r, max(color.g, color.b));
    let c_min = min(color.r, min(color.g, color.b));
    let chroma = c_max - c_min;
    if (chroma <= 0.0) {
        return -1.0;
    }

    if (c_max == color.r) {
        return ((color.g - color.b) / chroma) * 60.0 + select(0.0, 360.0, color.g < color.b);
    }
    if (c_max == color.g) {
        return ((color.b - color.r) / chroma) * 60.0 + 120.0;
    }
    return ((color.r - color.g) / chroma) * 60.0 + 240.0;
}

fn apply_black_white_mixer(color: vec3<f32>, settings: BlackWhiteMixerSettings, preserve_extended: bool) -> vec3<f32> {
    if (settings.enabled == 0u) {
        return color;
    }

    if (settings.process == 1u && settings.implementation_version == 1u) {
        let storage_safe = clamp(color, vec3<f32>(-65504.0), vec3<f32>(65504.0));
        return vec3<f32>(dot(storage_safe, ACESCG_LUMINANCE_COEFF));
    }

    let hue = rgb_to_hue_degrees(color);
    let luma = scene_luminance(color);
    if (hue < 0.0) {
        return vec3<f32>(luma);
    }

    let weights = array<f32, 8>(
        settings.reds,
        settings.oranges,
        settings.yellows,
        settings.greens,
        settings.aquas,
        settings.blues,
        settings.purples,
        settings.magentas,
    );

    var influence_total = 0.0;
    var weighted_adjustment = 0.0;
    for (var i = 0u; i < 8u; i = i + 1u) {
        let influence = clamp(
            1.0 - circular_hue_distance(hue, BLACK_WHITE_MIXER_RANGE_CENTERS[i]) / (BLACK_WHITE_MIXER_RANGE_WIDTHS[i] * 0.5),
            0.0,
            1.0,
        );
        if (influence > 0.0) {
            influence_total += influence;
            weighted_adjustment += influence * weights[i];
        }
    }

    if (influence_total > 0.0) {
        weighted_adjustment = weighted_adjustment / influence_total;
    }
    let adjusted = luma * (1.0 + weighted_adjustment * 0.5);
    let mixed = select(clamp(adjusted, 0.0, 1.0), adjusted, preserve_extended);
    return vec3<f32>(mixed);
}

fn color_balance_rgb_weights(luma: f32) -> vec3<f32> {
    let shadows = clamp((0.55 - luma) / 0.55, 0.0, 1.0);
    let highlights = clamp((luma - 0.45) / 0.55, 0.0, 1.0);
    let midtones = clamp(1.0 - abs(luma - 0.5) / 0.5, 0.0, 1.0);
    let total = shadows + midtones + highlights;
    if (total <= 0.0) {
        return vec3<f32>(0.0, 1.0, 0.0);
    }
    return vec3<f32>(shadows, midtones, highlights) / total;
}

fn apply_color_balance_rgb(color: vec3<f32>, settings: ColorBalanceRgbSettings, preserve_extended: bool) -> vec3<f32> {
    if (settings.enabled == 0u) {
        return color;
    }

    let source_luma = scene_luminance(color);
    let weights = color_balance_rgb_weights(source_luma);
    let offset = (
        settings.shadows.rgb * weights.x +
        settings.midtones.rgb * weights.y +
        settings.highlights.rgb * weights.z
    ) / 400.0;
    var balanced = color + offset;
    if (!preserve_extended) {
        balanced = clamp(balanced, vec3<f32>(0.0), vec3<f32>(1.0));
    }

    if (settings.preserve_luminance == 0u) {
        return balanced;
    }

    let balanced_luma = scene_luminance(balanced);
    if (balanced_luma <= 0.0) {
        return balanced;
    }

    balanced *= source_luma / balanced_luma;
    if (!preserve_extended) {
        balanced = clamp(balanced, vec3<f32>(0.0), vec3<f32>(1.0));
    }
    return balanced;
}

fn apply_luma_levels(color: vec3<f32>, settings: LevelsSettings, preserve_extended: bool) -> vec3<f32> {
    if (settings.enabled == 0u) {
        return color;
    }

    let source_luma = select(max(scene_luminance(color), 0.0), scene_luminance(color), preserve_extended);
    let input_range = max(settings.input_white - settings.input_black, 0.0001);
    let normalized_luma = (source_luma - settings.input_black) / input_range;
    let bounded_luma = clamp(normalized_luma, 0.0, 1.0);
    let gamma_luma = pow(bounded_luma, 1.0 / max(settings.gamma, 0.0001));
    let output_range = settings.output_white - settings.output_black;
    var output_luma = mix(settings.output_black, settings.output_white, gamma_luma);
    if (preserve_extended && normalized_luma < 0.0) {
        output_luma = settings.output_black + normalized_luma * output_range;
    } else if (preserve_extended && normalized_luma > 1.0) {
        output_luma = settings.output_white + (normalized_luma - 1.0) * output_range;
    }

    if (abs(source_luma) <= 0.0001) {
        return vec3<f32>(output_luma);
    }

    let adjusted = color * (output_luma / source_luma);
    return select(clamp(adjusted, vec3<f32>(0.0), vec3<f32>(1.0)), adjusted, preserve_extended);
}

fn apply_hsl_panel(color: vec3<f32>, hsl_adjustments: array<HslColor, 8>, coords_i: vec2<i32>) -> vec3<f32> {
    let negative_residual = select(
        vec3<f32>(0.0),
        min(color, vec3<f32>(0.0)),
        adjustments.global.edit_graph_version >= 2.0,
    );
    let safe_color = max(color, vec3<f32>(0.0));
    if (distance(safe_color.r, safe_color.g) < 0.001 && distance(safe_color.g, safe_color.b) < 0.001) {
        return safe_color + negative_residual;
    }
    let original_hsv = rgb_to_hsv(safe_color);
    let original_luma = scene_luminance(safe_color);

    let saturation_mask = smoothstep(0.05, 0.20, original_hsv.y);
    let luminance_weight = smoothstep(0.0, 1.0, original_hsv.y);

    if (saturation_mask < 0.001 && luminance_weight < 0.001) {
        return safe_color + negative_residual;
    }

    let original_hue = original_hsv.x;

    var raw_influences: array<f32, 8>;
    var total_raw_influence: f32 = 0.0;
    for (var i = 0u; i < 8u; i = i + 1u) {
        let range = HSL_RANGES[i];
        let influence = get_raw_hsl_influence(original_hue, range.center, range.width);
        raw_influences[i] = influence;
        total_raw_influence += influence;
    }

    var total_hue_shift: f32 = 0.0;
    var total_sat_multiplier: f32 = 0.0;
    var total_lum_adjust: f32 = 0.0;

    for (var i = 0u; i < 8u; i = i + 1u) {
        let normalized_influence = raw_influences[i] / total_raw_influence;

        let hue_sat_influence = normalized_influence * saturation_mask;
        let luma_influence = normalized_influence * luminance_weight;

        total_hue_shift += hsl_adjustments[i].hue * 2.0 * hue_sat_influence;
        total_sat_multiplier += hsl_adjustments[i].saturation * hue_sat_influence;
        total_lum_adjust += hsl_adjustments[i].luminance * luma_influence;
    }

    if (original_hsv.y * (1.0 + total_sat_multiplier) < 0.0001) {
        let final_luma = original_luma * (1.0 + total_lum_adjust);
        return vec3<f32>(final_luma) + negative_residual;
    }
    var hsv = original_hsv;
    hsv.x = (hsv.x + total_hue_shift + 360.0) % 360.0;
    hsv.y = clamp(hsv.y * (1.0 + total_sat_multiplier), 0.0, 1.0);
    let hs_shifted_rgb = hsv_to_rgb(vec3<f32>(hsv.x, hsv.y, original_hsv.z));
    let new_luma = scene_luminance(hs_shifted_rgb);
    let target_luma = original_luma * (1.0 + total_lum_adjust);
    if (new_luma < 0.0001) {
        return vec3<f32>(max(0.0, target_luma)) + negative_residual;
    }
    let final_color = hs_shifted_rgb * (target_luma / new_luma);
    return final_color + negative_residual;
}

fn point_color_ap1_to_oklch(ap1: vec3<f32>) -> vec3<f32> {
    let rgb = vec3<f32>(
        dot(vec3<f32>(1.7050515, -0.6217907, -0.0832584), ap1),
        dot(vec3<f32>(-0.1302571, 1.1408027, -0.0105485), ap1),
        dot(vec3<f32>(-0.0240033, -0.1289688, 1.1529715), ap1),
    );
    let lms = vec3<f32>(
        dot(vec3<f32>(0.41222146, 0.53633255, 0.051445995), rgb),
        dot(vec3<f32>(0.2119035, 0.6806995, 0.10739696), rgb),
        dot(vec3<f32>(0.08830246, 0.28171885, 0.6299787), rgb),
    );
    let root = sign(lms) * pow(abs(lms), vec3<f32>(1.0 / 3.0));
    let lab = vec3<f32>(
        dot(vec3<f32>(0.21045426, 0.7936178, -0.004072047), root),
        dot(vec3<f32>(1.9779985, -2.4285922, 0.4505937), root),
        dot(vec3<f32>(0.025904037, 0.78277177, -0.80867577), root),
    );
    return vec3<f32>(lab.x, length(lab.yz), select(degrees(atan2(lab.z, lab.y)) % 360.0, 0.0, length(lab.yz) < 0.0000001));
}

fn point_color_oklch_to_ap1(color: vec3<f32>) -> vec3<f32> {
    let hue = radians(color.z);
    let lab = vec3<f32>(color.x, color.y * cos(hue), color.y * sin(hue));
    let root = vec3<f32>(
        lab.x + 0.39633778 * lab.y + 0.21580376 * lab.z,
        lab.x - 0.105561346 * lab.y - 0.06385417 * lab.z,
        lab.x - 0.08948418 * lab.y - 1.2914855 * lab.z,
    );
    let lms = root * root * root;
    let rgb = vec3<f32>(
        dot(vec3<f32>(4.0767417, -3.3077116, 0.23096994), lms),
        dot(vec3<f32>(-1.268438, 2.6097574, -0.34131938), lms),
        dot(vec3<f32>(-0.004196086, -0.7034186, 1.7076147), lms),
    );
    return vec3<f32>(
        dot(vec3<f32>(0.6130974, 0.3395231, 0.0473795), rgb),
        dot(vec3<f32>(0.0701937, 0.9163539, 0.0134524), rgb),
        dot(vec3<f32>(0.0206156, 0.1095698, 0.8698146), rgb),
    );
}

fn point_color_hue_distance(left: f32, right: f32) -> f32 {
    let distance = abs(left - right) % 360.0;
    return min(distance, 360.0 - distance);
}

fn apply_point_color(color: vec3<f32>, settings: PointColorGpuSettings) -> vec3<f32> {
    var oklch = point_color_ap1_to_oklch(color);
    var visualization_weight = 0.0;
    for (var point_index = 0u; point_index < min(settings.control.x, 8u); point_index += 1u) {
        let point = settings.points[point_index];
        if (point.control.w < 0.5) { continue; }
        var membership = 0.0;
        for (var sample_index = 0u; sample_index < min(u32(point.control.z), 4u); sample_index += 1u) {
            let sample = point.samples[sample_index];
            let distance = length(vec3<f32>(
                point_color_hue_distance(oklch.z, sample.z) / max(point.range.x, 0.1),
                abs(oklch.y - sample.y) / max(point.range.y, 0.001),
                abs(oklch.x - sample.x) / max(point.range.z, 0.001),
            )) / clamp(point.range.w, 0.25, 4.0);
            let chroma_gate = smoothstep(0.003, 0.02, min(oklch.y, sample.y));
            let weight = (1.0 - smoothstep(max(0.0, 1.0 - clamp(point.edit.x, 0.0, 1.0)), 1.0, distance)) * chroma_gate * clamp(sample.w, 0.0, 1.0);
            membership = 1.0 - (1.0 - membership) * (1.0 - weight);
        }
        let weight = membership * clamp(point.control.y, 0.0, 1.0);
        visualization_weight = max(visualization_weight, weight);
        let saturation = oklch.y / max(oklch.x, 0.01);
        oklch = vec3<f32>(
            oklch.x + point.edit.w * weight,
            max(oklch.y + point.edit.z * weight, max(0.0, saturation * (1.0 + point.control.x * weight)) * max(oklch.x, 0.01)),
            (oklch.z + point.edit.y * weight + 360.0) % 360.0,
        );
    }
    if (settings.skin_target.w > 0.5) {
        let point = settings.skin_range;
        var membership = 0.0;
        for (var sample_index = 0u; sample_index < min(u32(point.control.z), 4u); sample_index += 1u) {
            let sample = point.samples[sample_index];
            let distance = length(vec3<f32>(point_color_hue_distance(oklch.z, sample.z) / max(point.range.x, 0.1), abs(oklch.y - sample.y) / max(point.range.y, 0.001), abs(oklch.x - sample.x) / max(point.range.z, 0.001))) / clamp(point.range.w, 0.25, 4.0);
            let weight = (1.0 - smoothstep(max(0.0, 1.0 - clamp(point.edit.x, 0.0, 1.0)), 1.0, distance)) * smoothstep(0.003, 0.02, min(oklch.y, sample.y)) * clamp(sample.w, 0.0, 1.0);
            membership = 1.0 - (1.0 - membership) * (1.0 - weight);
        }
        let extremes = clamp(1.0 - smoothstep(0.0, 0.12, oklch.x) + smoothstep(0.82, 1.0, oklch.x), 0.0, 1.0);
        let influence = membership * (1.0 - clamp(settings.skin_control.w, 0.0, 1.0) * extremes);
        let hue_delta = ((settings.skin_target.z - oklch.z + 540.0) % 360.0) - 180.0;
        oklch = vec3<f32>(
            oklch.x + (settings.skin_target.x - oklch.x) * clamp(settings.skin_control.z, 0.0, 1.0) * influence,
            oklch.y + (settings.skin_target.y - oklch.y) * clamp(settings.skin_control.y, 0.0, 1.0) * influence,
            (oklch.z + hue_delta * clamp(settings.skin_control.x, 0.0, 1.0) * influence + 360.0) % 360.0,
        );
        visualization_weight = max(visualization_weight, membership);
    }
    let edited = point_color_oklch_to_ap1(oklch);
    if (settings.control.y == 1u) { return vec3<f32>(visualization_weight); }
    if (settings.control.y == 2u) {
        let grayscale = vec3<f32>(scene_luminance(max(edited, vec3<f32>(0.0))));
        return mix(grayscale, edited, visualization_weight);
    }
    return edited;
}

fn apply_color_grading(color: vec3<f32>, shadows: ColorGradeSettings, midtones: ColorGradeSettings, highlights: ColorGradeSettings, global: ColorGradeSettings, blending: f32, balance: f32) -> vec3<f32> {
    let luma = scene_luminance(max(vec3(0.0), color));
    let base_shadow_crossover = 0.1;
    let base_highlight_crossover = 0.5;
    let balance_range = 0.5;
    let shadow_crossover = base_shadow_crossover + max(0.0, -balance) * balance_range;
    let highlight_crossover = base_highlight_crossover - max(0.0, balance) * balance_range;
    let feather = 0.2 * blending;
    let final_shadow_crossover = min(shadow_crossover, highlight_crossover - 0.01);
    let shadow_mask = 1.0 - smoothstep(final_shadow_crossover - feather, final_shadow_crossover + feather, luma);
    let highlight_mask = smoothstep(highlight_crossover - feather, highlight_crossover + feather, luma);
    let midtone_mask = max(0.0, 1.0 - shadow_mask - highlight_mask);
    let global_mask = 1.0;
    var graded_color = color;
    let shadow_sat_strength = 0.3;
    let shadow_lum_strength = 0.5;
    let midtone_sat_strength = 0.6;
    let midtone_lum_strength = 0.8;
    let highlight_sat_strength = 0.8;
    let highlight_lum_strength = 1.0;
    let global_sat_strength = 1.0;
    let global_lum_strength = 1.0;
    if (shadows.saturation > 0.001) { let tint_rgb = hsv_to_rgb(vec3<f32>(shadows.hue, 1.0, 1.0)); graded_color += (tint_rgb - 0.5) * shadows.saturation * shadow_mask * shadow_sat_strength; }
    graded_color += shadows.luminance * shadow_mask * shadow_lum_strength;
    if (midtones.saturation > 0.001) { let tint_rgb = hsv_to_rgb(vec3<f32>(midtones.hue, 1.0, 1.0)); graded_color += (tint_rgb - 0.5) * midtones.saturation * midtone_mask * midtone_sat_strength; }
    graded_color += midtones.luminance * midtone_mask * midtone_lum_strength;
    if (highlights.saturation > 0.001) { let tint_rgb = hsv_to_rgb(vec3<f32>(highlights.hue, 1.0, 1.0)); graded_color += (tint_rgb - 0.5) * highlights.saturation * highlight_mask * highlight_sat_strength; }
    graded_color += highlights.luminance * highlight_mask * highlight_lum_strength;
    if (global.saturation > 0.001) { let tint_rgb = hsv_to_rgb(vec3<f32>(global.hue, 1.0, 1.0)); graded_color += (tint_rgb - 0.5) * global.saturation * global_mask * global_sat_strength; }
    graded_color += global.luminance * global_mask * global_lum_strength;
    return graded_color;
}

fn apply_local_contrast(
    processed_color_linear: vec3<f32>,
    blurred_color_input_space: vec3<f32>,
    amount: f32,
    is_raw: u32,
    mode: u32,
    threshold: f32
) -> vec3<f32> {
    if (amount == 0.0) {
        return processed_color_linear;
    }

    var blurred_color_linear: vec3<f32>;
    if (is_raw == 1u) {
        blurred_color_linear = blurred_color_input_space;
    } else {
        blurred_color_linear = srgb_to_linear(blurred_color_input_space);
    }

    if (amount < 0.0) {
        var blur_amount = -amount;
        if (mode == 0u) {
            blur_amount = blur_amount * 0.5;
        }
        return mix(processed_color_linear, blurred_color_linear, blur_amount);
    }

    let center_luma = scene_luminance(processed_color_linear);

    let shadow_threshold = select(0.03, 0.1, is_raw == 1u);
    let shadow_protection = smoothstep(0.0, shadow_threshold, center_luma);
    let highlight_protection = 1.0 - smoothstep(0.9, 1.0, center_luma);
    let midtone_mask = shadow_protection * highlight_protection;

    if (midtone_mask < 0.001) {
        return processed_color_linear;
    }

    let blurred_luma = scene_luminance(blurred_color_linear);
    let safe_center_luma = max(center_luma, 0.0001);
    let safe_blurred_luma = max(blurred_luma, 0.0001);

    let log_ratio = log2(safe_center_luma / safe_blurred_luma);
    var effective_amount = amount;

    if (mode == 0u) {
        let edge_magnitude = abs(log_ratio);
        let normalized_edge = clamp(edge_magnitude / 3.0, 0.0, 1.0);
        let edge_dampener = 1.0 - pow(normalized_edge, 0.5);
        let edge_mask = select(
            smoothstep(threshold * 0.5, threshold * 1.5, edge_magnitude),
            1.0,
            threshold <= 0.0,
        );
        effective_amount = amount * edge_dampener * edge_mask * 0.8;
    } else {
        effective_amount = amount;
    }

    let contrast_factor = exp2(log_ratio * effective_amount);
    let final_color = processed_color_linear * contrast_factor;

    return mix(processed_color_linear, final_color, midtone_mask);
}

fn apply_centre_local_contrast(
    color_in: vec3<f32>,
    centre_amount: f32,
    coords_i: vec2<i32>,
    blurred_color_srgb: vec3<f32>,
    is_raw: u32
) -> vec3<f32> {
    if (centre_amount == 0.0) {
        return color_in;
    }
    let full_dims_f = vec2<f32>(textureDimensions(input_texture));
    let coord_f = vec2<f32>(coords_i);
    let midpoint = 0.4;
    let feather = 0.375;
    let aspect = full_dims_f.y / full_dims_f.x;
    let uv_centered = (coord_f / full_dims_f - 0.5) * 2.0;
    let d = length(uv_centered * vec2<f32>(1.0, aspect)) * 0.5;
    let vignette_mask = smoothstep(midpoint - feather, midpoint + feather, d);
    let centre_mask = 1.0 - vignette_mask;

    const CLARITY_SCALE: f32 = 0.9;
    var processed_color = color_in;
    let clarity_strength = centre_amount * (2.0 * centre_mask - 1.0) * CLARITY_SCALE;

    if (abs(clarity_strength) > 0.001) {
        processed_color = apply_local_contrast(processed_color, blurred_color_srgb, clarity_strength, is_raw, 1u, 0.0);
    }

    return processed_color;
}

fn apply_centre_tonal_and_color(
    color_in: vec3<f32>,
    centre_amount: f32,
    coords_i: vec2<i32>
) -> vec3<f32> {
    if (centre_amount == 0.0) {
        return color_in;
    }
    let full_dims_f = vec2<f32>(textureDimensions(input_texture));
    let coord_f = vec2<f32>(coords_i);
    let midpoint = 0.4;
    let feather = 0.375;
    let aspect = full_dims_f.y / full_dims_f.x;
    let uv_centered = (coord_f / full_dims_f - 0.5) * 2.0;
    let d = length(uv_centered * vec2<f32>(1.0, aspect)) * 0.5;
    let vignette_mask = smoothstep(midpoint - feather, midpoint + feather, d);
    let centre_mask = 1.0 - vignette_mask;

    const EXPOSURE_SCALE: f32 = 0.5;
    const VIBRANCE_SCALE: f32 = 0.4;
    const SATURATION_CENTER_SCALE: f32 = 0.3;
    const SATURATION_EDGE_SCALE: f32 = 0.8;

    var processed_color = color_in;

    let exposure_boost = centre_mask * centre_amount * EXPOSURE_SCALE;
    processed_color = apply_filmic_exposure(processed_color, exposure_boost);

    let vibrance_center_boost = centre_mask * centre_amount * VIBRANCE_SCALE;
    let saturation_center_boost = centre_mask * centre_amount * SATURATION_CENTER_SCALE;
    let saturation_edge_effect = -(1.0 - centre_mask) * centre_amount * SATURATION_EDGE_SCALE;
    let total_saturation_effect = saturation_center_boost + saturation_edge_effect;
    processed_color = apply_creative_color(processed_color, total_saturation_effect, vibrance_center_boost);

    return processed_color;
}

fn legacy_fixed_atmosphere_dehaze_v1(
    color: vec3<f32>,
    blurred_color_input_space: vec3<f32>,
    is_raw: u32,
    amount: f32,
) -> vec3<f32> {
    if (amount == 0.0) { return color; }
    var blurred_linear: vec3<f32>;
    if (is_raw == 1u) {
        blurred_linear = blurred_color_input_space;
    } else {
        blurred_linear = srgb_to_linear(blurred_color_input_space);
    }
    let atmospheric_light = vec3<f32>(0.95, 0.97, 1.0);
    if (amount > 0.0) {
        let pixel_dark = min(color.r, min(color.g, color.b));
        let regional_dark = min(blurred_linear.r, min(blurred_linear.g, blurred_linear.b));
        let pixel_luma = scene_luminance(max(color, vec3<f32>(0.0)));
        let blurred_luma = scene_luminance(max(blurred_linear, vec3<f32>(0.0)));
        let edge_diff = abs(sqrt(pixel_luma) - sqrt(blurred_luma));
        let halo_protection = smoothstep(0.02, 0.15, edge_diff);
        let spatial_dark = mix(regional_dark, pixel_dark, halo_protection);
        let safe_dark = max(spatial_dark - 0.02, 0.0);
        let mapped_haze = safe_dark / (safe_dark + 0.2);
        let transmission = max(1.0 - amount * mapped_haze * 0.85, 0.15);
        var recovered = (color - atmospheric_light) / transmission + atmospheric_light;
        let recovered_luma = scene_luminance(max(recovered, vec3<f32>(0.0)));
        recovered += smoothstep(0.1, 0.0, recovered_luma) * (1.0 - transmission) * 0.15;
        let final_luma = scene_luminance(max(recovered, vec3<f32>(0.0)));
        recovered = mix(vec3<f32>(final_luma), recovered, 1.0 + (1.0 - transmission) * 0.5);
        return max(recovered, vec3<f32>(0.0));
    }
    let regional_dark = min(blurred_linear.r, min(blurred_linear.g, blurred_linear.b));
    let safe_dark = max(regional_dark - 0.02, 0.0);
    let mapped_depth = safe_dark / (safe_dark + 0.2);
    let depth_factor = mix(0.4, 1.0, mapped_depth);
    return mix(color, atmospheric_light, abs(amount) * 0.7 * depth_factor);
}

fn apply_scene_dehaze_v1(
    color: vec3<f32>,
    blurred_color_input_space: vec3<f32>,
    is_raw: u32,
    amount: f32,
    atmospheric_light: vec3<f32>,
    atmosphere_confidence: f32,
) -> vec3<f32> {
    if (amount == 0.0) { return color; }

    var blurred_linear: vec3<f32>;
    if (is_raw == 1u) {
        blurred_linear = blurred_color_input_space;
    } else {
        blurred_linear = srgb_to_linear(blurred_color_input_space);
    }

    let safe_atmosphere = max(atmospheric_light, vec3<f32>(0.01));
    let pixel_dark = min(color.r / safe_atmosphere.r, min(color.g / safe_atmosphere.g, color.b / safe_atmosphere.b));
    let regional_dark = min(
        blurred_linear.r / safe_atmosphere.r,
        min(blurred_linear.g / safe_atmosphere.g, blurred_linear.b / safe_atmosphere.b),
    );
    let pixel_luma = scene_luminance(max(color, vec3<f32>(0.0)));
    let blurred_luma = scene_luminance(max(blurred_linear, vec3<f32>(0.0)));
    let edge_diff = abs(sqrt(pixel_luma) - sqrt(blurred_luma));
    let edge_weight = smoothstep(0.02, 0.15, edge_diff);
    let guided_dark = mix(regional_dark, pixel_dark, edge_weight);
    let transmission = clamp(1.0 - 0.95 * guided_dark, 0.08, 1.0);
    let confidence_weight = mix(0.35, 1.0, clamp(atmosphere_confidence, 0.0, 1.0));
    let strength = clamp(abs(amount) * 7.5, 0.0, 1.0) * confidence_weight;
    let effective_transmission = mix(1.0, transmission, strength);

    if (amount > 0.0) {
        let recovered = (color - safe_atmosphere) / effective_transmission + safe_atmosphere;
        let atmosphere_luma = scene_luminance(safe_atmosphere);
        let highlight_protection = smoothstep(atmosphere_luma * 0.75, atmosphere_luma * 1.25, pixel_luma);
        return mix(recovered, color, highlight_protection * 0.65);
    }
    return color * effective_transmission + safe_atmosphere * (1.0 - effective_transmission);
}

fn apply_noise_reduction(
    center_linear: vec3<f32>,
    coords_i: vec2<i32>,
    luma_amount: f32,
    color_amount: f32,
    scale: f32,
    is_raw: u32
) -> vec3<f32> {
    let luma_a  = clamp(luma_amount,  0.0, 1.0);
    let color_a = clamp(color_amount, 0.0, 1.0);
    if (luma_a < 0.001 && color_a < 0.001) {
        return center_linear;
    }

    let dims = vec2<i32>(textureDimensions(input_texture));
    let max_idx = dims - vec2<i32>(1);
    let center_safe   = max(center_linear, vec3<f32>(0.0));
    let center_luma   = scene_luminance(center_safe);
    let center_chroma = center_linear - vec3<f32>(center_luma);

    let res_factor = clamp(sqrt(scale), 0.5, 2.0);

    var new_luma   = center_luma;
    var new_chroma = center_chroma;

    // --- LUMA NOISE REDUCTION ---
    if (luma_a > 0.001) {
        let l_curve = sqrt(luma_a);

        let stride_f = mix(1.0, 2.0, smoothstep(0.45, 0.95, luma_a)) * res_factor;
        let extra    = clamp(stride_f - 1.0, 0.0, 1.0);

        let l_spatial = mix(1.0, 1.5, l_curve);
        let l_spat_n  = -1.0 / max(2.0 * l_spatial * l_spatial, 1e-6);

        let h1 = hash(vec2<f32>(coords_i));
        let h2 = hash(vec2<f32>(coords_i) + vec2<f32>(17.31, 71.13));

        var samp_luma: array<f32, 25>;
        var samp_spat: array<f32, 25>;
        var lmin: f32 = center_luma;
        var lmax: f32 = center_luma;

        samp_luma[0] = center_luma;
        samp_spat[0] = 1.0;

        var idx: u32 = 1u;
        for (var dy: i32 = -2; dy <= 2; dy = dy + 1) {
            for (var dx: i32 = -2; dx <= 2; dx = dx + 1) {
                if (dx == 0 && dy == 0) { continue; }

                let ring = max(abs(dx), abs(dy));
                let ring_factor = select(0.5, 1.0, ring == 2);
                let grow = 1.0 + extra * ring_factor;

                let jx = (h1 - 0.5) * 2.0 * extra;
                let jy = (h2 - 0.5) * 2.0 * extra;

                let off_f = vec2<f32>(f32(dx) * grow + jx, f32(dy) * grow + jy);
                let off   = vec2<i32>(i32(round(off_f.x)), i32(round(off_f.y)));
                let coord = clamp(coords_i + off, vec2<i32>(0), max_idx);

                var s = textureLoad(input_texture, vec2<u32>(coord), 0).rgb;
                if (is_raw == 0u) { s = srgb_to_linear(s); }
                let s_luma = scene_luminance(max(s, vec3<f32>(0.0)));
                samp_luma[idx] = s_luma;
                samp_spat[idx] = exp(f32(dx * dx + dy * dy) * l_spat_n);
                lmin = min(lmin, s_luma);
                lmax = max(lmax, s_luma);
                idx = idx + 1u;
            }
        }

        let luma_range    = lmax - lmin;
        let edge_strength = smoothstep(0.04, 0.20, luma_range);
        let edge_midpoint = (lmin + lmax) * 0.5;
        let center_side   = center_luma > edge_midpoint;

        let l_range_tol = mix(
            mix(0.025, 0.075, l_curve),
            mix(0.010, 0.025, l_curve),
            edge_strength
        );

        var samp_gate: array<f32, 25>;
        var sum_a: f32 = 0.0;
        var w_a:   f32 = 0.0;
        for (var k: u32 = 0u; k < 25u; k = k + 1u) {
            let diff = abs(samp_luma[k] - center_luma);
            let g_range = 1.0 - smoothstep(l_range_tol * 0.6, l_range_tol, diff);
            let s_side  = samp_luma[k] > edge_midpoint;
            let g_side  = select(0.0, 1.0, s_side == center_side);
            let g_edge  = mix(1.0, g_side, edge_strength);
            let w = samp_spat[k] * g_range * g_edge;
            samp_gate[k] = w;
            sum_a += samp_luma[k] * w;
            w_a   += w;
        }
        let initial_mean = sum_a / max(w_a, 1e-4);

        let outlier_tol = mix(0.07, 0.025, edge_strength);
        var sum_b: f32 = 0.0;
        var w_b:   f32 = 0.0;
        for (var k: u32 = 0u; k < 25u; k = k + 1u) {
            let init_w = samp_gate[k];
            if (init_w > 0.0001) {
                let d = samp_luma[k] - initial_mean;
                let r = abs(d) / outlier_tol;
                let bisq = max(0.0, 1.0 - r * r);
                let outlier_w = bisq * bisq;
                let w = init_w * outlier_w;
                sum_b += samp_luma[k] * w;
                w_b   += w;
            }
        }
        let robust_luma = select(initial_mean, sum_b / max(w_b, 1e-6), w_b > 0.01);

        let strength = luma_a * mix(1.0, 0.6, edge_strength);
        new_luma = mix(center_luma, robust_luma, strength);
    }

    if (color_a > 0.001) {
        let center_r_y = center_linear.r - center_luma;
        let center_b_y = center_linear.b - center_luma;
        let c_curve = sqrt(color_a);
        let stride_f = mix(2.0, 3.5, c_curve) * res_factor;

        let c_spatial = mix(2.0, 3.5, c_curve);
        let c_spat_n  = -1.0 / max(2.0 * c_spatial * c_spatial, 1e-6);

        let luma_tol = mix(0.12, 0.04, c_curve);
        let luma_n   = -1.0 / max(2.0 * luma_tol * luma_tol, 1e-6);

        let chroma_tol = mix(0.20, 0.08, c_curve);
        let chroma_n   = -1.0 / max(2.0 * chroma_tol * chroma_tol, 1e-6);

        let jh1 = hash(vec2<f32>(coords_i) + vec2<f32>(43.7, 91.1));
        let jh2 = hash(vec2<f32>(coords_i) + vec2<f32>(73.3, 17.9));
        let jx  = (jh1 - 0.5) * stride_f * 0.5;
        let jy  = (jh2 - 0.5) * stride_f * 0.5;

        var sum_r: f32 = center_r_y;
        var sum_b: f32 = center_b_y;
        var w_sum: f32 = 1.0;

        for (var dy: i32 = -2; dy <= 2; dy = dy + 1) {
            for (var dx: i32 = -2; dx <= 2; dx = dx + 1) {
                if (dx == 0 && dy == 0) { continue; }
                let off_f = vec2<f32>(f32(dx) * stride_f + jx, f32(dy) * stride_f + jy);
                let off   = vec2<i32>(i32(round(off_f.x)), i32(round(off_f.y)));
                let coord = clamp(coords_i + off, vec2<i32>(0), max_idx);
                var s = textureLoad(input_texture, vec2<u32>(coord), 0).rgb;

                if (is_raw == 0u) { s = srgb_to_linear(s); }

                let s_safe = max(s, vec3<f32>(0.0));
                let s_luma = scene_luminance(s_safe);
                let s_r_y  = s.r - s_luma;
                let s_b_y  = s.b - s_luma;

                let r2  = f32(dx * dx + dy * dy);
                let w_s = exp(r2 * c_spat_n);
                let dl  = s_luma - center_luma;
                let w_l = exp(dl * dl * luma_n);
                let dr  = s_r_y - center_r_y;
                let db  = s_b_y - center_b_y;
                let dc2 = dr * dr + db * db;
                let w_c = exp(dc2 * chroma_n);
                let w = w_s * w_l * w_c;

                sum_r += s_r_y * w;
                sum_b += s_b_y * w;
                w_sum += w;
            }
        }
        let filtered_r_y = sum_r / max(w_sum, 1e-6);
        let filtered_b_y = sum_b / max(w_sum, 1e-6);

        let new_r_y = mix(center_r_y, filtered_r_y, color_a);
        let new_b_y = mix(center_b_y, filtered_b_y, color_a);
        let luma_coeff = scene_luminance_coefficients();
        let new_g_y = -(luma_coeff.r * new_r_y + luma_coeff.b * new_b_y) / luma_coeff.g;

        new_chroma = vec3<f32>(new_r_y, new_g_y, new_b_y);
    }

    return vec3<f32>(new_luma) + new_chroma;
}

fn apply_ca_correction(coords: vec2<u32>, ca_rc: f32, ca_by: f32) -> vec3<f32> {
    let dims = vec2<f32>(textureDimensions(input_texture));
    let center = dims / 2.0;
    let current_pos = vec2<f32>(coords);

    let to_center = current_pos - center;
    let dist = length(to_center);

    if (dist == 0.0) {
        return textureLoad(input_texture, coords, 0).rgb;
    }

    let dir = to_center / dist;

    let red_shift = dir * dist * ca_rc;
    let blue_shift = dir * dist * ca_by;

    let red_coords = vec2<i32>(round(current_pos - red_shift));
    let blue_coords = vec2<i32>(round(current_pos - blue_shift));
    let green_coords = vec2<i32>(current_pos);

    let max_coords = vec2<i32>(dims - 1.0);

    let r = textureLoad(input_texture, vec2<u32>(clamp(red_coords, vec2<i32>(0), max_coords)), 0).r;
    let g = textureLoad(input_texture, vec2<u32>(clamp(green_coords, vec2<i32>(0), max_coords)), 0).g;
    let b = textureLoad(input_texture, vec2<u32>(clamp(blue_coords, vec2<i32>(0), max_coords)), 0).b;

    return vec3<f32>(r, g, b);
}

const AGX_EPSILON: f32 = 1.0e-6;
const AGX_MIN_EV: f32 = -15.2;
const AGX_MAX_EV: f32 = 5.0;
const AGX_RANGE_EV: f32 = AGX_MAX_EV - AGX_MIN_EV;
const AGX_GAMMA: f32 = 2.4;
const AGX_SLOPE: f32 = 2.3843;
const AGX_TOE_POWER: f32 = 1.5;
const AGX_SHOULDER_POWER: f32 = 1.5;
const AGX_TOE_TRANSITION_X: f32 = 0.6060606;
const AGX_TOE_TRANSITION_Y: f32 = 0.43446;
const AGX_SHOULDER_TRANSITION_X: f32 = 0.6060606;
const AGX_SHOULDER_TRANSITION_Y: f32 = 0.43446;
const AGX_INTERCEPT: f32 = -1.0112;
const AGX_TOE_SCALE: f32 = -1.0359;
const AGX_SHOULDER_SCALE: f32 = 1.3475;
const AGX_TARGET_BLACK_PRE_GAMMA: f32 = 0.0;
const AGX_TARGET_WHITE_PRE_GAMMA: f32 = 1.0;

fn agx_sigmoid(x: f32, power: f32) -> f32 {
    return x / pow(1.0 + pow(x, power), 1.0 / power);
}

fn agx_scaled_sigmoid(x: f32, scale: f32, slope: f32, power: f32, transition_x: f32, transition_y: f32) -> f32 {
    return scale * agx_sigmoid(slope * (x - transition_x) / scale, power) + transition_y;
}

fn agx_apply_curve_channel(x: f32) -> f32 {
    var result: f32 = 0.0;
    if (x < AGX_TOE_TRANSITION_X) {
        result = agx_scaled_sigmoid(x, AGX_TOE_SCALE, AGX_SLOPE, AGX_TOE_POWER, AGX_TOE_TRANSITION_X, AGX_TOE_TRANSITION_Y);
    } else if (x <= AGX_SHOULDER_TRANSITION_X) {
        result = AGX_SLOPE * x + AGX_INTERCEPT;
    } else {
        result = agx_scaled_sigmoid(x, AGX_SHOULDER_SCALE, AGX_SLOPE, AGX_SHOULDER_POWER, AGX_SHOULDER_TRANSITION_X, AGX_SHOULDER_TRANSITION_Y);
    }
    return clamp(result, AGX_TARGET_BLACK_PRE_GAMMA, AGX_TARGET_WHITE_PRE_GAMMA);
}

fn agx_compress_gamut(c: vec3<f32>) -> vec3<f32> {
    let min_c = min(c.r, min(c.g, c.b));
    if (min_c < 0.0) {
        return c - min_c;
    }
    return c;
}

fn agx_tonemap(c: vec3<f32>) -> vec3<f32> {
    let x_relative = max(c / 0.18, vec3<f32>(AGX_EPSILON));
    let log_encoded = (log2(x_relative) - AGX_MIN_EV) / AGX_RANGE_EV;
    let mapped = clamp(log_encoded, vec3<f32>(0.0), vec3<f32>(1.0));

    var curved: vec3<f32>;
    curved.r = agx_apply_curve_channel(mapped.r);
    curved.g = agx_apply_curve_channel(mapped.g);
    curved.b = agx_apply_curve_channel(mapped.b);

    let final_color = pow(max(curved, vec3<f32>(0.0)), vec3<f32>(AGX_GAMMA));

    return final_color;
}

fn agx_full_transform(color_in: vec3<f32>) -> vec3<f32> {
    let compressed_color = agx_compress_gamut(color_in);
    let color_in_agx_space = adjustments.global.agx_pipe_to_rendering_matrix * compressed_color;
    let tonemapped_agx = agx_tonemap(color_in_agx_space);
    let final_color = adjustments.global.agx_rendering_to_pipe_matrix * tonemapped_agx;
    return final_color;
}

fn rapid_view_softplus(value: f32, width: f32) -> f32 {
    let scaled = value / width;
    if (scaled > 16.0) { return value; }
    if (scaled < -16.0) { return width * exp(scaled); }
    return width * log(1.0 + exp(scaled));
}

fn rapid_view_bounded_ev(ev: f32, black: f32, white: f32, toe_width: f32, shoulder_width: f32) -> f32 {
    if (ev > (black + white) * 0.5) {
        return white - rapid_view_softplus(white - ev, shoulder_width)
            + rapid_view_softplus(black - ev, toe_width);
    }
    return black + rapid_view_softplus(ev - black, toe_width)
        - rapid_view_softplus(ev - white, shoulder_width);
}

fn rapid_view_scalar(value: f32) -> f32 {
    let p0 = adjustments.global.rapid_view_parameters0;
    let p1 = adjustments.global.rapid_view_parameters1;
    let p2 = adjustments.global.rapid_view_parameters2;
    if (value == 0.0) { return p0.w; }
    let value_sign = sign(value);
    let ev = log2(abs(value) / p0.x);
    let scaled_ev = ev * p1.w;
    var q: f32;
    if (scaled_ev <= p0.y - 16.0 * p1.y) { q = 0.0; }
    else if (scaled_ev >= p0.z + 16.0 * p1.z) { q = 1.0; }
    else {
        let bounded = rapid_view_bounded_ev(scaled_ev, p0.y, p0.z, p1.y, p1.z);
        q = (bounded - p0.y) / (p0.z - p0.y);
    }
    return value_sign * (p0.w + (p1.x - p0.w) * pow(q, p2.x));
}

fn rapid_view_transform(color: vec3<f32>) -> vec3<f32> {
    if (!all(color == color) || !all(abs(color) < vec3<f32>(3.0e38))) { return vec3<f32>(0.0); }
    let luma = dot(color, vec3<f32>(0.27222872, 0.67408174, 0.05368952));
    if (luma <= 1.0e-8) {
        return vec3<f32>(rapid_view_scalar(color.x), rapid_view_scalar(color.y), rapid_view_scalar(color.z));
    }
    let mapped = rapid_view_scalar(luma);
    let scaled = color * (mapped / luma);
    let headroom = clamp(mapped / adjustments.global.rapid_view_parameters1.x, 0.0, 1.0);
    let compression = adjustments.global.rapid_view_parameters2.y * smoothstep(0.65, 1.0, headroom);
    return mix(scaled, vec3<f32>(mapped), compression);
}

fn rapid_view_encode_signed(color: vec3<f32>) -> vec3<f32> {
    let magnitude = abs(color);
    let higher = 1.055 * pow(magnitude, vec3<f32>(1.0 / 2.4)) - 0.055;
    let lower = magnitude * 12.92;
    return sign(color) * select(higher, lower, magnitude <= vec3<f32>(0.0031308));
}

fn legacy_tonemap(c: vec3<f32>) -> vec3<f32> {
    const a: f32 = 2.51;
    const b: f32 = 0.03;
    const c_const: f32 = 2.43;
    const d: f32 = 0.59;
    const e: f32 = 0.14;

    let x = max(c, vec3<f32>(0.0));

    let numerator = x * (a * x + b);
    let denominator = x * (c_const * x + d) + e;

    let tonemapped = select(vec3<f32>(0.0), numerator / denominator, denominator > vec3<f32>(0.00001));

    return clamp(tonemapped, vec3<f32>(0.0), vec3<f32>(1.0));
}

fn no_tonemap(c: vec3<f32>) -> vec3<f32> {
    return c;
}

fn is_default_curve(points: array<Point, 16>, count: u32) -> bool {
    if (count < 2u) {
        return false;
    }

    var is_identity = true;
    for (var i = 0u; i < count; i = i + 1u) {
        if (abs(points[i].x - points[i].y) > 0.5) {
            is_identity = false;
            break;
        }
    }

    let p0 = points[0];
    let p_last = points[count - 1u];
    let p0_is_origin = abs(p0.x - 0.0) < 0.1 && abs(p0.y - 0.0) < 0.1;
    let p_last_is_end = abs(p_last.x - 255.0) < 0.1 && abs(p_last.y - 255.0) < 0.1;

    return is_identity && p0_is_origin && p_last_is_end;
}

fn apply_all_curves(color: vec3<f32>, luma_curve: array<Point, 16>, luma_curve_count: u32, red_curve: array<Point, 16>, red_curve_count: u32, green_curve: array<Point, 16>, green_curve_count: u32, blue_curve: array<Point, 16>, blue_curve_count: u32, preserve_extended: bool) -> vec3<f32> {
    let luma_is_default = is_default_curve(luma_curve, luma_curve_count);
    let red_is_default = is_default_curve(red_curve, red_curve_count);
    let green_is_default = is_default_curve(green_curve, green_curve_count);
    let blue_is_default = is_default_curve(blue_curve, blue_curve_count);
    let rgb_curves_are_active = !red_is_default || !green_is_default || !blue_is_default;

    if (preserve_extended && luma_is_default && !rgb_curves_are_active) {
        return color;
    }

    if (rgb_curves_are_active) {
        let color_graded = vec3<f32>(apply_curve(color.r, red_curve, red_curve_count, preserve_extended), apply_curve(color.g, green_curve, green_curve_count, preserve_extended), apply_curve(color.b, blue_curve, blue_curve_count, preserve_extended));
        let luma_initial = view_encoded_luma(color);
        let luma_target = apply_curve(luma_initial, luma_curve, luma_curve_count, preserve_extended);
        let luma_graded = view_encoded_luma(color_graded);
        var final_color: vec3<f32>;
        if (luma_graded > 0.001) { final_color = color_graded * (luma_target / luma_graded); } else { final_color = vec3<f32>(luma_target); }
        let max_comp = max(final_color.r, max(final_color.g, final_color.b));
        if (!preserve_extended && max_comp > 1.0) { final_color = final_color / max_comp; }
        return final_color;
    } else {
        return vec3<f32>(apply_curve(color.r, luma_curve, luma_curve_count, preserve_extended), apply_curve(color.g, luma_curve, luma_curve_count, preserve_extended), apply_curve(color.b, luma_curve, luma_curve_count, preserve_extended));
    }
}

fn get_mask_influence(mask_index: u32, coords: vec2<u32>) -> f32 {
    return textureLoad(mask_textures, vec2<i32>(coords), i32(mask_index), 0).r;
}

fn sample_lut_tetrahedral(uv: vec3<f32>) -> vec3<f32> {
    let dims = vec3<f32>(textureDimensions(lut_texture));
    let size = dims - vec3<f32>(1.0);
    let scaled = clamp(uv, vec3<f32>(0.0), vec3<f32>(1.0)) * size;
    let i_base = floor(scaled);
    let f = scaled - i_base;
    let coord0 = vec3<i32>(i_base);
    let coord1 = min(coord0 + vec3<i32>(1), vec3<i32>(dims) - vec3<i32>(1));
    let c000 = textureLoad(lut_texture, coord0, 0).rgb;
    let c111 = textureLoad(lut_texture, coord1, 0).rgb;

    var res = vec3<f32>(0.0);

    if (f.r > f.g) {
        if (f.g > f.b) {
            let c100 = textureLoad(lut_texture, vec3<i32>(coord1.x, coord0.y, coord0.z), 0).rgb;
            let c110 = textureLoad(lut_texture, vec3<i32>(coord1.x, coord1.y, coord0.z), 0).rgb;

            res = c000 * (1.0 - f.r) +
                  c100 * (f.r - f.g) +
                  c110 * (f.g - f.b) +
                  c111 * (f.b);
        } else if (f.r > f.b) {
            let c100 = textureLoad(lut_texture, vec3<i32>(coord1.x, coord0.y, coord0.z), 0).rgb;
            let c101 = textureLoad(lut_texture, vec3<i32>(coord1.x, coord0.y, coord1.z), 0).rgb;

            res = c000 * (1.0 - f.r) +
                  c100 * (f.r - f.b) +
                  c101 * (f.b - f.g) +
                  c111 * (f.g);
        } else {
            let c001 = textureLoad(lut_texture, vec3<i32>(coord0.x, coord0.y, coord1.z), 0).rgb;
            let c101 = textureLoad(lut_texture, vec3<i32>(coord1.x, coord0.y, coord1.z), 0).rgb;

            res = c000 * (1.0 - f.b) +
                  c001 * (f.b - f.r) +
                  c101 * (f.r - f.g) +
                  c111 * (f.g);
        }
    } else {
        if (f.b > f.g) {
            let c001 = textureLoad(lut_texture, vec3<i32>(coord0.x, coord0.y, coord1.z), 0).rgb;
            let c011 = textureLoad(lut_texture, vec3<i32>(coord0.x, coord1.y, coord1.z), 0).rgb;

            res = c000 * (1.0 - f.b) +
                  c001 * (f.b - f.g) +
                  c011 * (f.g - f.r) +
                  c111 * (f.r);
        } else if (f.b > f.r) {
            let c010 = textureLoad(lut_texture, vec3<i32>(coord0.x, coord1.y, coord0.z), 0).rgb;
            let c011 = textureLoad(lut_texture, vec3<i32>(coord0.x, coord1.y, coord1.z), 0).rgb;

            res = c000 * (1.0 - f.g) +
                  c010 * (f.g - f.b) +
                  c011 * (f.b - f.r) +
                  c111 * (f.r);
        } else {
            let c010 = textureLoad(lut_texture, vec3<i32>(coord0.x, coord1.y, coord0.z), 0).rgb;
            let c110 = textureLoad(lut_texture, vec3<i32>(coord1.x, coord1.y, coord0.z), 0).rgb;

            res = c000 * (1.0 - f.g) +
                  c010 * (f.g - f.r) +
                  c110 * (f.r - f.b) +
                  c111 * (f.b);
        }
    }

    return res;
}

fn apply_glow_bloom(
    color: vec3<f32>,
    blurred_color_input_space: vec3<f32>,
    amount: f32,
    is_raw: u32,
    exp: f32, bright: f32, con: f32, wh: f32
) -> vec3<f32> {
    if (amount <= 0.0) {
        return color;
    }

    var blurred_linear: vec3<f32>;
    if (is_raw == 1u) {
        blurred_linear = blurred_color_input_space;
    } else {
        blurred_linear = srgb_to_linear(blurred_color_input_space);
    }

    blurred_linear = apply_linear_exposure(blurred_linear, exp);
    blurred_linear = apply_filmic_exposure(blurred_linear, bright);
    blurred_linear = apply_tonal_adjustments(blurred_linear, blurred_color_input_space, is_raw, 0.0, 0.0, wh, 0.0);

    let linear_luma = scene_luminance(max(blurred_linear, vec3<f32>(0.0)));

    var perceptual_luma: f32;
    if (linear_luma <= 1.0) {
        perceptual_luma = pow(max(linear_luma, 0.0), 1.0 / 2.2);
    } else {
        perceptual_luma = 1.0 + pow(linear_luma - 1.0, 1.0 / 2.2);
    }

    let luma_cutoff = mix(0.75, 0.08, clamp(amount, 0.0, 1.0));

    let cutoff_fade = smoothstep(
        luma_cutoff,
        luma_cutoff + 0.15,
        perceptual_luma
    );

    let excess = max(perceptual_luma - luma_cutoff, 0.0);

    let falloff_range = 5.5;
    let normalized = excess / falloff_range;

    let bloom_intensity =
        pow(smoothstep(0.0, 1.0, normalized), 0.45);

    var bloom_color: vec3<f32>;
    if (linear_luma > 0.01) {
        let color_ratio = blurred_linear / linear_luma;
        let warm_tint = vec3<f32>(1.03, 1.0, 0.97);
        bloom_color = color_ratio * warm_tint;
    } else {
        bloom_color = vec3<f32>(1.0, 0.99, 0.98);
    }

    let luma_factor = pow(linear_luma, 0.6);

    let black_gate_width = 0.5;
    let black_gate_raw = smoothstep(0.0, black_gate_width, linear_luma);
    let black_gate = pow(black_gate_raw, 0.5);

    bloom_color *= bloom_intensity * luma_factor * cutoff_fade * black_gate;

    let current_luma = scene_luminance(max(color, vec3<f32>(0.0)));
    let protection = 1.0 - smoothstep(1.0, 2.2, current_luma);

    return color + bloom_color * amount * 3.8 * protection;
}

fn apply_halation(
    color: vec3<f32>,
    blurred_color_input_space: vec3<f32>,
    amount: f32,
    is_raw: u32,
    exp: f32, bright: f32, con: f32, wh: f32
) -> vec3<f32> {
    if (amount <= 0.0) { return color; }

    var blurred_linear: vec3<f32>;
    if (is_raw == 1u) {
        blurred_linear = blurred_color_input_space;
    } else {
        blurred_linear = srgb_to_linear(blurred_color_input_space);
    }

    blurred_linear = apply_linear_exposure(blurred_linear, exp);
    blurred_linear = apply_filmic_exposure(blurred_linear, bright);
    blurred_linear = apply_tonal_adjustments(blurred_linear, blurred_color_input_space, is_raw, 0.0, 0.0, wh, 0.0);

    let linear_luma = scene_luminance(max(blurred_linear, vec3<f32>(0.0)));

    var perceptual_luma: f32;
    if (linear_luma <= 1.0) {
        perceptual_luma = pow(max(linear_luma, 0.0), 1.0 / 2.2);
    } else {
        perceptual_luma = 1.0 + pow(linear_luma - 1.0, 1.0 / 2.2);
    }

    let luma_cutoff = mix(0.85, 0.1, clamp(amount, 0.0, 1.0));

    if (perceptual_luma <= luma_cutoff) { return color; }

    let excess = perceptual_luma - luma_cutoff;
    let range = max(1.5 - luma_cutoff, 0.1);
    let halation_mask = smoothstep(0.0, range * 0.6, excess);

    let halation_core = vec3<f32>(1.0, 0.15, 0.03);
    let halation_fringe = vec3<f32>(1.0, 0.32, 0.10);

    let intensity_blend = smoothstep(0.0, 0.7, halation_mask);
    let halation_tint = mix(halation_fringe, halation_core, intensity_blend);

    let glow_intensity = halation_mask * linear_luma;
    let halation_glow = halation_tint * glow_intensity;

    let color_luma = scene_luminance(max(color, vec3<f32>(0.0)));
    let desat_strength = halation_mask * 0.12;
    let affected_color = mix(color, vec3<f32>(color_luma), desat_strength);

    let contrast_reduced = mix(vec3<f32>(0.5), affected_color, 1.0 - halation_mask * 0.06);

    return contrast_reduced + halation_glow * amount * 2.5;
}

@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
    let out_dims = vec2<u32>(textureDimensions(output_texture));
    if (id.x >= out_dims.x || id.y >= out_dims.y) { return; }

    const REFERENCE_DIMENSION: f32 = 1080.0;
    let source_dims = select(
        textureDimensions(input_texture),
        vec2<u32>(adjustments.source_width, adjustments.source_height),
        adjustments.execution_phase >= 2u,
    );
    let full_dims = vec2<f32>(source_dims);
    let current_ref_dim = min(full_dims.x, full_dims.y);
    let scale = max(0.1, current_ref_dim / REFERENCE_DIMENSION);

    let absolute_coord = id.xy + vec2<u32>(adjustments.tile_offset_x, adjustments.tile_offset_y);
    let absolute_coord_i = vec2<i32>(absolute_coord);
    let scene_input_phase = adjustments.execution_phase <= 1u;
    let view_input_phase = adjustments.execution_phase == 2u;
    let view_execution_phase = adjustments.execution_phase == 0u || view_input_phase;
    let display_phase = adjustments.execution_phase == 3u;
    let input_coord = select(id.xy, absolute_coord, scene_input_phase);

    let ca_rc = adjustments.global.chromatic_aberration_red_cyan;
    let ca_by = adjustments.global.chromatic_aberration_blue_yellow;
    var color_from_texture = textureLoad(input_texture, input_coord, 0).rgb;
    if (scene_input_phase && (abs(ca_rc) > 0.000001 || abs(ca_by) > 0.000001)) {
        color_from_texture = apply_ca_correction(absolute_coord, ca_rc, ca_by);
    }
    let original_alpha = textureLoad(input_texture, input_coord, 0).a;

    var initial_linear_rgb: vec3<f32>;
    let is_raw = adjustments.global.is_raw_image;
    let preserve_scene_extended = adjustments.global.edit_graph_version >= 2.0;
    if (is_raw == 0u && scene_input_phase) {
        initial_linear_rgb = srgb_to_linear(color_from_texture);
    } else {
        initial_linear_rgb = color_from_texture;
    }
    // Technical illuminant correction is the first scene-linear color node.
    // Legacy temperature/tint remains a later creative operation and masks
    // never mutate this matrix.
    initial_linear_rgb = adjustments.global.technical_white_balance * initial_linear_rgb;

    var t_exposure = adjustments.global.exposure;
    var t_brightness = adjustments.global.brightness;
    var t_contrast = adjustments.global.contrast;
    var t_highlights = adjustments.global.highlights;
    var t_shadows = adjustments.global.shadows;
    var t_whites = adjustments.global.whites;
    var t_blacks = adjustments.global.blacks;
    var t_saturation = adjustments.global.saturation;
    var t_temperature = adjustments.global.temperature;
    var t_tint = adjustments.global.tint;
    var t_vibrance = adjustments.global.vibrance;
    var t_luma_nr = adjustments.global.luma_noise_reduction;
    var t_color_nr = adjustments.global.color_noise_reduction;
    var t_clarity = adjustments.global.clarity;
    var t_dehaze = adjustments.global.dehaze;
    var t_structure = adjustments.global.structure;
    var t_glow = adjustments.global.glow_amount;
    var t_halation = adjustments.global.halation_amount;
    var t_flare = adjustments.global.flare_amount;
    var t_sharpness = adjustments.global.sharpness;
    var t_hue = adjustments.global.hue;
    let global_tone_enabled = adjustments.global.tone_equalizer.params0.x > 0.5;
    var t_tone_bands0 = select(vec4<f32>(0.0), adjustments.global.tone_equalizer.bands0, global_tone_enabled);
    var t_tone_bands1 = select(vec4<f32>(0.0), adjustments.global.tone_equalizer.bands1, global_tone_enabled);
    var t_tone_bands2 = vec4<f32>(
        select(0.0, adjustments.global.tone_equalizer.bands2.x, global_tone_enabled),
        adjustments.global.tone_equalizer.bands2.y,
        0.0,
        0.0,
    );
    var t_tone_params0 = adjustments.global.tone_equalizer.params0;
    var t_tone_params1 = adjustments.global.tone_equalizer.params1;

    var h0_h = adjustments.global.hsl[0].hue; var h0_s = adjustments.global.hsl[0].saturation; var h0_l = adjustments.global.hsl[0].luminance;
    var h1_h = adjustments.global.hsl[1].hue; var h1_s = adjustments.global.hsl[1].saturation; var h1_l = adjustments.global.hsl[1].luminance;
    var h2_h = adjustments.global.hsl[2].hue; var h2_s = adjustments.global.hsl[2].saturation; var h2_l = adjustments.global.hsl[2].luminance;
    var h3_h = adjustments.global.hsl[3].hue; var h3_s = adjustments.global.hsl[3].saturation; var h3_l = adjustments.global.hsl[3].luminance;
    var h4_h = adjustments.global.hsl[4].hue; var h4_s = adjustments.global.hsl[4].saturation; var h4_l = adjustments.global.hsl[4].luminance;
    var h5_h = adjustments.global.hsl[5].hue; var h5_s = adjustments.global.hsl[5].saturation; var h5_l = adjustments.global.hsl[5].luminance;
    var h6_h = adjustments.global.hsl[6].hue; var h6_s = adjustments.global.hsl[6].saturation; var h6_l = adjustments.global.hsl[6].luminance;
    var h7_h = adjustments.global.hsl[7].hue; var h7_s = adjustments.global.hsl[7].saturation; var h7_l = adjustments.global.hsl[7].luminance;

    for (var i = 0u; i < adjustments.mask_count; i = i + 1u) {
        let influence = get_mask_influence(i, absolute_coord);
        if (influence > 0.001) {
            let m = adjustments.mask_adjustments[i];

            t_exposure += m.exposure * influence;
            t_brightness += m.brightness * influence;
            t_contrast += m.contrast * influence;
            t_highlights += m.highlights * influence;
            t_shadows += m.shadows * influence;
            t_whites += m.whites * influence;
            t_blacks += m.blacks * influence;

            t_saturation += m.saturation * influence;
            t_temperature += m.temperature * influence;
            t_tint += m.tint * influence;
            t_vibrance += m.vibrance * influence;

            t_luma_nr += m.luma_noise_reduction * influence;
            t_color_nr += m.color_noise_reduction * influence;
            t_clarity += m.clarity * influence;
            t_dehaze += m.dehaze * influence;
            t_structure += m.structure * influence;

            t_glow += m.glow_amount * influence;
            t_halation += m.halation_amount * influence;
            t_flare += m.flare_amount * influence;
            t_hue += m.hue * influence;

            if (m.tone_equalizer.params0.x > 0.5) {
                t_tone_bands0 += m.tone_equalizer.bands0 * influence;
                t_tone_bands1 += m.tone_equalizer.bands1 * influence;
                t_tone_bands2.x += m.tone_equalizer.bands2.x * influence;
                let local_tone_shape = mix(t_tone_params0.yzw, m.tone_equalizer.params0.yzw, vec3<f32>(influence));
                t_tone_params0 = vec4<f32>(t_tone_params0.x, local_tone_shape);
                t_tone_params1.x = mix(t_tone_params1.x, m.tone_equalizer.params1.x, influence);
                t_tone_params0.x = 1.0;
                t_tone_params1.z += m.tone_equalizer.params1.z * influence;
                if (m.tone_equalizer.params1.w > 0.5) {
                    t_tone_bands2.y = m.tone_equalizer.bands2.y;
                    t_tone_params1.w = m.tone_equalizer.params1.w;
                }
            }

            h0_h += m.hsl[0].hue * influence; h0_s += m.hsl[0].saturation * influence; h0_l += m.hsl[0].luminance * influence;
            h1_h += m.hsl[1].hue * influence; h1_s += m.hsl[1].saturation * influence; h1_l += m.hsl[1].luminance * influence;
            h2_h += m.hsl[2].hue * influence; h2_s += m.hsl[2].saturation * influence; h2_l += m.hsl[2].luminance * influence;
            h3_h += m.hsl[3].hue * influence; h3_s += m.hsl[3].saturation * influence; h3_l += m.hsl[3].luminance * influence;
            h4_h += m.hsl[4].hue * influence; h4_s += m.hsl[4].saturation * influence; h4_l += m.hsl[4].luminance * influence;
            h5_h += m.hsl[5].hue * influence; h5_s += m.hsl[5].saturation * influence; h5_l += m.hsl[5].luminance * influence;
            h6_h += m.hsl[6].hue * influence; h6_s += m.hsl[6].saturation * influence; h6_l += m.hsl[6].luminance * influence;
            h7_h += m.hsl[7].hue * influence; h7_s += m.hsl[7].saturation * influence; h7_l += m.hsl[7].luminance * influence;
        }
    }

    let final_hsl = array<HslColor, 8>(
        HslColor(h0_h, h0_s, h0_l, 0.0), HslColor(h1_h, h1_s, h1_l, 0.0),
        HslColor(h2_h, h2_s, h2_l, 0.0), HslColor(h3_h, h3_s, h3_l, 0.0),
        HslColor(h4_h, h4_s, h4_l, 0.0), HslColor(h5_h, h5_s, h5_l, 0.0),
        HslColor(h6_h, h6_s, h6_l, 0.0), HslColor(h7_h, h7_s, h7_l, 0.0)
    );

    var composite_rgb_linear = initial_linear_rgb;
    var tone_preview_rgb = vec3<f32>(-1.0);
    if (scene_input_phase) {
    initial_linear_rgb = apply_noise_reduction(
        initial_linear_rgb, absolute_coord_i,
        t_luma_nr, t_color_nr, scale, is_raw
    );

    var sharpness_blurred = initial_linear_rgb;
    var tonal_blurred = initial_linear_rgb;
    var clarity_blurred = initial_linear_rgb;
    var structure_blurred = initial_linear_rgb;
    if ((adjustments.blur_pass_flags & 1u) != 0u) {
        sharpness_blurred = textureLoad(sharpness_blur_texture, id.xy, 0).rgb;
    }
    if ((adjustments.blur_pass_flags & 2u) != 0u) {
        tonal_blurred = textureLoad(tonal_blur_texture, id.xy, 0).rgb;
    }
    if ((adjustments.blur_pass_flags & 4u) != 0u) {
        clarity_blurred = textureLoad(clarity_blur_texture, id.xy, 0).rgb;
    }
    if ((adjustments.blur_pass_flags & 8u) != 0u) {
        structure_blurred = textureLoad(structure_blur_texture, id.xy, 0).rgb;
    }

    var locally_contrasted_rgb = initial_linear_rgb;

    locally_contrasted_rgb = apply_local_contrast(
        locally_contrasted_rgb, sharpness_blurred,
        t_sharpness, is_raw, 0u, adjustments.global.sharpness_threshold
    );

    var sharpness_delta = vec3<f32>(0.0);
    for (var i = 0u; i < adjustments.mask_count; i = i + 1u) {
        let influence = get_mask_influence(i, absolute_coord);
        if (influence > 0.001) {
            let m = adjustments.mask_adjustments[i];
            if (abs(m.sharpness) > 0.001) {
                let local_sharp_result = apply_local_contrast(
                    initial_linear_rgb, sharpness_blurred,
                    m.sharpness, is_raw, 0u, m.sharpness_threshold
                );
                sharpness_delta += (local_sharp_result - initial_linear_rgb) * influence;
            }
        }
    }
    locally_contrasted_rgb += sharpness_delta;

    locally_contrasted_rgb = apply_local_contrast(locally_contrasted_rgb, clarity_blurred, t_clarity, is_raw, 1u, 0.0);
    locally_contrasted_rgb = apply_local_contrast(locally_contrasted_rgb, structure_blurred, t_structure, is_raw, 1u, 0.0);
    locally_contrasted_rgb = apply_centre_local_contrast(locally_contrasted_rgb, adjustments.global.centre, absolute_coord_i, clarity_blurred, is_raw);

    var processed_rgb = apply_linear_exposure(locally_contrasted_rgb, t_exposure);

    if (t_glow > 0.0) {
        processed_rgb = apply_glow_bloom(
            processed_rgb, structure_blurred, t_glow, is_raw,
            t_exposure, t_brightness, t_contrast, t_whites
        );
    }
    if (t_halation > 0.0) {
        processed_rgb = apply_halation(
            processed_rgb, clarity_blurred, t_halation, is_raw,
            t_exposure, t_brightness, t_contrast, t_whites
        );
    }
    if (t_flare > 0.0) {
        let uv = vec2<f32>(absolute_coord) / full_dims;
        var flare_color = textureSampleLevel(flare_texture, flare_sampler, uv, 0.0).rgb;
        flare_color *= 1.4;
        flare_color = flare_color * flare_color;
        let linear_luma = scene_luminance(max(processed_rgb, vec3<f32>(0.0)));
        var perceptual_luma: f32;
        if (linear_luma <= 1.0) {
            perceptual_luma = pow(max(linear_luma, 0.0), 1.0 / 2.2);
        } else {
            perceptual_luma = 1.0 + pow(linear_luma - 1.0, 1.0 / 2.2);
        }
        let protection = 1.0 - smoothstep(0.7, 1.8, perceptual_luma);
        processed_rgb += flare_color * t_flare * protection;
    }

    let dehaze_atmosphere = vec3<f32>(
        adjustments.global.dehaze_atmosphere_r,
        adjustments.global.dehaze_atmosphere_g,
        adjustments.global.dehaze_atmosphere_b,
    );
    if (adjustments.global.edit_graph_version >= 2.0) {
        composite_rgb_linear = apply_scene_dehaze_v1(
            processed_rgb,
            structure_blurred,
            is_raw,
            t_dehaze,
            dehaze_atmosphere,
            adjustments.global.dehaze_atmosphere_confidence,
        );
    } else {
        composite_rgb_linear = legacy_fixed_atmosphere_dehaze_v1(
            processed_rgb,
            structure_blurred,
            is_raw,
            t_dehaze,
        );
    }
    composite_rgb_linear = apply_centre_tonal_and_color(composite_rgb_linear, adjustments.global.centre, absolute_coord_i);
    composite_rgb_linear = apply_white_balance(composite_rgb_linear, t_temperature, t_tint);
    if (preserve_scene_extended) {
        let tone_coordinate_source = apply_linear_exposure(initial_linear_rgb, adjustments.global.exposure);
        let tone_guidance_linear = select(srgb_to_linear(tonal_blurred), tonal_blurred, is_raw == 1u);
        let tone_guidance = apply_linear_exposure(tone_guidance_linear, adjustments.global.exposure);
        composite_rgb_linear = apply_tone_equalizer(
            composite_rgb_linear, tone_coordinate_source, tone_guidance,
            t_tone_bands0, t_tone_bands1, t_tone_bands2,
            t_tone_params0, t_tone_params1,
            t_brightness, t_contrast, t_highlights, t_shadows, t_whites, t_blacks,
        );
        let tone_preview_mode = u32(max(t_tone_params1.w, 0.0));
        if (tone_preview_mode > 0u) {
            let middle_grey = max(adjustments.global.rapid_view_parameters0.x, 1.0e-8);
            let source_ev = log2(max(scene_luminance(tone_coordinate_source), 1.0e-8) / middle_grey);
            let smoothed_ev = log2(max(scene_luminance(tone_guidance), 1.0e-8) / middle_grey);
            let edge_delta = abs(source_ev - smoothed_ev);
            let edge_weight = 1.0 - exp(-edge_delta * clamp(t_tone_params1.x, 0.0, 8.0));
            let source_weight = clamp(t_tone_params0.w, 0.0, 1.0)
                + edge_weight * (1.0 - clamp(t_tone_params0.w, 0.0, 1.0));
            let guidance_ev = mix(smoothed_ev, source_ev, source_weight);
            if (tone_preview_mode == 1u) {
                tone_preview_rgb = tone_equalizer_false_color(guidance_ev, t_tone_params0.y, t_tone_params0.z);
            } else if (tone_preview_mode == 2u) {
                let weight = tone_equalizer_band_weight(guidance_ev, u32(max(t_tone_bands2.y, 0.0)), t_tone_params0);
                tone_preview_rgb = vec3<f32>(weight);
            } else if (tone_preview_mode == 3u) {
                let source_map = clamp((source_ev + 12.0) / 24.0, 0.0, 1.0);
                let filtered_map = clamp((guidance_ev + 12.0) / 24.0, 0.0, 1.0);
                tone_preview_rgb = vec3<f32>(source_map, filtered_map, clamp(abs(source_ev - guidance_ev) / 4.0, 0.0, 1.0));
            } else {
                let source_max = max(tone_coordinate_source.r, max(tone_coordinate_source.g, tone_coordinate_source.b));
                let source_luma = scene_luminance(tone_coordinate_source);
                tone_preview_rgb = select(
                    select(vec3<f32>(0.12), vec3<f32>(0.05, 0.2, 1.0), source_luma <= 1.0e-8),
                    vec3<f32>(1.0, 0.05, 0.02),
                    source_max >= 1.0,
                );
            }
        }
    } else {
        composite_rgb_linear = apply_filmic_exposure(composite_rgb_linear, t_brightness);
        composite_rgb_linear = apply_tonal_adjustments(composite_rgb_linear, tonal_blurred, is_raw, t_contrast, t_shadows, t_whites, t_blacks);
        composite_rgb_linear = apply_highlights_adjustment(composite_rgb_linear, tonal_blurred, is_raw, t_highlights);
    }
    composite_rgb_linear = apply_color_calibration(composite_rgb_linear, adjustments.global.color_calibration);
    composite_rgb_linear = apply_hsl_panel(composite_rgb_linear, final_hsl, absolute_coord_i);
    composite_rgb_linear = apply_point_color(composite_rgb_linear, adjustments.global.point_color);
    for (var i = 0u; i < adjustments.mask_count; i += 1u) {
        let influence = get_mask_influence(i, absolute_coord);
        if (influence > 0.001) {
            let local_point_color = apply_point_color(composite_rgb_linear, adjustments.mask_adjustments[i].point_color);
            composite_rgb_linear = mix(composite_rgb_linear, local_point_color, influence);
        }
    }
    composite_rgb_linear = apply_hue_shift(composite_rgb_linear, t_hue);
    composite_rgb_linear = apply_creative_color(composite_rgb_linear, t_saturation, t_vibrance);
    composite_rgb_linear = apply_color_balance_rgb(composite_rgb_linear, adjustments.global.color_balance_rgb, preserve_scene_extended);
    composite_rgb_linear = apply_channel_mixer(composite_rgb_linear, adjustments.global.channel_mixer, preserve_scene_extended);
    composite_rgb_linear = apply_luma_levels(composite_rgb_linear, adjustments.global.levels, preserve_scene_extended);

    composite_rgb_linear = apply_color_grading(
        composite_rgb_linear,
        adjustments.global.color_grading_shadows,
        adjustments.global.color_grading_midtones,
        adjustments.global.color_grading_highlights,
        adjustments.global.color_grading_global,
        adjustments.global.color_grading_blending,
        adjustments.global.color_grading_balance
    );

    for (var i = 0u; i < adjustments.mask_count; i = i + 1u) {
        let influence = get_mask_influence(i, absolute_coord);
        if (influence > 0.001) {
            let m = adjustments.mask_adjustments[i];
            let mask_graded = apply_color_grading(
                composite_rgb_linear,
                m.color_grading_shadows, m.color_grading_midtones, m.color_grading_highlights, m.color_grading_global, m.color_grading_blending, m.color_grading_balance
            );
            composite_rgb_linear = blend_mask_layer(composite_rgb_linear, mask_graded, influence, m.blend_mode);
        }
    }

    composite_rgb_linear = apply_black_white_mixer(composite_rgb_linear, adjustments.global.black_white_mixer, preserve_scene_extended);

    if (adjustments.global.vignette_amount != 0.0) {
        let full_dims_f = vec2<f32>(textureDimensions(input_texture));
        let coord_f = vec2<f32>(absolute_coord);
        let v_amount = adjustments.global.vignette_amount;
        let v_mid = adjustments.global.vignette_midpoint;
        let v_round = 1.0 - adjustments.global.vignette_roundness;
        let v_feather = adjustments.global.vignette_feather * 0.5;
        let aspect = full_dims_f.y / full_dims_f.x;
        let uv_centered = (coord_f / full_dims_f - 0.5) * 2.0;
        let uv_round = sign(uv_centered) * pow(abs(uv_centered), vec2<f32>(v_round, v_round));
        let d = length(uv_round * vec2<f32>(1.0, aspect)) * 0.5;
        let vignette_mask = smoothstep(v_mid - v_feather, v_mid + v_feather, d);
        if (v_amount < 0.0) {
            composite_rgb_linear *= (1.0 + v_amount * vignette_mask);
        } else {
            composite_rgb_linear = mix(composite_rgb_linear, vec3<f32>(1.0), v_amount * vignette_mask);
        }
    }
    }

    if (tone_preview_rgb.x >= 0.0) {
        composite_rgb_linear = tone_preview_rgb;
    }

    if (adjustments.execution_phase == 1u) {
        textureStore(output_texture, id.xy, vec4<f32>(composite_rgb_linear, original_alpha));
        return;
    }

    var base_srgb = color_from_texture;
    if (view_execution_phase && adjustments.global.tonemapper_mode == 2u) {
        base_srgb = rapid_view_encode_signed(rapid_view_transform(composite_rgb_linear));
    } else if (view_execution_phase && adjustments.global.tonemapper_mode == 1u) {
        base_srgb = agx_full_transform(composite_rgb_linear);
    } else if (view_execution_phase && is_raw == 1u) {
        var srgb_emulated = select(
            linear_to_srgb(composite_rgb_linear),
            linear_to_srgb_extended(composite_rgb_linear),
            preserve_scene_extended,
        );
        const BRIGHTNESS_GAMMA: f32 = 1.1;
        srgb_emulated = pow(srgb_emulated, vec3<f32>(1.0 / BRIGHTNESS_GAMMA));
        const CONTRAST_MIX: f32 = 0.75;
        let contrast_curve = srgb_emulated * srgb_emulated * (3.0 - 2.0 * srgb_emulated);
        base_srgb = mix(srgb_emulated, contrast_curve, CONTRAST_MIX);
    } else if (view_execution_phase) {
        base_srgb = select(
            linear_to_srgb(composite_rgb_linear),
            linear_to_srgb_extended(composite_rgb_linear),
            preserve_scene_extended,
        );
    }

    if (view_input_phase) {
        textureStore(output_texture, id.xy, vec4<f32>(base_srgb, original_alpha));
        return;
    }

    var final_rgb = apply_all_curves(base_srgb,
        adjustments.global.luma_curve, adjustments.global.luma_curve_count,
        adjustments.global.red_curve, adjustments.global.red_curve_count,
        adjustments.global.green_curve, adjustments.global.green_curve_count,
        adjustments.global.blue_curve, adjustments.global.blue_curve_count,
        preserve_scene_extended
    );

    for (var i = 0u; i < adjustments.mask_count; i = i + 1u) {
        let influence = get_mask_influence(i, absolute_coord);
        if (influence > 0.001) {
            let m = adjustments.mask_adjustments[i];
            let mask_curved_srgb = apply_all_curves(final_rgb,
                m.luma_curve, m.luma_curve_count,
                m.red_curve, m.red_curve_count,
                m.green_curve, m.green_curve_count,
                m.blue_curve, m.blue_curve_count,
                preserve_scene_extended
            );
            final_rgb = blend_mask_layer(final_rgb, mask_curved_srgb, influence, m.blend_mode);
        }
    }

    if (adjustments.global.has_lut == 1u) {
        let lut_color = sample_lut_tetrahedral(final_rgb);
        final_rgb = mix(final_rgb, lut_color, adjustments.global.lut_intensity);
    }

    if (adjustments.global.grain_amount > 0.0) {
        let coord = vec2<f32>(absolute_coord_i);
        let amount = adjustments.global.grain_amount * 0.5;
        let grain_frequency = (1.0 / max(adjustments.global.grain_size, 0.1)) / scale;
        let roughness = adjustments.global.grain_roughness;
        let luma = max(0.0, view_encoded_luma(final_rgb));
        let luma_mask = smoothstep(0.0, 0.15, luma) * (1.0 - smoothstep(0.6, 1.0, luma));
        let base_coord = coord * grain_frequency;
        let rough_coord = coord * grain_frequency * 0.6;
        let noise_base = gradient_noise(base_coord);
        let noise_rough = gradient_noise(rough_coord + vec2<f32>(5.2, 1.3));
        let noise_val = mix(noise_base, noise_rough, roughness);
        final_rgb += vec3<f32>(noise_val) * amount * luma_mask;
    }

    if (adjustments.global.show_clipping == 1u) {
        let HIGHLIGHT_WARNING_COLOR = vec3<f32>(1.0, 0.0, 0.0);
        let SHADOW_WARNING_COLOR = vec3<f32>(0.0, 0.0, 1.0);
        let HIGHLIGHT_CLIP_THRESHOLD = 0.998;
        let SHADOW_CLIP_THRESHOLD = 0.002;
        if (any(final_rgb > vec3<f32>(HIGHLIGHT_CLIP_THRESHOLD))) {
            final_rgb = HIGHLIGHT_WARNING_COLOR;
        } else if (any(final_rgb < vec3<f32>(SHADOW_CLIP_THRESHOLD))) {
            final_rgb = SHADOW_WARNING_COLOR;
        }
    }

    let dither_amount = 1.0 / 255.0;
    final_rgb += dither(absolute_coord) * dither_amount;

    textureStore(output_texture, id.xy, vec4<f32>(final_rgb, original_alpha));
}
