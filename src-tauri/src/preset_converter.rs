use regex::Regex;
use serde::Serialize;
use serde_json::{Map, Value, json};
use std::collections::{HashMap, HashSet};
use uuid::Uuid;

use crate::adjustments::edit_document_v2::validate_edit_document_v2_copy_payload;
use crate::color::white_balance::{WHITE_BALANCE_CONTRACT, cct_duv_to_coordinates};
use crate::presets::{Preset, PresetType};

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExternalPresetImportDiagnostic {
    pub code: &'static str,
    pub field: String,
    pub message: String,
}

#[derive(Debug)]
pub struct ConvertedExternalPreset {
    pub diagnostics: Vec<ExternalPresetImportDiagnostic>,
    pub preset: Preset,
}

fn node_envelope(node_type: &str, process: &str, params: Value) -> Value {
    json!({
        "enabled": true,
        "implementationVersion": 1,
        "params": params,
        "process": process,
        "type": node_type,
    })
}

fn insert_node(
    nodes: &mut Map<String, Value>,
    node_type: &str,
    process: &str,
    params: Map<String, Value>,
) {
    nodes.insert(
        node_type.to_string(),
        node_envelope(node_type, process, Value::Object(params)),
    );
}

fn object(value: Value) -> Map<String, Value> {
    value.as_object().cloned().expect("static object literal")
}

fn default_detail_params() -> Map<String, Value> {
    object(json!({
        "centré": 0,
        "clarity": 0,
        "colorNoiseReduction": 0,
        "deblurEnabled": false,
        "deblurSigmaPx": 0.8,
        "deblurStrength": 0,
        "dehaze": 0,
        "denoiseContrastProtection": 50,
        "denoiseDetail": 50,
        "denoiseNaturalGrain": 0,
        "denoiseShadowBias": 0,
        "dustSpotMinRadiusPx": 2,
        "dustSpotOverlayEnabled": false,
        "dustSpotSensitivity": 50,
        "localContrastHaloGuard": 50,
        "localContrastMidtoneMask": 50,
        "localContrastRadiusPx": 24,
        "lumaNoiseReduction": 0,
        "sharpness": 0,
        "sharpnessThreshold": 15,
        "structure": 0,
    }))
}

fn default_display_creative_params() -> Map<String, Value> {
    object(json!({
        "flareAmount": 0,
        "glowAmount": 0,
        "grainAmount": 0,
        "grainRoughness": 50,
        "grainSize": 25,
        "halationAmount": 0,
        "lutData": null,
        "lutIntensity": 100,
        "lutName": null,
        "lutPath": null,
        "lutSize": 0,
        "vignetteAmount": 0,
        "vignetteFeather": 50,
        "vignetteMidpoint": 50,
        "vignetteRoundness": 0,
    }))
}

fn default_lens_params() -> Map<String, Value> {
    object(json!({
        "chromaticAberrationBlueYellow": 0,
        "chromaticAberrationRedCyan": 0,
        "lensCorrectionMode": "manual",
        "lensDistortionAmount": 100,
        "lensDistortionEnabled": true,
        "lensDistortionParams": null,
        "lensMaker": null,
        "lensModel": null,
        "lensTcaAmount": 100,
        "lensTcaEnabled": true,
        "lensVignetteAmount": 100,
        "lensVignetteEnabled": true,
    }))
}

fn default_color_grading_params() -> Map<String, Value> {
    object(json!({
        "colorGrading": {
            "balance": 0,
            "blending": 50,
            "global": { "hue": 0, "luminance": 0, "saturation": 0 },
            "highlights": { "hue": 0, "luminance": 0, "saturation": 0 },
            "midtones": { "hue": 0, "luminance": 0, "saturation": 0 },
            "shadows": { "hue": 0, "luminance": 0, "saturation": 0 }
        },
        "perceptualGradingV1": {
            "balance": 0,
            "blending": 0.5,
            "falloff": 1,
            "global": { "brilliance": 0, "chroma": 0, "hueDegrees": 0, "luminanceEv": 0, "saturation": 0 },
            "highlightFulcrumEv": 2,
            "highlights": { "brilliance": 0, "chroma": 0, "hueDegrees": 0, "luminanceEv": 0, "saturation": 0 },
            "midtones": { "brilliance": 0, "chroma": 0, "hueDegrees": 0, "luminanceEv": 0, "saturation": 0 },
            "neutralProtection": 0.5,
            "perceptualModel": "oklab_d65_from_acescg_v1",
            "shadowFulcrumEv": -2,
            "shadows": { "brilliance": 0, "chroma": 0, "hueDegrees": 0, "luminanceEv": 0, "saturation": 0 },
            "skinProtection": 0
        }
    }))
}

#[derive(Copy, Clone, Debug)]
enum Num {
    I(i64),
    F(f64),
}

