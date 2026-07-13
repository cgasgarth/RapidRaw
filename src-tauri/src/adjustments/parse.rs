use crate::adjustments::abi::{
    AllAdjustments, BlackWhiteMixerSettings, ChannelMixerRow, ChannelMixerSettings,
    ColorBalanceRgbSettings, ColorCalibrationSettings, ColorGradeSettings, GlobalAdjustments,
    GpuMat3, HslColor, LevelsSettings, MAX_MASKS, MaskAdjustments, Point,
};
use crate::adjustments::scales::SCALES;
use crate::color::white_balance::{WhiteBalancePlanInputV1, compile_white_balance_plan};
use crate::image_processing::calculate_agx_matrices;
use crate::mask_generation::MaskDefinition;
use serde::Deserialize;

type JsonValue = serde_json::Value;

fn section_is_visible(value: &JsonValue, section: &str) -> bool {
    value
        .get("sectionVisibility")
        .and_then(|v| v.get(section))
        .and_then(|s| s.as_bool())
        .unwrap_or(true)
}

fn scaled_section_value(
    value: &JsonValue,
    section: &str,
    key: &str,
    scale: f32,
    default: Option<f64>,
) -> f32 {
    if section_is_visible(value, section) {
        value[key].as_f64().unwrap_or(default.unwrap_or(0.0)) as f32 / scale
    } else if let Some(default) = default {
        default as f32 / scale
    } else {
        0.0
    }
}

fn technical_white_balance_from_json(value: &JsonValue) -> GpuMat3 {
    if !section_is_visible(value, "color") {
        return GpuMat3::default();
    }
    let Some(settings) = value
        .get("whiteBalanceTechnical")
        .and_then(JsonValue::as_object)
    else {
        return GpuMat3::default();
    };
    let Ok(input) =
        serde_json::from_value::<WhiteBalancePlanInputV1>(JsonValue::Object(settings.clone()))
    else {
        return GpuMat3::default();
    };
    let Ok(plan) = compile_white_balance_plan(input) else {
        return GpuMat3::default();
    };
    let rows = plan.ap1_matrix;
    GpuMat3 {
        col0: [rows[0][0], rows[1][0], rows[2][0], 0.0],
        col1: [rows[0][1], rows[1][1], rows[2][1], 0.0],
        col2: [rows[0][2], rows[1][2], rows[2][2], 0.0],
    }
}

fn parse_hsl_adjustments(js_hsl: &JsonValue) -> [HslColor; 8] {
    let mut hsl_array = [HslColor::default(); 8];
    if let Some(hsl_map) = js_hsl.as_object() {
        let color_map = [
            ("reds", 0),
            ("oranges", 1),
            ("yellows", 2),
            ("greens", 3),
            ("aquas", 4),
            ("blues", 5),
            ("purples", 6),
            ("magentas", 7),
        ];
        for (name, index) in color_map.iter() {
            if let Some(color_data) = hsl_map.get(*name) {
                hsl_array[*index] = HslColor {
                    hue: color_data["hue"].as_f64().unwrap_or(0.0) as f32
                        * SCALES.hsl_hue_multiplier,
                    saturation: color_data["saturation"].as_f64().unwrap_or(0.0) as f32
                        / SCALES.hsl_saturation,
                    luminance: color_data["luminance"].as_f64().unwrap_or(0.0) as f32
                        / SCALES.hsl_luminance,
                    _pad: 0.0,
                };
            }
        }
    }
    hsl_array
}

fn parse_color_grade_settings(js_cg: &JsonValue) -> ColorGradeSettings {
    if js_cg.is_null() {
        return ColorGradeSettings::default();
    }
    ColorGradeSettings {
        hue: js_cg["hue"].as_f64().unwrap_or(0.0) as f32,
        saturation: js_cg["saturation"].as_f64().unwrap_or(0.0) as f32
            / SCALES.color_grading_saturation,
        luminance: js_cg["luminance"].as_f64().unwrap_or(0.0) as f32
            / SCALES.color_grading_luminance,
        _pad: 0.0,
    }
}

fn parse_channel_mixer_row(row: &JsonValue, red: f32, green: f32, blue: f32) -> ChannelMixerRow {
    ChannelMixerRow {
        red: row["red"].as_f64().unwrap_or(red as f64) as f32 / 100.0,
        green: row["green"].as_f64().unwrap_or(green as f64) as f32 / 100.0,
        blue: row["blue"].as_f64().unwrap_or(blue as f64) as f32 / 100.0,
        constant: row["constant"].as_f64().unwrap_or(0.0) as f32 / 100.0,
    }
}

fn parse_channel_mixer_settings(js_channel_mixer: &JsonValue) -> ChannelMixerSettings {
    ChannelMixerSettings {
        red: parse_channel_mixer_row(&js_channel_mixer["red"], 100.0, 0.0, 0.0),
        green: parse_channel_mixer_row(&js_channel_mixer["green"], 0.0, 100.0, 0.0),
        blue: parse_channel_mixer_row(&js_channel_mixer["blue"], 0.0, 0.0, 100.0),
        enabled: u32::from(js_channel_mixer["enabled"].as_bool().unwrap_or(false)),
        preserve_luminance: u32::from(
            js_channel_mixer["preserveLuminance"]
                .as_bool()
                .unwrap_or(false),
        ),
        _pad1: 0,
        _pad2: 0,
    }
}

fn parse_black_white_mixer_settings(js_black_white_mixer: &JsonValue) -> BlackWhiteMixerSettings {
    BlackWhiteMixerSettings {
        reds: js_black_white_mixer["weights"]["reds"]
            .as_f64()
            .unwrap_or(0.0) as f32
            / 100.0,
        oranges: js_black_white_mixer["weights"]["oranges"]
            .as_f64()
            .unwrap_or(0.0) as f32
            / 100.0,
        yellows: js_black_white_mixer["weights"]["yellows"]
            .as_f64()
            .unwrap_or(0.0) as f32
            / 100.0,
        greens: js_black_white_mixer["weights"]["greens"]
            .as_f64()
            .unwrap_or(0.0) as f32
            / 100.0,
        aquas: js_black_white_mixer["weights"]["aquas"]
            .as_f64()
            .unwrap_or(0.0) as f32
            / 100.0,
        blues: js_black_white_mixer["weights"]["blues"]
            .as_f64()
            .unwrap_or(0.0) as f32
            / 100.0,
        purples: js_black_white_mixer["weights"]["purples"]
            .as_f64()
            .unwrap_or(0.0) as f32
            / 100.0,
        magentas: js_black_white_mixer["weights"]["magentas"]
            .as_f64()
            .unwrap_or(0.0) as f32
            / 100.0,
        enabled: u32::from(js_black_white_mixer["enabled"].as_bool().unwrap_or(false)),
        _pad1: 0,
        _pad2: 0,
        _pad3: 0,
    }
}

fn parse_levels_settings(js_levels: &JsonValue) -> LevelsSettings {
    let input_black = js_levels["inputBlack"].as_f64().unwrap_or(0.0) as f32;
    let input_white = js_levels["inputWhite"].as_f64().unwrap_or(1.0) as f32;
    let output_black = js_levels["outputBlack"].as_f64().unwrap_or(0.0) as f32;
    let output_white = js_levels["outputWhite"].as_f64().unwrap_or(1.0) as f32;

    LevelsSettings {
        input_black: input_black.clamp(0.0, 0.99),
        input_white: input_white.clamp(0.01, 1.0),
        gamma: (js_levels["gamma"].as_f64().unwrap_or(1.0) as f32).clamp(0.1, 5.0),
        output_black: output_black.clamp(0.0, 0.99),
        output_white: output_white.clamp(0.01, 1.0),
        enabled: u32::from(js_levels["enabled"].as_bool().unwrap_or(false)),
        _pad1: 0,
        _pad2: 0,
    }
}

fn parse_color_balance_rgb_range(js_range: &JsonValue) -> [f32; 4] {
    [
        js_range["red"].as_f64().unwrap_or(0.0) as f32,
        js_range["green"].as_f64().unwrap_or(0.0) as f32,
        js_range["blue"].as_f64().unwrap_or(0.0) as f32,
        0.0,
    ]
}