fn parse_num(s: &str) -> Option<Num> {
    if let Ok(i) = s.parse::<i64>() {
        Some(Num::I(i))
    } else if let Ok(f) = s.parse::<f64>() {
        Some(Num::F(f))
    } else {
        None
    }
}

fn num_to_json(num: Num) -> Option<Value> {
    match num {
        Num::I(i) => Some(Value::Number(i.into())),
        Num::F(f) => serde_json::Number::from_f64(f).map(Value::Number),
    }
}

fn get_attr_as_f64(attrs: &HashMap<String, String>, key: &str) -> Option<f64> {
    attrs
        .get(key)
        .and_then(|s| s.trim_start_matches('+').parse::<f64>().ok())
}

fn imports_black_white(attrs: &HashMap<String, String>) -> bool {
    attrs
        .get("ConvertToGrayscale")
        .is_some_and(|value| matches!(value.to_ascii_lowercase().as_str(), "true" | "1"))
        || attrs.get("Treatment").is_some_and(|value| {
            let value = value.replace("&amp;", "&").to_ascii_lowercase();
            matches!(
                value.as_str(),
                "black & white" | "black and white" | "monochrome"
            )
        })
}

fn extract_xmp_name(xmp_content: &str) -> Option<String> {
    let re =
        Regex::new(r#"(?s)<crs:Name>.*?<rdf:Alt>.*?<rdf:li[^>]*>([^<]+)</rdf:li>.*?</crs:Name>"#)
            .ok()?;
    re.captures(xmp_content)
        .and_then(|c| c.get(1).map(|m| m.as_str().trim().to_string()))
}

fn extract_tone_curve_points(xmp_str: &str, curve_name: &str) -> Option<Vec<Value>> {
    let pattern = format!(
        r"(?s)<crs:{}>\s*<rdf:Seq>(.*?)</rdf:Seq>\s*</crs:{}>",
        curve_name, curve_name
    );
    let re = Regex::new(&pattern).ok()?;
    let captures = re.captures(xmp_str)?;
    let seq_content = captures.get(1)?.as_str();

    let point_re = Regex::new(r"<rdf:li>(\d+),\s*(\d+)</rdf:li>").ok()?;
    let mut points = Vec::new();

    for point_cap in point_re.captures_iter(seq_content) {
        let x: u32 = point_cap.get(1)?.as_str().parse().ok()?;
        let y: u32 = point_cap.get(2)?.as_str().parse().ok()?;

        let mut final_y = y;
        if curve_name == "ToneCurvePV2012" {
            const SHADOW_RANGE_END: f64 = 64.0;
            const SHADOW_DAMPEN_START: f64 = 0.8;
            const SHADOW_DAMPEN_END: f64 = 1.0;

            let x_f64 = x as f64;
            let y_f64 = y as f64;

            if y_f64 > x_f64 && x_f64 < SHADOW_RANGE_END {
                let lift_amount = y_f64 - x_f64;
                let progress = x_f64 / SHADOW_RANGE_END;
                let dampening_factor =
                    SHADOW_DAMPEN_START + (SHADOW_DAMPEN_END - SHADOW_DAMPEN_START) * progress;

                let new_y = x_f64 + (lift_amount * dampening_factor);
                final_y = new_y.round().clamp(0.0, 255.0) as u32;
            }
        }

        let mut point = Map::new();
        point.insert("x".to_string(), Value::Number(x.into()));
        point.insert("y".to_string(), Value::Number(final_y.into()));
        points.push(Value::Object(point));
    }

    if points.is_empty() {
        None
    } else {
        Some(points)
    }
}

pub fn convert_xmp_to_preset(xmp_content: &str) -> Result<ConvertedExternalPreset, String> {
    let xmp_one_line = xmp_content.split('\n').collect::<Vec<_>>().join(" ");

    let attr_re = Regex::new(r#"crs:([A-Za-z0-9]+)="([^"]*)""#)
        .map_err(|e| format!("Regex compilation failed: {}", e))?;
    let mut attrs: HashMap<String, String> = HashMap::new();
    for cap in attr_re.captures_iter(&xmp_one_line) {
        attrs.insert(cap[1].to_string(), cap[2].to_string());
    }

    if attrs.is_empty() && extract_tone_curve_points(xmp_content, "ToneCurvePV2012").is_none() {
        return Err("External preset contains no supported Lightroom/XMP settings".to_string());
    }

    let mut nodes = Map::new();
    let mut scene_tone = object(json!({
        "blacks": 0,
        "brightness": 0,
        "contrast": 0,
        "exposure": 0,
        "highlights": 0,
        "shadows": 0,
        "whites": 0,
    }));
    let mut color_presence = object(json!({ "hue": 0, "saturation": 0, "vibrance": 0 }));
    let mut detail = default_detail_params();
    let mut display_creative = default_display_creative_params();
    let mut lens = default_lens_params();
    let mut touched_scene_tone = false;
    let mut touched_color_presence = false;
    let mut touched_detail = false;
    let mut touched_display_creative = false;
    let mut touched_lens = false;
    let mut hsl_map = Map::new();
    let mut color_grading_map = Map::new();
    let mut curves_map = Map::new();

    for (xmp_key, node_key) in [
        ("Exposure2012", "exposure"),
        ("Contrast2012", "contrast"),
        ("Highlights2012", "highlights"),
        ("Whites2012", "whites"),
        ("Blacks2012", "blacks"),
    ] {
        if let Some(raw_val) = attrs.get(xmp_key)
            && let Some(num) = parse_num(raw_val.trim_start_matches('+'))
            && let Some(json_val) = num_to_json(num)
        {
            scene_tone.insert(node_key.to_string(), json_val);
            touched_scene_tone = true;
        }
    }

    for (xmp_key, node_key) in [("Vibrance", "vibrance"), ("Saturation", "saturation")] {
        if let Some(raw_val) = attrs.get(xmp_key)
            && let Some(num) = parse_num(raw_val.trim_start_matches('+'))
            && let Some(json_val) = num_to_json(num)
        {
            color_presence.insert(node_key.to_string(), json_val);
            touched_color_presence = true;
        }
    }

    for (xmp_key, node_key) in [
        ("Clarity2012", "clarity"),
        ("Dehaze", "dehaze"),
        ("Texture", "structure"),
        ("LuminanceSmoothing", "lumaNoiseReduction"),
        ("ColorNoiseReduction", "colorNoiseReduction"),
    ] {
        if let Some(raw_val) = attrs.get(xmp_key)
            && let Some(num) = parse_num(raw_val.trim_start_matches('+'))
            && let Some(json_val) = num_to_json(num)
        {
            detail.insert(node_key.to_string(), json_val);
            touched_detail = true;
        }
    }

    for (xmp_key, node_key) in [
        ("ChromaticAberrationRedCyan", "chromaticAberrationRedCyan"),
        (
            "ChromaticAberrationBlueYellow",
            "chromaticAberrationBlueYellow",
        ),
    ] {
        if let Some(raw_val) = attrs.get(xmp_key)
            && let Some(num) = parse_num(raw_val.trim_start_matches('+'))
            && let Some(json_val) = num_to_json(num)
        {
            lens.insert(node_key.to_string(), json_val);
            touched_lens = true;
        }
    }

    for (xmp_key, node_key) in [
        ("PostCropVignetteAmount", "vignetteAmount"),
        ("PostCropVignetteMidpoint", "vignetteMidpoint"),
        ("PostCropVignetteFeather", "vignetteFeather"),
        ("PostCropVignetteRoundness", "vignetteRoundness"),
        ("GrainAmount", "grainAmount"),
        ("GrainSize", "grainSize"),
        ("GrainFrequency", "grainRoughness"),
    ] {
        if let Some(raw_val) = attrs.get(xmp_key)
            && let Some(num) = parse_num(raw_val.trim_start_matches('+'))
            && let Some(json_val) = num_to_json(num)
        {
            display_creative.insert(node_key.to_string(), json_val);
            touched_display_creative = true;
        }
    }

    if let Some(raw_val) = attrs.get("ColorGradeBlending")
        && let Some(num) = parse_num(raw_val.trim_start_matches('+'))
        && let Some(json_val) = num_to_json(num)
    {
        color_grading_map.insert("blending".to_string(), json_val);
    }

    if let Some(shadows_val) = get_attr_as_f64(&attrs, "Shadows2012") {
        let adjusted_shadows = (shadows_val * 1.5).min(100.0);
        scene_tone.insert("shadows".to_string(), json!(adjusted_shadows));
        touched_scene_tone = true;
    }

    if let Some(sharpness_val) = get_attr_as_f64(&attrs, "Sharpness") {
        let scaled_sharpness = (sharpness_val / 150.0) * 100.0;
        detail.insert(
            "sharpness".to_string(),
            json!(scaled_sharpness.clamp(0.0, 100.0)),
        );
        touched_detail = true;
    }

    let white_balance_fields_valid = ["Temperature", "AsShotTemperature", "Tint"]
        .into_iter()
        .all(|field| {
            attrs.get(field).is_none_or(|value| {
                value
                    .trim_start_matches('+')
                    .parse::<f64>()
                    .is_ok_and(f64::is_finite)
            })
        });
    if white_balance_fields_valid
        && (attrs.contains_key("Temperature")
            || attrs.contains_key("AsShotTemperature")
            || attrs.contains_key("Tint"))
    {
        let kelvin = get_attr_as_f64(&attrs, "Temperature")
            .or_else(|| get_attr_as_f64(&attrs, "AsShotTemperature"))
            .unwrap_or(5500.0)
            .clamp(1667.0, 25_000.0);
        let duv = (get_attr_as_f64(&attrs, "Tint").unwrap_or(0.0) / 3000.0).clamp(-0.05, 0.05);
        let coordinates = cct_duv_to_coordinates(kelvin, duv)
            .map_err(|error| format!("Invalid Lightroom/XMP white balance: {error}"))?;
        let camera_input = object(json!({
            "cameraProfile": "camera_standard",
            "cameraProfileAmount": 100,
            "whiteBalanceTechnical": {
                "adaptation": "cat16_v1",
                "confidence": null,
                "contract": WHITE_BALANCE_CONTRACT,
                "duv": coordinates.duv,
                "inputSemantics": "raw_scene_linear",
                "kelvin": coordinates.cct_kelvin,
                "mode": "kelvin_tint",
                "presetId": null,
                "sampleCount": null,
                "source": "preset",
                "synchronization": { "mode": "per_image", "referenceSourceIdentity": null },
                "x": coordinates.xy[0],
                "y": coordinates.xy[1]
            }
        }));
        insert_node(
            &mut nodes,
            "camera_input",
            "scene_referred_v2",
            camera_input,
        );
    }

    let colors = [
        ("Red", "reds"),
        ("Orange", "oranges"),
        ("Yellow", "yellows"),
        ("Green", "greens"),
        ("Aqua", "aquas"),
        ("Blue", "blues"),
        ("Purple", "purples"),
        ("Magenta", "magentas"),
    ];
    for (src, dst) in colors {
        let mut color_map = Map::new();
        if let Some(raw) = attrs.get(&format!("HueAdjustment{}", src))
            && let Some(num) = parse_num(raw.trim_start_matches('+'))
            && let Some(Value::Number(n)) = num_to_json(num)
            && let Some(val_f64) = n.as_f64()
        {
            let adjusted_hue = val_f64 * 0.75;
            color_map.insert("hue".to_string(), json!(adjusted_hue));
        }
        if let Some(raw) = attrs.get(&format!("SaturationAdjustment{}", src))
            && let Some(num) = parse_num(raw.trim_start_matches('+'))
            && let Some(json_val) = num_to_json(num)
        {
            color_map.insert("saturation".to_string(), json_val);
        }
        if let Some(raw) = attrs.get(&format!("LuminanceAdjustment{}", src))
            && let Some(num) = parse_num(raw.trim_start_matches('+'))
            && let Some(json_val) = num_to_json(num)
        {
            color_map.insert("luminance".to_string(), json_val);
        }
        if !color_map.is_empty() {
            hsl_map.insert(dst.to_string(), Value::Object(color_map));
        }
    }
    if imports_black_white(&attrs) {
        let weights = colors
            .into_iter()
            .map(|(src, dst)| {
                let value = get_attr_as_f64(&attrs, &format!("GrayMixer{src}"))
                    .unwrap_or(0.0)
                    .clamp(-100.0, 100.0);
                (dst.to_string(), json!(value))
            })
            .collect::<Map<String, Value>>();
        insert_node(
            &mut nodes,
            "black_white_mixer",
            "scene_referred_v2",
            object(json!({
                "blackWhiteMixer": {
                "enabled": true,
                "presetId": "manual",
                "process": "continuous_sensitivity_v1",
                "sourceClass": "color_source",
                "weights": weights,
                }
            })),
        );
    }

    let mut shadows_map = Map::new();
    let mut midtones_map = Map::new();
    let mut highlights_map = Map::new();
    let mut global_map = Map::new();
    if let Some(raw) = attrs.get("SplitToningShadowHue")
        && let Some(num) = parse_num(raw)
        && let Some(json_val) = num_to_json(num)
    {
        shadows_map.insert("hue".to_string(), json_val);
    }
    if let Some(raw) = attrs.get("ColorGradeMidtoneHue")
        && let Some(num) = parse_num(raw)
        && let Some(json_val) = num_to_json(num)
    {
        midtones_map.insert("hue".to_string(), json_val);
    }
    if let Some(raw) = attrs.get("SplitToningHighlightHue")
        && let Some(num) = parse_num(raw)
        && let Some(json_val) = num_to_json(num)
    {
        highlights_map.insert("hue".to_string(), json_val);
    }
    if let Some(raw) = attrs.get("SplitToningShadowSaturation")
        && let Some(num) = parse_num(raw)
        && let Some(json_val) = num_to_json(num)
    {
        shadows_map.insert("saturation".to_string(), json_val);
    }
    if let Some(raw) = attrs.get("ColorGradeMidtoneSat")
        && let Some(num) = parse_num(raw)
        && let Some(json_val) = num_to_json(num)
    {
        midtones_map.insert("saturation".to_string(), json_val);
    }
    if let Some(raw) = attrs.get("SplitToningHighlightSaturation")
        && let Some(num) = parse_num(raw)
        && let Some(json_val) = num_to_json(num)
    {
        highlights_map.insert("saturation".to_string(), json_val);
    }
    if let Some(raw) = attrs.get("ColorGradeShadowLum")
        && let Some(num) = parse_num(raw)
        && let Some(json_val) = num_to_json(num)
    {
        shadows_map.insert("luminance".to_string(), json_val);
    }
    if let Some(raw) = attrs.get("ColorGradeMidtoneLum")
        && let Some(num) = parse_num(raw)
        && let Some(json_val) = num_to_json(num)
    {
        midtones_map.insert("luminance".to_string(), json_val);
    }
    if let Some(raw) = attrs.get("ColorGradeHighlightLum")
        && let Some(num) = parse_num(raw)
        && let Some(json_val) = num_to_json(num)
    {
        highlights_map.insert("luminance".to_string(), json_val);
    }
    if let Some(raw) = attrs.get("ColorGradeGlobalHue")
        && let Some(num) = parse_num(raw)
        && let Some(json_val) = num_to_json(num)
    {
        global_map.insert("hue".to_string(), json_val);
    }
    if let Some(raw) = attrs.get("ColorGradeGlobalSat")
        && let Some(num) = parse_num(raw)
        && let Some(json_val) = num_to_json(num)
    {
        global_map.insert("saturation".to_string(), json_val);
    }
    if let Some(raw) = attrs.get("ColorGradeGlobalLum")
        && let Some(num) = parse_num(raw)
        && let Some(json_val) = num_to_json(num)
    {
        global_map.insert("luminance".to_string(), json_val);
    }
    if let Some(raw) = attrs.get("SplitToningBalance")
        && let Some(num) = parse_num(raw)
        && let Some(json_val) = num_to_json(num)
    {
        color_grading_map.insert("balance".to_string(), json_val);
    }
    if !shadows_map.is_empty() {
        color_grading_map.insert("shadows".to_string(), Value::Object(shadows_map));
    }
    if !midtones_map.is_empty() {
        color_grading_map.insert("midtones".to_string(), Value::Object(midtones_map));
    }
    if !highlights_map.is_empty() {
        color_grading_map.insert("highlights".to_string(), Value::Object(highlights_map));
    }
    if !global_map.is_empty() {
        color_grading_map.insert("global".to_string(), Value::Object(global_map));
    }
    let curve_mappings = [
        ("ToneCurvePV2012", "luma"),
        ("ToneCurvePV2012Red", "red"),
        ("ToneCurvePV2012Green", "green"),
        ("ToneCurvePV2012Blue", "blue"),
    ];
    for (xmp_curve, rr_curve) in curve_mappings {
        if let Some(points) = extract_tone_curve_points(xmp_content, xmp_curve) {
            curves_map.insert(rr_curve.to_string(), Value::Array(points));
        }
    }
    if touched_scene_tone {
        insert_node(
            &mut nodes,
            "scene_global_color_tone",
            "scene_referred_v2",
            scene_tone,
        );
    }
    if touched_color_presence {
        insert_node(
            &mut nodes,
            "color_presence",
            "scene_referred_v2",
            color_presence,
        );
    }
    if touched_detail {
        insert_node(
            &mut nodes,
            "detail_denoise_dehaze",
            "scene_referred_v2",
            detail,
        );
    }
    if touched_display_creative {
        insert_node(
            &mut nodes,
            "display_creative",
            "scene_referred_v2",
            display_creative,
        );
    }
    if touched_lens {
        insert_node(&mut nodes, "lens_correction", "scene_referred_v2", lens);
    }
    if !hsl_map.is_empty() {
        let mut params = object(json!({
            "hsl": {
                "aquas": { "hue": 0, "luminance": 0, "saturation": 0 },
                "blues": { "hue": 0, "luminance": 0, "saturation": 0 },
                "greens": { "hue": 0, "luminance": 0, "saturation": 0 },
                "magentas": { "hue": 0, "luminance": 0, "saturation": 0 },
                "oranges": { "hue": 0, "luminance": 0, "saturation": 0 },
                "purples": { "hue": 0, "luminance": 0, "saturation": 0 },
                "reds": { "hue": 0, "luminance": 0, "saturation": 0 },
                "yellows": { "hue": 0, "luminance": 0, "saturation": 0 }
            },
            "selectiveColorRangeControls": {
                "aquas": { "centerHueDegrees": 180, "falloffSmoothness": 1.5, "widthDegrees": 60 },
                "blues": { "centerHueDegrees": 225, "falloffSmoothness": 1.5, "widthDegrees": 60 },
                "greens": { "centerHueDegrees": 115, "falloffSmoothness": 1.5, "widthDegrees": 90 },
                "magentas": { "centerHueDegrees": 330, "falloffSmoothness": 1.5, "widthDegrees": 50 },
                "oranges": { "centerHueDegrees": 25, "falloffSmoothness": 1.5, "widthDegrees": 45 },
                "purples": { "centerHueDegrees": 280, "falloffSmoothness": 1.5, "widthDegrees": 55 },
                "reds": { "centerHueDegrees": 358, "falloffSmoothness": 1.5, "widthDegrees": 35 },
                "yellows": { "centerHueDegrees": 60, "falloffSmoothness": 1.5, "widthDegrees": 40 }
            }
        }));
        params
            .get_mut("hsl")
            .and_then(Value::as_object_mut)
            .expect("static HSL defaults")
            .extend(hsl_map);
        insert_node(
            &mut nodes,
            "selective_color_mixer",
            "scene_referred_v2",
            params,
        );
    }
    if !color_grading_map.is_empty() {
        let mut params = default_color_grading_params();
        let defaults = params
            .get_mut("colorGrading")
            .and_then(Value::as_object_mut)
            .expect("static color-grading defaults");
        for (key, value) in color_grading_map {
            if let (Some(current), Some(imported)) = (
                defaults.get_mut(&key).and_then(Value::as_object_mut),
                value.as_object(),
            ) {
                current.extend(imported.clone());
            } else {
                defaults.insert(key, value);
            }
        }
        insert_node(
            &mut nodes,
            "perceptual_grading",
            "scene_referred_v2",
            params,
        );
    }
    if !curves_map.is_empty() {
        let identity = json!([
            { "x": 0, "y": 0 },
            { "x": 255, "y": 255 }
        ]);
        let mut curves = object(json!({
            "blue": identity,
            "green": identity,
            "luma": identity,
            "red": identity,
        }));
        curves.extend(curves_map);
        let parametric_channel = json!({
            "blackLevel": 0, "darks": 0, "highlights": 0, "lights": 0,
            "shadows": 0, "split1": 25, "split2": 50, "split3": 75, "whiteLevel": 0
        });
        insert_node(
            &mut nodes,
            "scene_curve",
            "scene_referred_v2",
            object(json!({
                "curveMode": "point",
                "curves": curves,
                "parametricCurve": {
                    "blue": parametric_channel,
                    "green": parametric_channel,
                    "luma": parametric_channel,
                    "red": parametric_channel
                },
                "pointCurves": curves,
                "toneCurve": "auto_filmic"
            })),
        );
    }

    if nodes.is_empty() {
        return Err("External preset contains no supported Lightroom/XMP settings".to_string());
    }

    let supported_fields: HashSet<&str> = [
        "AsShotTemperature",
        "Blacks2012",
        "ChromaticAberrationBlueYellow",
        "ChromaticAberrationRedCyan",
        "Clarity2012",
        "ColorGradeBlending",
        "ColorGradeGlobalHue",
        "ColorGradeGlobalLum",
        "ColorGradeGlobalSat",
        "ColorGradeHighlightLum",
        "ColorGradeMidtoneHue",
        "ColorGradeMidtoneLum",
        "ColorGradeMidtoneSat",
        "ColorGradeShadowLum",
        "ColorNoiseReduction",
        "Contrast2012",
        "ConvertToGrayscale",
        "Dehaze",
        "Exposure2012",
        "GrainAmount",
        "GrainFrequency",
        "GrainSize",
        "Highlights2012",
        "LuminanceSmoothing",
        "PostCropVignetteAmount",
        "PostCropVignetteFeather",
        "PostCropVignetteMidpoint",
        "PostCropVignetteRoundness",
        "Saturation",
        "Sharpness",
        "Shadows2012",
        "SplitToningBalance",
        "SplitToningHighlightHue",
        "SplitToningHighlightSaturation",
        "SplitToningShadowHue",
        "SplitToningShadowSaturation",
        "Temperature",
        "Texture",
        "Tint",
        "Treatment",
        "Vibrance",
        "Whites2012",
        "HueAdjustmentRed",
        "HueAdjustmentOrange",
        "HueAdjustmentYellow",
        "HueAdjustmentGreen",
        "HueAdjustmentAqua",
        "HueAdjustmentBlue",
        "HueAdjustmentPurple",
        "HueAdjustmentMagenta",
        "SaturationAdjustmentRed",
        "SaturationAdjustmentOrange",
        "SaturationAdjustmentYellow",
        "SaturationAdjustmentGreen",
        "SaturationAdjustmentAqua",
        "SaturationAdjustmentBlue",
        "SaturationAdjustmentPurple",
        "SaturationAdjustmentMagenta",
        "LuminanceAdjustmentRed",
        "LuminanceAdjustmentOrange",
        "LuminanceAdjustmentYellow",
        "LuminanceAdjustmentGreen",
        "LuminanceAdjustmentAqua",
        "LuminanceAdjustmentBlue",
        "LuminanceAdjustmentPurple",
        "LuminanceAdjustmentMagenta",
        "GrayMixerRed",
        "GrayMixerOrange",
        "GrayMixerYellow",
        "GrayMixerGreen",
        "GrayMixerAqua",
        "GrayMixerBlue",
        "GrayMixerPurple",
        "GrayMixerMagenta",
        "Name",
        "PresetType",
        "ProcessVersion",
        "UUID",
    ]
    .into_iter()
    .collect();
    let mut diagnostics = attrs
        .keys()
        .filter(|field| !supported_fields.contains(field.as_str()))
        .map(|field| ExternalPresetImportDiagnostic {
            code: "unsupported_external_field",
            field: field.clone(),
            message: format!("Lightroom/XMP field '{field}' is not supported and was not imported"),
        })
        .collect::<Vec<_>>();
    let numeric_fields: HashSet<&str> = supported_fields
        .iter()
        .copied()
        .filter(|field| {
            !matches!(
                *field,
                "ConvertToGrayscale"
                    | "Name"
                    | "PresetType"
                    | "ProcessVersion"
                    | "Treatment"
                    | "UUID"
            )
        })
        .collect();
    diagnostics.extend(attrs.iter().filter_map(|(field, value)| {
        if !numeric_fields.contains(field.as_str())
            || value
                .trim_start_matches('+')
                .parse::<f64>()
                .is_ok_and(f64::is_finite)
        {
            return None;
        }
        Some(ExternalPresetImportDiagnostic {
            code: "invalid_external_value",
            field: field.clone(),
            message: format!(
                "Lightroom/XMP field '{field}' has an invalid numeric value and was not imported"
            ),
        })
    }));
    diagnostics.sort_by(|left, right| left.field.cmp(&right.field));

    let preset_name =
        extract_xmp_name(xmp_content).unwrap_or_else(|| "Imported Preset".to_string());
    let current_payload = json!({ "nodes": nodes, "schemaVersion": 2 });
    validate_edit_document_v2_copy_payload(&current_payload)
        .map_err(|error| format!("Imported Lightroom/XMP preset is invalid: {error}"))?;

    Ok(ConvertedExternalPreset {
        diagnostics,
        preset: Preset {
            format: "rapidraw.preset".to_string(),
            schema_version: 1,
            id: Uuid::new_v4().to_string(),
            name: preset_name,
            edit_document_v2: current_payload,
            color_style_provenance: None,
            include_masks: false,
            include_crop_transform: touched_lens,
            preset_type: PresetType::Style,
        },
    })
}

#[cfg(test)]
mod tests {
    use super::convert_xmp_to_preset;
    #[test]
    fn lightroom_white_balance_compiles_directly_to_current_technical_contract() {
        let converted = convert_xmp_to_preset(include_str!(
            "../../fixtures/import/lightroom-current-nodes.xmp"
        ))
        .expect("Lightroom/XMP preset converts");
        assert_eq!(converted.diagnostics.len(), 1);
        assert_eq!(converted.diagnostics[0].field, "SharpenRadius");
        let preset = converted.preset;
        assert_eq!(preset.name, "Current Nodes Fixture");
        let current = &preset.edit_document_v2;
        let white_balance = current["nodes"]["camera_input"]["params"]["whiteBalanceTechnical"]
            .as_object()
            .expect("technical white balance");
        assert_eq!(white_balance["contract"], "rapidraw.white_balance.v1");
        assert_eq!(white_balance["mode"], "kelvin_tint");
        assert_eq!(white_balance["source"], "preset");
        assert_eq!(white_balance["kelvin"], 6500.0);
        assert_eq!(white_balance["duv"], 0.01);
        assert!(white_balance["x"].as_f64().is_some_and(f64::is_finite));
        assert!(white_balance["y"].as_f64().is_some_and(f64::is_finite));
        assert_eq!(
            current["nodes"]["scene_global_color_tone"]["params"]["exposure"],
            0.75
        );
        assert_eq!(
            current["nodes"]["detail_denoise_dehaze"]["params"]["structure"],
            18
        );
        assert!(current.get("extensions").is_none());
        assert!(current.get("migration").is_none());
    }

    #[test]
    fn lightroom_tint_without_temperature_uses_explicit_as_shot_kelvin() {
        let preset = convert_xmp_to_preset(
            r#"<rdf:Description crs:AsShotTemperature="5200" crs:Tint="-15" />"#,
        )
        .expect("Lightroom/XMP preset converts")
        .preset;
        let white_balance =
            &preset.edit_document_v2["nodes"]["camera_input"]["params"]["whiteBalanceTechnical"];
        assert_eq!(white_balance["kelvin"], 5200.0);
        assert_eq!(white_balance["duv"], -0.005);
    }

    #[test]
    fn xmp_black_white_import_targets_current_continuous_process() {
        let preset = convert_xmp_to_preset(
            r#"<rdf:Description crs:ConvertToGrayscale="True" crs:GrayMixerRed="35" crs:GrayMixerBlue="-42" />"#,
        )
        .expect("XMP preset converts")
        .preset;
        let mixer =
            &preset.edit_document_v2["nodes"]["black_white_mixer"]["params"]["blackWhiteMixer"];

        assert_eq!(mixer["enabled"], true);
        assert_eq!(mixer["process"], "continuous_sensitivity_v1");
        assert_eq!(mixer["sourceClass"], "color_source");
        assert_eq!(mixer["weights"]["reds"], 35.0);
        assert_eq!(mixer["weights"]["blues"], -42.0);
        assert_eq!(mixer["weights"]["greens"], 0.0);

        let treatment = convert_xmp_to_preset(
            r#"<rdf:Description crs:Treatment="Black &amp; White" crs:GrayMixerGreen="18" />"#,
        )
        .expect("monochrome Treatment preset converts")
        .preset;
        let treatment = treatment.edit_document_v2;
        assert_eq!(
            treatment["nodes"]["black_white_mixer"]["params"]["blackWhiteMixer"]["process"],
            "continuous_sensitivity_v1"
        );
        assert_eq!(
            treatment["nodes"]["black_white_mixer"]["params"]["blackWhiteMixer"]["weights"]["greens"],
            18.0
        );
    }

    #[test]
    fn color_xmp_import_does_not_invent_monochrome_state() {
        let preset = convert_xmp_to_preset(
            r#"<rdf:Description crs:Exposure2012="0.25" crs:ConvertToGrayscale="False" crs:GrayMixerRed="35" />"#,
        )
        .expect("XMP preset converts")
        .preset;

        assert!(
            preset.edit_document_v2["nodes"]
                .get("black_white_mixer")
                .is_none()
        );
    }

    #[test]
    fn unsupported_external_fields_are_diagnostic_only() {
        let converted = convert_xmp_to_preset(
            r#"<rdf:Description crs:Exposure2012="0.75" crs:Texture="not-a-number" crs:SharpenRadius="1.2" crs:UnknownFutureField="9" />"#,
        )
        .expect("supported field keeps import valid");
        assert_eq!(
            converted
                .diagnostics
                .iter()
                .map(|diagnostic| diagnostic.field.as_str())
                .collect::<Vec<_>>(),
            ["SharpenRadius", "Texture", "UnknownFutureField"]
        );
        assert_eq!(converted.diagnostics[1].code, "invalid_external_value");
        let current = converted.preset.edit_document_v2;
        assert_eq!(
            current["nodes"]["scene_global_color_tone"]["params"]["exposure"],
            0.75
        );
        assert!(!current.to_string().contains("SharpenRadius"));
        assert!(!current.to_string().contains("UnknownFutureField"));
        assert!(convert_xmp_to_preset("not an XMP preset").is_err());
    }

    #[test]
    fn every_supported_external_node_family_passes_native_contract_validation() {
        let converted = convert_xmp_to_preset(
            r#"
            <rdf:Description crs:Exposure2012="0.5" crs:Vibrance="12"
              crs:Clarity2012="8" crs:ChromaticAberrationRedCyan="-4"
              crs:PostCropVignetteAmount="-15" crs:HueAdjustmentBlue="20"
              crs:SaturationAdjustmentBlue="10" crs:LuminanceAdjustmentBlue="-5"
              crs:ColorGradeGlobalHue="220" crs:ColorGradeGlobalSat="18"
              crs:ColorGradeGlobalLum="-3" crs:ColorGradeBlending="45" />
            <crs:ToneCurvePV2012><rdf:Seq><rdf:li>0, 0</rdf:li><rdf:li>128, 140</rdf:li><rdf:li>255, 255</rdf:li></rdf:Seq></crs:ToneCurvePV2012>
            "#,
        )
        .expect("all mapped node families validate natively");
        let nodes = &converted.preset.edit_document_v2["nodes"];
        for node in [
            "scene_global_color_tone",
            "color_presence",
            "detail_denoise_dehaze",
            "lens_correction",
            "display_creative",
            "selective_color_mixer",
            "perceptual_grading",
            "scene_curve",
        ] {
            assert!(nodes.get(node).is_some(), "missing {node}");
        }
    }
}