fn parse_color_balance_rgb_settings(js_color_balance: &JsonValue) -> ColorBalanceRgbSettings {
    ColorBalanceRgbSettings {
        shadows: parse_color_balance_rgb_range(&js_color_balance["shadows"]),
        midtones: parse_color_balance_rgb_range(&js_color_balance["midtones"]),
        highlights: parse_color_balance_rgb_range(&js_color_balance["highlights"]),
        enabled: u32::from(js_color_balance["enabled"].as_bool().unwrap_or(false)),
        preserve_luminance: u32::from(
            js_color_balance["preserveLuminance"]
                .as_bool()
                .unwrap_or(true),
        ),
        _pad1: 0,
        _pad2: 0,
    }
}

fn convert_points_to_aligned(frontend_points: Vec<JsonValue>) -> [Point; 16] {
    let mut aligned_points = [Point::default(); 16];
    for (i, point) in frontend_points.iter().enumerate().take(16) {
        if let (Some(x), Some(y)) = (point["x"].as_f64(), point["y"].as_f64()) {
            aligned_points[i] = Point {
                x: x as f32,
                y: y as f32,
                _pad1: 0.0,
                _pad2: 0.0,
            };
        }
    }
    aligned_points
}

fn curve_points(
    value: &JsonValue,
    curves: &JsonValue,
    name: &str,
    default_curve: &JsonValue,
) -> Vec<JsonValue> {
    if section_is_visible(value, "curves") {
        curves
            .get(name)
            .unwrap_or(default_curve)
            .as_array()
            .cloned()
            .unwrap_or_default()
    } else {
        Vec::new()
    }
}

fn get_global_adjustments_from_json(
    js_adjustments: &JsonValue,
    is_raw: bool,
    tonemapper_override: Option<u32>,
) -> GlobalAdjustments {
    let default_curve = serde_json::json!([{"x": 0.0, "y": 0.0}, {"x": 255.0, "y": 255.0}]);
    let curves_obj = js_adjustments.get("curves").cloned().unwrap_or_default();
    let luma_points = curve_points(js_adjustments, &curves_obj, "luma", &default_curve);
    let red_points = curve_points(js_adjustments, &curves_obj, "red", &default_curve);
    let green_points = curve_points(js_adjustments, &curves_obj, "green", &default_curve);
    let blue_points = curve_points(js_adjustments, &curves_obj, "blue", &default_curve);

    let cg_obj = js_adjustments
        .get("colorGrading")
        .cloned()
        .unwrap_or_default();
    let cal_obj = js_adjustments
        .get("colorCalibration")
        .cloned()
        .unwrap_or_default();
    let channel_mixer_obj = js_adjustments
        .get("channelMixer")
        .cloned()
        .unwrap_or_default();
    let black_white_mixer_obj = js_adjustments
        .get("blackWhiteMixer")
        .cloned()
        .unwrap_or_default();
    let color_balance_obj = js_adjustments
        .get("colorBalanceRgb")
        .cloned()
        .unwrap_or_default();
    let levels_obj = js_adjustments.get("levels").cloned().unwrap_or_default();

    let color_cal_settings = if section_is_visible(js_adjustments, "color") {
        ColorCalibrationSettings {
            shadows_tint: cal_obj["shadowsTint"].as_f64().unwrap_or(0.0) as f32
                / SCALES.color_calibration_hue,
            red_hue: cal_obj["redHue"].as_f64().unwrap_or(0.0) as f32
                / SCALES.color_calibration_hue,
            red_saturation: cal_obj["redSaturation"].as_f64().unwrap_or(0.0) as f32
                / SCALES.color_calibration_saturation,
            green_hue: cal_obj["greenHue"].as_f64().unwrap_or(0.0) as f32
                / SCALES.color_calibration_hue,
            green_saturation: cal_obj["greenSaturation"].as_f64().unwrap_or(0.0) as f32
                / SCALES.color_calibration_saturation,
            blue_hue: cal_obj["blueHue"].as_f64().unwrap_or(0.0) as f32
                / SCALES.color_calibration_hue,
            blue_saturation: cal_obj["blueSaturation"].as_f64().unwrap_or(0.0) as f32
                / SCALES.color_calibration_saturation,
            _pad1: 0.0,
        }
    } else {
        ColorCalibrationSettings::default()
    };

    let tone_mapper = js_adjustments["toneMapper"].as_str().unwrap_or("basic");
    let (pipe_to_rendering, rendering_to_pipe) = calculate_agx_matrices();
    let (has_lut, lut_intensity) = if section_is_visible(js_adjustments, "effects") {
        (
            u32::from(js_adjustments["lutPath"].is_string()),
            js_adjustments["lutIntensity"].as_f64().unwrap_or(100.0) as f32 / 100.0,
        )
    } else {
        (0, 1.0)
    };

    GlobalAdjustments {
        exposure: scaled_section_value(js_adjustments, "basic", "exposure", SCALES.exposure, None),
        brightness: scaled_section_value(
            js_adjustments,
            "basic",
            "brightness",
            SCALES.brightness,
            None,
        ),
        contrast: scaled_section_value(js_adjustments, "basic", "contrast", SCALES.contrast, None),
        highlights: scaled_section_value(
            js_adjustments,
            "basic",
            "highlights",
            SCALES.highlights,
            None,
        ),
        shadows: scaled_section_value(js_adjustments, "basic", "shadows", SCALES.shadows, None),
        whites: scaled_section_value(js_adjustments, "basic", "whites", SCALES.whites, None),
        blacks: scaled_section_value(js_adjustments, "basic", "blacks", SCALES.blacks, None),
        saturation: scaled_section_value(
            js_adjustments,
            "color",
            "saturation",
            SCALES.saturation,
            None,
        ),
        temperature: scaled_section_value(
            js_adjustments,
            "color",
            if js_adjustments.get("whiteBalanceTechnical").is_some() {
                "creativeTemperature"
            } else {
                "temperature"
            },
            SCALES.temperature,
            None,
        ),
        tint: scaled_section_value(
            js_adjustments,
            "color",
            if js_adjustments.get("whiteBalanceTechnical").is_some() {
                "creativeTint"
            } else {
                "tint"
            },
            SCALES.tint,
            None,
        ),
        vibrance: scaled_section_value(js_adjustments, "color", "vibrance", SCALES.vibrance, None),
        hue: scaled_section_value(js_adjustments, "color", "hue", 1.0, None),
        _pad_color1: 0.0,
        _pad_color2: 0.0,
        _pad_color3: 0.0,
        _pad_color4: 0.0,
        technical_white_balance: technical_white_balance_from_json(js_adjustments),
        sharpness: scaled_section_value(
            js_adjustments,
            "details",
            "sharpness",
            SCALES.sharpness,
            None,
        ),
        luma_noise_reduction: scaled_section_value(
            js_adjustments,
            "details",
            "lumaNoiseReduction",
            SCALES.luma_noise_reduction,
            None,
        ),
        color_noise_reduction: scaled_section_value(
            js_adjustments,
            "details",
            "colorNoiseReduction",
            SCALES.color_noise_reduction,
            None,
        ),
        clarity: scaled_section_value(js_adjustments, "details", "clarity", SCALES.clarity, None),
        dehaze: scaled_section_value(js_adjustments, "details", "dehaze", SCALES.dehaze, None),
        structure: scaled_section_value(
            js_adjustments,
            "details",
            "structure",
            SCALES.structure,
            None,
        ),
        centré: scaled_section_value(js_adjustments, "details", "centré", SCALES.centré, None),
        vignette_amount: scaled_section_value(
            js_adjustments,
            "effects",
            "vignetteAmount",
            SCALES.vignette_amount,
            None,
        ),
        vignette_midpoint: scaled_section_value(
            js_adjustments,
            "effects",
            "vignetteMidpoint",
            SCALES.vignette_midpoint,
            Some(50.0),
        ),
        vignette_roundness: scaled_section_value(
            js_adjustments,
            "effects",
            "vignetteRoundness",
            SCALES.vignette_roundness,
            Some(0.0),
        ),
        vignette_feather: scaled_section_value(
            js_adjustments,
            "effects",
            "vignetteFeather",
            SCALES.vignette_feather,
            Some(50.0),
        ),
        grain_amount: scaled_section_value(
            js_adjustments,
            "effects",
            "grainAmount",
            SCALES.grain_amount,
            None,
        ),
        grain_size: scaled_section_value(
            js_adjustments,
            "effects",
            "grainSize",
            SCALES.grain_size,
            Some(25.0),
        ),
        grain_roughness: scaled_section_value(
            js_adjustments,
            "effects",
            "grainRoughness",
            SCALES.grain_roughness,
            Some(50.0),
        ),
        chromatic_aberration_red_cyan: scaled_section_value(
            js_adjustments,
            "details",
            "chromaticAberrationRedCyan",
            SCALES.chromatic_aberration,
            None,
        ),
        chromatic_aberration_blue_yellow: scaled_section_value(
            js_adjustments,
            "details",
            "chromaticAberrationBlueYellow",
            SCALES.chromatic_aberration,
            None,
        ),
        show_clipping: u32::from(js_adjustments["showClipping"].as_bool().unwrap_or(false)),
        is_raw_image: u32::from(is_raw),
        _pad_ca1: 0.0,
        has_lut,
        lut_intensity,
        tonemapper_mode: tonemapper_override
            .unwrap_or_else(|| if tone_mapper == "agx" { 1 } else { 0 }),
        _pad_lut2: 0.0,
        _pad_lut3: 0.0,
        _pad_lut4: 0.0,
        _pad_lut5: 0.0,
        _pad_agx1: 0.0,
        _pad_agx2: 0.0,
        _pad_agx3: 0.0,
        _pad_wgsl_agx_align1: 0.0,
        _pad_wgsl_agx_align2: 0.0,
        _pad_wgsl_agx_align3: 0.0,
        agx_pipe_to_rendering_matrix: pipe_to_rendering,
        agx_rendering_to_pipe_matrix: rendering_to_pipe,
        _pad_cg1: 0.0,
        _pad_cg2: 0.0,
        _pad_cg3: 0.0,
        _pad_cg4: 0.0,
        color_grading_shadows: if section_is_visible(js_adjustments, "color") {
            parse_color_grade_settings(&cg_obj["shadows"])
        } else {
            ColorGradeSettings::default()
        },
        color_grading_midtones: if section_is_visible(js_adjustments, "color") {
            parse_color_grade_settings(&cg_obj["midtones"])
        } else {
            ColorGradeSettings::default()
        },
        color_grading_highlights: if section_is_visible(js_adjustments, "color") {
            parse_color_grade_settings(&cg_obj["highlights"])
        } else {
            ColorGradeSettings::default()
        },
        color_grading_global: if section_is_visible(js_adjustments, "color") {
            parse_color_grade_settings(&cg_obj["global"])
        } else {
            ColorGradeSettings::default()
        },
        color_grading_blending: if section_is_visible(js_adjustments, "color") {
            cg_obj["blending"].as_f64().unwrap_or(50.0) as f32 / SCALES.color_grading_blending
        } else {
            0.5
        },
        color_grading_balance: if section_is_visible(js_adjustments, "color") {
            cg_obj["balance"].as_f64().unwrap_or(0.0) as f32 / SCALES.color_grading_balance
        } else {
            0.0
        },
        _pad2: 0.0,
        _pad3: 0.0,
        color_calibration: color_cal_settings,
        color_balance_rgb: if section_is_visible(js_adjustments, "color") {
            parse_color_balance_rgb_settings(&color_balance_obj)
        } else {
            ColorBalanceRgbSettings::default()
        },
        channel_mixer: if section_is_visible(js_adjustments, "color") {
            parse_channel_mixer_settings(&channel_mixer_obj)
        } else {
            ChannelMixerSettings::default()
        },
        black_white_mixer: if section_is_visible(js_adjustments, "color") {
            parse_black_white_mixer_settings(&black_white_mixer_obj)
        } else {
            BlackWhiteMixerSettings::default()
        },
        levels: if section_is_visible(js_adjustments, "color") {
            parse_levels_settings(&levels_obj)
        } else {
            LevelsSettings::default()
        },
        hsl: if section_is_visible(js_adjustments, "color") {
            parse_hsl_adjustments(&js_adjustments.get("hsl").cloned().unwrap_or_default())
        } else {
            [HslColor::default(); 8]
        },
        luma_curve: convert_points_to_aligned(luma_points.clone()),
        red_curve: convert_points_to_aligned(red_points.clone()),
        green_curve: convert_points_to_aligned(green_points.clone()),
        blue_curve: convert_points_to_aligned(blue_points.clone()),
        luma_curve_count: luma_points.len() as u32,
        red_curve_count: red_points.len() as u32,
        green_curve_count: green_points.len() as u32,
        blue_curve_count: blue_points.len() as u32,
        _pad_end1: 0.0,
        _pad_end2: 0.0,
        _pad_end3: 0.0,
        _pad_end4: 0.0,
        glow_amount: scaled_section_value(
            js_adjustments,
            "effects",
            "glowAmount",
            SCALES.glow,
            None,
        ),
        halation_amount: scaled_section_value(
            js_adjustments,
            "effects",
            "halationAmount",
            SCALES.halation,
            None,
        ),
        flare_amount: scaled_section_value(
            js_adjustments,
            "effects",
            "flareAmount",
            SCALES.flares,
            None,
        ),
        sharpness_threshold: scaled_section_value(
            js_adjustments,
            "details",
            "sharpnessThreshold",
            SCALES.sharpness_threshold,
            Some(15.0),
        ),
    }
}

fn mask_curve_points(value: &JsonValue, curves: &JsonValue, name: &str) -> Vec<JsonValue> {
    if section_is_visible(value, "curves") {
        curves[name].as_array().cloned().unwrap_or_default()
    } else {
        Vec::new()
    }
}

fn blend_mode_to_runtime_id(blend_mode: &str) -> f32 {
    match blend_mode {
        "multiply" => 1.0,
        "screen" => 2.0,
        _ => 0.0,
    }
}

fn get_mask_adjustments_from_json(adj: &JsonValue, blend_mode: &str) -> MaskAdjustments {
    if adj.is_null() {
        return MaskAdjustments {
            blend_mode: blend_mode_to_runtime_id(blend_mode),
            ..Default::default()
        };
    }

    let get_val = |section: &str, key: &str, scale: f32| -> f32 {
        scaled_section_value(adj, section, key, scale, None)
    };

    let curves_obj = adj.get("curves").cloned().unwrap_or_default();
    let luma_points = mask_curve_points(adj, &curves_obj, "luma");
    let red_points = mask_curve_points(adj, &curves_obj, "red");
    let green_points = mask_curve_points(adj, &curves_obj, "green");
    let blue_points = mask_curve_points(adj, &curves_obj, "blue");
    let cg_obj = adj.get("colorGrading").cloned().unwrap_or_default();

    MaskAdjustments {
        exposure: get_val("basic", "exposure", SCALES.exposure),
        brightness: get_val("basic", "brightness", SCALES.brightness),
        contrast: get_val("basic", "contrast", SCALES.contrast),
        highlights: get_val("basic", "highlights", SCALES.highlights),
        shadows: get_val("basic", "shadows", SCALES.shadows),
        whites: get_val("basic", "whites", SCALES.whites),
        blacks: get_val("basic", "blacks", SCALES.blacks),
        saturation: get_val("color", "saturation", SCALES.saturation),
        temperature: get_val("color", "temperature", SCALES.temperature),
        tint: get_val("color", "tint", SCALES.tint),
        vibrance: get_val("color", "vibrance", SCALES.vibrance),
        sharpness: get_val("details", "sharpness", SCALES.sharpness),
        luma_noise_reduction: get_val("details", "lumaNoiseReduction", SCALES.luma_noise_reduction),
        color_noise_reduction: get_val(
            "details",
            "colorNoiseReduction",
            SCALES.color_noise_reduction,
        ),
        clarity: get_val("details", "clarity", SCALES.clarity),
        dehaze: get_val("details", "dehaze", SCALES.dehaze),
        structure: get_val("details", "structure", SCALES.structure),
        glow_amount: get_val("effects", "glowAmount", SCALES.glow),
        halation_amount: get_val("effects", "halationAmount", SCALES.halation),
        flare_amount: get_val("effects", "flareAmount", SCALES.flares),
        sharpness_threshold: get_val("details", "sharpnessThreshold", SCALES.sharpness_threshold),
        hue: get_val("color", "hue", 1.0),
        blend_mode: blend_mode_to_runtime_id(blend_mode),
        _pad_cg2: 0.0,
        color_grading_shadows: if section_is_visible(adj, "color") {
            parse_color_grade_settings(&cg_obj["shadows"])
        } else {
            ColorGradeSettings::default()
        },
        color_grading_midtones: if section_is_visible(adj, "color") {
            parse_color_grade_settings(&cg_obj["midtones"])
        } else {
            ColorGradeSettings::default()
        },
        color_grading_highlights: if section_is_visible(adj, "color") {
            parse_color_grade_settings(&cg_obj["highlights"])
        } else {
            ColorGradeSettings::default()
        },
        color_grading_global: if section_is_visible(adj, "color") {
            parse_color_grade_settings(&cg_obj["global"])
        } else {
            ColorGradeSettings::default()
        },
        color_grading_blending: if section_is_visible(adj, "color") {
            cg_obj["blending"].as_f64().unwrap_or(50.0) as f32 / SCALES.color_grading_blending
        } else {
            0.5
        },
        color_grading_balance: if section_is_visible(adj, "color") {
            cg_obj["balance"].as_f64().unwrap_or(0.0) as f32 / SCALES.color_grading_balance
        } else {
            0.0
        },
        _pad5: 0.0,
        _pad6: 0.0,
        hsl: if section_is_visible(adj, "color") {
            parse_hsl_adjustments(&adj.get("hsl").cloned().unwrap_or_default())
        } else {
            [HslColor::default(); 8]
        },
        luma_curve: convert_points_to_aligned(luma_points.clone()),
        red_curve: convert_points_to_aligned(red_points.clone()),
        green_curve: convert_points_to_aligned(green_points.clone()),
        blue_curve: convert_points_to_aligned(blue_points.clone()),
        luma_curve_count: luma_points.len() as u32,
        red_curve_count: red_points.len() as u32,
        green_curve_count: green_points.len() as u32,
        blue_curve_count: blue_points.len() as u32,
        _pad_end4: 0.0,
        _pad_end5: 0.0,
        _pad_end6: 0.0,
        _pad_end7: 0.0,
    }
}

pub fn get_all_adjustments_from_json(
    js_adjustments: &JsonValue,
    is_raw: bool,
    tonemapper_override: Option<u32>,
) -> AllAdjustments {
    let mask_definitions = js_adjustments
        .get("masks")
        .and_then(|value| Vec::<MaskDefinition>::deserialize(value).ok())
        .unwrap_or_default();
    get_all_adjustments_from_json_with_masks(
        js_adjustments,
        is_raw,
        tonemapper_override,
        &mask_definitions,
    )
}

pub fn get_all_adjustments_from_json_with_masks(
    js_adjustments: &JsonValue,
    is_raw: bool,
    tonemapper_override: Option<u32>,
    mask_definitions: &[MaskDefinition],
) -> AllAdjustments {
    let global = get_global_adjustments_from_json(js_adjustments, is_raw, tonemapper_override);
    let mut mask_adjustments = [MaskAdjustments::default(); MAX_MASKS];
    let mut mask_count = 0;

    for (i, mask_def) in mask_definitions
        .iter()
        .filter(|m| m.visible)
        .enumerate()
        .take(MAX_MASKS)
    {
        mask_adjustments[i] =
            get_mask_adjustments_from_json(&mask_def.adjustments, &mask_def.blend_mode);
        mask_count += 1;
    }

    AllAdjustments {
        global,
        mask_adjustments,
        mask_count,
        tile_offset_x: 0,
        tile_offset_y: 0,
        mask_atlas_cols: 1,
        blur_pass_flags: 0,
        _pad_blur_flags1: 0,
        _pad_blur_flags2: 0,
        _pad_blur_flags3: 0,
    }
}

#[cfg(test)]
mod tests {
    use super::get_all_adjustments_from_json;
    use serde_json::json;

    #[test]
    fn parses_supported_mask_container_blend_modes() {
        let adjustments = json!({
            "masks": [
                {
                    "id": "mask-normal",
                    "name": "Normal",
                    "visible": true,
                    "invert": false,
                    "opacity": 100,
                    "adjustments": {},
                    "subMasks": []
                },
                {
                    "id": "mask-multiply",
                    "name": "Multiply",
                    "visible": true,
                    "invert": false,
                    "blendMode": "multiply",
                    "opacity": 100,
                    "adjustments": {},
                    "subMasks": []
                },
                {
                    "id": "mask-screen",
                    "name": "Screen",
                    "visible": true,
                    "invert": false,
                    "blendMode": "screen",
                    "opacity": 100,
                    "adjustments": {},
                    "subMasks": []
                },
                {
                    "id": "mask-overlay",
                    "name": "Overlay",
                    "visible": true,
                    "invert": false,
                    "blendMode": "overlay",
                    "opacity": 100,
                    "adjustments": {},
                    "subMasks": []
                }
            ]
        });

        let parsed = get_all_adjustments_from_json(&adjustments, true, None);

        assert_eq!(parsed.mask_count, 4);
        assert_eq!(parsed.mask_adjustments[0].blend_mode, 0.0);
        assert_eq!(parsed.mask_adjustments[1].blend_mode, 1.0);
        assert_eq!(parsed.mask_adjustments[2].blend_mode, 2.0);
        assert_eq!(parsed.mask_adjustments[3].blend_mode, 0.0);
    }

    #[test]
    fn parses_technical_white_balance_separately_from_creative_offsets() {
        let native = json!({
            "creativeTemperature": 25.0,
            "creativeTint": -10.0,
            "temperature": 99.0,
            "tint": 99.0,
            "whiteBalanceTechnical": {
                "mode": "kelvin_tint",
                "kelvin": 3200.0,
                "duv": 0.008
            }
        });
        let parsed = get_all_adjustments_from_json(&native, true, None);
        assert_eq!(parsed.global.temperature, 1.0);
        assert_eq!(parsed.global.tint, -0.1);
        assert_ne!(
            parsed.global.technical_white_balance.col0,
            [1.0, 0.0, 0.0, 0.0]
        );

        let legacy = get_all_adjustments_from_json(
            &json!({ "temperature": 25.0, "tint": -10.0 }),
            true,
            None,
        );
        assert_eq!(legacy.global.temperature, 1.0);
        assert_eq!(legacy.global.tint, -0.1);
        assert_eq!(
            legacy.global.technical_white_balance.col0,
            [1.0, 0.0, 0.0, 0.0]
        );
    }

    #[test]
    fn local_masks_cannot_override_the_global_technical_illuminant() {
        let adjustments = json!({
            "whiteBalanceTechnical": { "mode": "kelvin_tint", "kelvin": 7500.0, "duv": -0.004 },
            "masks": [{
                "id": "mask",
                "name": "Local creative color",
                "visible": true,
                "invert": false,
                "opacity": 100,
                "adjustments": {
                    "temperature": 50.0,
                    "tint": 20.0,
                    "whiteBalanceTechnical": { "mode": "kelvin_tint", "kelvin": 1800.0, "duv": 0.04 }
                },
                "subMasks": []
            }]
        });
        let parsed = get_all_adjustments_from_json(&adjustments, true, None);
        assert_eq!(parsed.mask_count, 1);
        assert_eq!(parsed.mask_adjustments[0].temperature, 2.0);
        assert_eq!(parsed.mask_adjustments[0].tint, 0.2);
        assert_ne!(
            parsed.global.technical_white_balance.col0,
            [1.0, 0.0, 0.0, 0.0]
        );
    }
}
