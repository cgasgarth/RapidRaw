use serde_json::{Map, Value, json};

pub(super) fn adjustments_schema() -> Value {
    let mut properties = Map::new();
    for (key, min, max, description) in [
        ("exposure", -5.0, 5.0, "EV shift."),
        ("brightness", -5.0, 5.0, "Brightness."),
        ("contrast", -100.0, 100.0, "Contrast."),
        ("highlights", -100.0, 100.0, "Highlights."),
        ("shadows", -100.0, 100.0, "Shadows."),
        ("whites", -100.0, 100.0, "Whites."),
        ("blacks", -100.0, 100.0, "Blacks."),
        ("temperature", -100.0, 100.0, "White balance temperature."),
        ("tint", -100.0, 100.0, "White balance tint."),
        ("saturation", -100.0, 100.0, "Global saturation."),
        ("vibrance", -100.0, 100.0, "Vibrance."),
        ("clarity", -100.0, 100.0, "Clarity."),
        ("structure", -100.0, 100.0, "Structure."),
        ("dehaze", -100.0, 100.0, "Dehaze."),
        ("sharpness", -100.0, 100.0, "Sharpness."),
        ("centré", -100.0, 100.0, "Centre."),
        (
            "chromaticAberrationRedCyan",
            -100.0,
            100.0,
            "Red/cyan chromatic aberration.",
        ),
        (
            "chromaticAberrationBlueYellow",
            -100.0,
            100.0,
            "Blue/yellow chromatic aberration.",
        ),
        ("vignetteAmount", -100.0, 100.0, "Vignette amount."),
        ("vignetteRoundness", -100.0, 100.0, "Vignette roundness."),
        (
            "lensDistortionAmount",
            -100.0,
            100.0,
            "Lens distortion correction.",
        ),
        (
            "lensVignetteAmount",
            -100.0,
            100.0,
            "Lens vignette correction.",
        ),
        (
            "lensTcaAmount",
            -100.0,
            100.0,
            "Lens chromatic aberration correction.",
        ),
        (
            "transformDistortion",
            -100.0,
            100.0,
            "Transform distortion.",
        ),
        ("transformVertical", -100.0, 100.0, "Vertical transform."),
        (
            "transformHorizontal",
            -100.0,
            100.0,
            "Horizontal transform.",
        ),
        ("transformAspect", -100.0, 100.0, "Transform aspect."),
        (
            "transformXOffset",
            -100.0,
            100.0,
            "Horizontal transform offset.",
        ),
        (
            "transformYOffset",
            -100.0,
            100.0,
            "Vertical transform offset.",
        ),
    ] {
        properties.insert(key.to_string(), ranged_number_schema(min, max, description));
    }
    for (key, min, max, description) in [
        ("sharpnessThreshold", 0.0, 80.0, "Sharpening threshold."),
        (
            "lumaNoiseReduction",
            0.0,
            100.0,
            "Luminance noise reduction.",
        ),
        ("colorNoiseReduction", 0.0, 100.0, "Color noise reduction."),
        ("vignetteFeather", 0.0, 100.0, "Vignette feather."),
        ("vignetteMidpoint", 0.0, 100.0, "Vignette midpoint."),
        ("grainAmount", 0.0, 100.0, "Film grain amount."),
        ("grainRoughness", 0.0, 100.0, "Film grain roughness."),
        ("grainSize", 0.0, 100.0, "Film grain size."),
        ("glowAmount", 0.0, 100.0, "Glow amount."),
        ("halationAmount", 0.0, 100.0, "Halation amount."),
        ("flareAmount", 0.0, 100.0, "Flare amount."),
        ("lutIntensity", 0.0, 100.0, "LUT intensity."),
        ("transformScale", 0.0, 500.0, "Transform scale percentage."),
    ] {
        properties.insert(key.to_string(), ranged_number_schema(min, max, description));
    }
    for key in [
        "lensBlurAmount",
        "lensBlurDiffusion",
        "lensBlurMaxDepth",
        "lensBlurMaxFade",
        "lensBlurMinDepth",
        "lensBlurMinFade",
    ] {
        properties.insert(
            key.to_string(),
            ranged_number_schema(0.0, 100.0, "Lens blur control."),
        );
    }
    properties.insert(
        "hue".to_string(),
        ranged_number_schema(-180.0, 180.0, "Global hue in degrees."),
    );
    properties.insert(
        "rotation".to_string(),
        ranged_number_schema(-180.0, 180.0, "Fine rotation in degrees."),
    );
    properties.insert(
        "transformRotate".to_string(),
        ranged_number_schema(-180.0, 180.0, "Transform rotation in degrees."),
    );
    properties.insert(
        "orientationSteps".to_string(),
        json!({ "type": "integer", "minimum": 0, "maximum": 3 }),
    );
    properties.insert("flipHorizontal".to_string(), json!({ "type": "boolean" }));
    properties.insert("flipVertical".to_string(), json!({ "type": "boolean" }));
    properties.insert(
        "curves".to_string(),
        curves_schema("Active renderer curve channels. In parametric mode these points mirror parametricCurve."),
    );
    properties.insert(
        "pointCurves".to_string(),
        curves_schema("Saved point-curve channels restored when curveMode is point."),
    );
    properties.insert("parametricCurve".to_string(), parametric_curve_schema());
    properties.insert("hsl".to_string(), hsl_schema());
    properties.insert("colorGrading".to_string(), color_grading_schema());
    properties.insert("colorCalibration".to_string(), color_calibration_schema());
    properties.insert("crop".to_string(), json!({ "type": ["object", "null"] }));
    properties.insert("masks".to_string(), json!({ "type": "array" }));
    properties.insert("lutPath".to_string(), json!({ "type": ["string", "null"] }));
    properties.insert(
        "lensMaker".to_string(),
        json!({ "type": ["string", "null"] }),
    );
    properties.insert(
        "lensModel".to_string(),
        json!({ "type": ["string", "null"] }),
    );
    properties.insert(
        "aspectRatio".to_string(),
        json!({ "type": ["number", "null"], "exclusiveMinimum": 0 }),
    );
    properties.insert("aiPatches".to_string(), json!({ "type": "array" }));
    properties.insert("sectionVisibility".to_string(), json!({ "type": "object" }));
    properties.insert("showClipping".to_string(), json!({ "type": "boolean" }));
    properties.insert(
        "curveMode".to_string(),
        json!({
            "type": "string",
            "enum": ["point", "parametric"],
            "description": "Select point curves or parametric curves as the active curve editor mode."
        }),
    );
    properties.insert(
        "toneMapper".to_string(),
        json!({
            "type": "string",
            "enum": ["basic", "agx"],
            "description": "Tone mapper used for this edit. Use exposure for EV shift."
        }),
    );
    properties.insert(
        "lensCorrectionMode".to_string(),
        json!({ "type": "string", "enum": ["auto", "manual"] }),
    );
    properties.insert(
        "lensBlurShape".to_string(),
        json!({ "type": "string", "enum": ["circle", "hexagon", "octagon", "ring"] }),
    );
    properties.insert(
        "lensBlurDepthMap".to_string(),
        json!({ "type": ["string", "null"] }),
    );
    properties.insert(
        "lensDistortionParams".to_string(),
        json!({ "type": ["object", "null"] }),
    );
    for key in [
        "lensBlurEnabled",
        "lensDistortionEnabled",
        "lensTcaEnabled",
        "lensVignetteEnabled",
    ] {
        properties.insert(key.to_string(), json!({ "type": "boolean" }));
    }

    json!({
        "type": "object",
        "description": "RapidRAW adjustment object. Scalar controls include min/max bounds. Curves, HSL, color grading, and color calibration expose their nested channels and bounds below. Omitted fields are allowed for sparse update_adjustments calls.",
        "additionalProperties": true,
        "propertyNames": { "enum": adjustment_keys() },
        "properties": properties,
    })
}

fn strict_object_schema(description: &str, properties: Map<String, Value>) -> Value {
    json!({
        "type": "object",
        "description": description,
        "additionalProperties": false,
        "properties": properties,
    })
}

fn strict_object_schema_with_required(
    description: &str,
    properties: Map<String, Value>,
    required: &[&str],
) -> Value {
    let mut schema = strict_object_schema(description, properties);
    if let Some(object) = schema.as_object_mut() {
        object.insert(
            "required".to_string(),
            Value::Array(
                required
                    .iter()
                    .map(|key| Value::String((*key).to_string()))
                    .collect(),
            ),
        );
    }
    schema
}

fn curves_schema(description: &str) -> Value {
    let mut point_properties = Map::new();
    point_properties.insert(
        "x".to_string(),
        ranged_number_schema(0.0, 255.0, "Input coordinate."),
    );
    point_properties.insert(
        "y".to_string(),
        ranged_number_schema(0.0, 255.0, "Output coordinate."),
    );
    let point_schema =
        strict_object_schema_with_required("A curve control point.", point_properties, &["x", "y"]);

    let mut properties = Map::new();
    for channel in ["luma", "red", "green", "blue"] {
        properties.insert(
            channel.to_string(),
            json!({
                "type": "array",
                "description": format!("{channel} channel control points."),
                "minItems": 2,
                "items": point_schema.clone(),
            }),
        );
    }
    strict_object_schema(description, properties)
}

fn parametric_curve_schema() -> Value {
    let mut settings = Map::new();
    for (key, minimum, maximum, description) in [
        ("darks", -100.0, 100.0, "Darks adjustment."),
        ("shadows", -100.0, 100.0, "Shadows adjustment."),
        ("highlights", -100.0, 100.0, "Highlights adjustment."),
        ("lights", -100.0, 100.0, "Lights adjustment."),
        ("whiteLevel", -100.0, 0.0, "White point level."),
        ("blackLevel", 0.0, 100.0, "Black point level."),
        ("split1", 0.0, 100.0, "First tonal split position."),
        ("split2", 0.0, 100.0, "Second tonal split position."),
        ("split3", 0.0, 100.0, "Third tonal split position."),
    ] {
        settings.insert(
            key.to_string(),
            ranged_number_schema(minimum, maximum, description),
        );
    }
    let settings_schema = strict_object_schema(
        "Parametric curve settings for one channel. Omitted settings keep their current values during update_adjustments.",
        settings,
    );

    let mut properties = Map::new();
    for channel in ["luma", "red", "green", "blue"] {
        properties.insert(channel.to_string(), settings_schema.clone());
    }
    strict_object_schema(
        "Parametric settings for the luma, red, green, and blue channels.",
        properties,
    )
}

fn hue_sat_lum_schema(
    hue_minimum: f64,
    hue_maximum: f64,
    saturation_minimum: f64,
    saturation_maximum: f64,
    description: &str,
) -> Value {
    let mut properties = Map::new();
    properties.insert(
        "hue".to_string(),
        ranged_number_schema(hue_minimum, hue_maximum, "Hue."),
    );
    properties.insert(
        "saturation".to_string(),
        ranged_number_schema(saturation_minimum, saturation_maximum, "Saturation."),
    );
    properties.insert(
        "luminance".to_string(),
        ranged_number_schema(-100.0, 100.0, "Luminance."),
    );
    strict_object_schema(description, properties)
}

fn hsl_schema() -> Value {
    let mut properties = Map::new();
    for color in [
        "reds", "oranges", "yellows", "greens", "aquas", "blues", "purples", "magentas",
    ] {
        properties.insert(
            color.to_string(),
            hue_sat_lum_schema(-100.0, 100.0, -100.0, 100.0, "HSL channel settings."),
        );
    }
    strict_object_schema("HSL mixer settings for each color range.", properties)
}

fn color_grading_schema() -> Value {
    let mut properties = Map::new();
    let wheel_schema = hue_sat_lum_schema(
        0.0,
        360.0,
        0.0,
        100.0,
        "Color wheel settings. Hue is degrees; saturation and luminance are percentages.",
    );
    for range in ["shadows", "midtones", "highlights", "global"] {
        properties.insert(range.to_string(), wheel_schema.clone());
    }
    properties.insert(
        "blending".to_string(),
        ranged_number_schema(0.0, 100.0, "Blending between color wheels."),
    );
    properties.insert(
        "balance".to_string(),
        ranged_number_schema(-100.0, 100.0, "Balance between shadows and highlights."),
    );
    strict_object_schema(
        "Three-way and global color grading. Omitted nested fields keep their current values during update_adjustments.",
        properties,
    )
}

fn color_calibration_schema() -> Value {
    let mut properties = Map::new();
    for key in [
        "shadowsTint",
        "redHue",
        "redSaturation",
        "greenHue",
        "greenSaturation",
        "blueHue",
        "blueSaturation",
    ] {
        properties.insert(
            key.to_string(),
            ranged_number_schema(-100.0, 100.0, "Color calibration control."),
        );
    }
    strict_object_schema("Color calibration controls.", properties)
}

fn ranged_number_schema(minimum: f64, maximum: f64, description: &str) -> Value {
    json!({ "type": "number", "minimum": minimum, "maximum": maximum, "description": description })
}

fn adjustment_keys() -> Vec<String> {
    let mut keys: Vec<String> = crate::all_available_adjustments()
        .into_iter()
        .chain(
            [
                "aiPatches",
                "sectionVisibility",
                "showClipping",
                "lensBlurEnabled",
                "lensBlurAmount",
                "lensBlurDiffusion",
                "lensBlurShape",
                "lensBlurDepthMap",
                "lensBlurMaxDepth",
                "lensBlurMaxFade",
                "lensBlurMinDepth",
                "lensBlurMinFade",
                "lensDistortionParams",
            ]
            .into_iter()
            .map(String::from),
        )
        .collect();
    keys.sort();
    keys.dedup();
    keys
}

pub(super) fn revision_for(path: &str, adjustments: &Value) -> String {
    let input = serde_json::to_vec(&json!({ "path": path, "adjustments": adjustments }))
        .unwrap_or_default();
    blake3::hash(&input).to_hex().to_string()
}

pub(super) fn validate_adjustments(adjustments: &Value) -> Result<(), String> {
    let Some(object) = adjustments.as_object() else {
        return Err("adjustments must be a JSON object".to_string());
    };
    let allowed = adjustment_keys();
    for key in object.keys() {
        if !allowed.iter().any(|allowed_key| allowed_key == key) {
            return Err(format!("unsupported adjustment key: {key}"));
        }
        if let Some((minimum, maximum)) = numeric_adjustment_range(key)
            && let Some(value) = object.get(key)
        {
            if key == "orientationSteps" && value.as_u64().is_none() {
                return Err("adjustment orientationSteps must be an integer".to_string());
            }
            let Some(value) = value.as_f64() else {
                return Err(format!("adjustment {key} must be a number"));
            };
            if !(minimum..=maximum).contains(&value) {
                return Err(format!(
                    "adjustment {key} must be between {minimum} and {maximum}"
                ));
            }
        }
        if let Some(value) = object.get(key) {
            match key.as_str() {
                "curves" | "pointCurves" => validate_curves(value, key)?,
                "parametricCurve" => validate_parametric_curve(value)?,
                "hsl" => validate_hsl(value)?,
                "colorGrading" => validate_color_grading(value)?,
                "colorCalibration" => validate_color_calibration(value)?,
                "curveMode" => validate_string_enum(value, key, &["point", "parametric"])?,
                "toneMapper" => validate_string_enum(value, key, &["basic", "agx"])?,
                "lensCorrectionMode" => validate_string_enum(value, key, &["auto", "manual"])?,
                "lensBlurShape" => {
                    validate_string_enum(value, key, &["circle", "hexagon", "octagon", "ring"])?
                }
                _ => {}
            }
        }
    }
    Ok(())
}

fn validate_string_enum(value: &Value, key: &str, allowed: &[&str]) -> Result<(), String> {
    let value = value
        .as_str()
        .ok_or_else(|| format!("adjustment {key} must be a string"))?;
    if allowed.contains(&value) {
        Ok(())
    } else {
        Err(format!(
            "adjustment {key} must be one of: {}",
            allowed.join(", ")
        ))
    }
}

fn validate_nested_object<'a>(
    value: &'a Value,
    key: &str,
) -> Result<&'a Map<String, Value>, String> {
    value
        .as_object()
        .ok_or_else(|| format!("adjustment {key} must be an object"))
}

fn validate_nested_keys(
    object: &Map<String, Value>,
    key: &str,
    allowed: &[&str],
) -> Result<(), String> {
    for nested_key in object.keys() {
        if !allowed.contains(&nested_key.as_str()) {
            return Err(format!("unsupported adjustment key: {key}.{nested_key}"));
        }
    }
    Ok(())
}

fn validate_number(value: &Value, key: &str, minimum: f64, maximum: f64) -> Result<(), String> {
    let value = value
        .as_f64()
        .ok_or_else(|| format!("adjustment {key} must be a number"))?;
    if !(minimum..=maximum).contains(&value) {
        Err(format!(
            "adjustment {key} must be between {minimum} and {maximum}"
        ))
    } else {
        Ok(())
    }
}

fn validate_curves(value: &Value, key: &str) -> Result<(), String> {
    let object = validate_nested_object(value, key)?;
    let channels = ["luma", "red", "green", "blue"];
    validate_nested_keys(object, key, &channels)?;
    for channel in channels {
        let Some(points) = object.get(channel) else {
            continue;
        };
        let points = points
            .as_array()
            .ok_or_else(|| format!("adjustment {key}.{channel} must be an array"))?;
        if points.len() < 2 {
            return Err(format!(
                "adjustment {key}.{channel} must contain at least two points"
            ));
        }
        let mut previous_x = -1.0;
        for (index, point) in points.iter().enumerate() {
            let point_key = format!("{key}.{channel}[{index}]");
            let point = validate_nested_object(point, &point_key)?;
            validate_nested_keys(point, &point_key, &["x", "y"])?;
            let x = point
                .get("x")
                .ok_or_else(|| format!("adjustment {point_key}.x is required"))?;
            let y = point
                .get("y")
                .ok_or_else(|| format!("adjustment {point_key}.y is required"))?;
            validate_number(x, &format!("{point_key}.x"), 0.0, 255.0)?;
            validate_number(y, &format!("{point_key}.y"), 0.0, 255.0)?;
            let x = x.as_f64().unwrap_or_default();
            if x < previous_x {
                return Err(format!(
                    "adjustment {key}.{channel} points must be ordered by x"
                ));
            }
            previous_x = x;
        }
    }
    Ok(())
}

fn validate_parametric_curve(value: &Value) -> Result<(), String> {
    let object = validate_nested_object(value, "parametricCurve")?;
    let channels = ["luma", "red", "green", "blue"];
    validate_nested_keys(object, "parametricCurve", &channels)?;
    let settings = [
        ("darks", -100.0, 100.0),
        ("shadows", -100.0, 100.0),
        ("highlights", -100.0, 100.0),
        ("lights", -100.0, 100.0),
        ("whiteLevel", -100.0, 0.0),
        ("blackLevel", 0.0, 100.0),
        ("split1", 0.0, 100.0),
        ("split2", 0.0, 100.0),
        ("split3", 0.0, 100.0),
    ];
    let allowed: Vec<_> = settings.iter().map(|(key, _, _)| *key).collect();
    for channel in channels {
        let Some(channel_value) = object.get(channel) else {
            continue;
        };
        let channel_key = format!("parametricCurve.{channel}");
        let channel_object = validate_nested_object(channel_value, &channel_key)?;
        validate_nested_keys(channel_object, &channel_key, &allowed)?;
        for (key, minimum, maximum) in settings {
            if let Some(value) = channel_object.get(key) {
                validate_number(
                    value,
                    &format!("parametricCurve.{channel}.{key}"),
                    minimum,
                    maximum,
                )?;
            }
        }
    }
    Ok(())
}

fn validate_hue_sat_lum(
    value: &Value,
    key: &str,
    hue_minimum: f64,
    hue_maximum: f64,
    saturation_minimum: f64,
    saturation_maximum: f64,
) -> Result<(), String> {
    let object = validate_nested_object(value, key)?;
    validate_nested_keys(object, key, &["hue", "saturation", "luminance"])?;
    if let Some(value) = object.get("hue") {
        validate_number(value, &format!("{key}.hue"), hue_minimum, hue_maximum)?;
    }
    if let Some(value) = object.get("saturation") {
        validate_number(
            value,
            &format!("{key}.saturation"),
            saturation_minimum,
            saturation_maximum,
        )?;
    }
    if let Some(value) = object.get("luminance") {
        validate_number(value, &format!("{key}.luminance"), -100.0, 100.0)?;
    }
    Ok(())
}

fn validate_hsl(value: &Value) -> Result<(), String> {
    let object = validate_nested_object(value, "hsl")?;
    let colors = [
        "reds", "oranges", "yellows", "greens", "aquas", "blues", "purples", "magentas",
    ];
    validate_nested_keys(object, "hsl", &colors)?;
    for color in colors {
        if let Some(value) = object.get(color) {
            validate_hue_sat_lum(value, &format!("hsl.{color}"), -100.0, 100.0, -100.0, 100.0)?;
        }
    }
    Ok(())
}

fn validate_color_grading(value: &Value) -> Result<(), String> {
    let object = validate_nested_object(value, "colorGrading")?;
    let ranges = ["shadows", "midtones", "highlights", "global"];
    validate_nested_keys(
        object,
        "colorGrading",
        &[
            "shadows",
            "midtones",
            "highlights",
            "global",
            "blending",
            "balance",
        ],
    )?;
    for range in ranges {
        if let Some(value) = object.get(range) {
            validate_hue_sat_lum(
                value,
                &format!("colorGrading.{range}"),
                0.0,
                360.0,
                0.0,
                100.0,
            )?;
        }
    }
    if let Some(value) = object.get("blending") {
        validate_number(value, "colorGrading.blending", 0.0, 100.0)?;
    }
    if let Some(value) = object.get("balance") {
        validate_number(value, "colorGrading.balance", -100.0, 100.0)?;
    }
    Ok(())
}

fn validate_color_calibration(value: &Value) -> Result<(), String> {
    let object = validate_nested_object(value, "colorCalibration")?;
    let fields = [
        "shadowsTint",
        "redHue",
        "redSaturation",
        "greenHue",
        "greenSaturation",
        "blueHue",
        "blueSaturation",
    ];
    validate_nested_keys(object, "colorCalibration", &fields)?;
    for field in fields {
        if let Some(value) = object.get(field) {
            validate_number(value, &format!("colorCalibration.{field}"), -100.0, 100.0)?;
        }
    }
    Ok(())
}

fn numeric_adjustment_range(key: &str) -> Option<(f64, f64)> {
    match key {
        "exposure" | "brightness" => Some((-5.0, 5.0)),
        "contrast"
        | "highlights"
        | "shadows"
        | "whites"
        | "blacks"
        | "temperature"
        | "tint"
        | "saturation"
        | "vibrance"
        | "clarity"
        | "structure"
        | "dehaze"
        | "sharpness"
        | "centré"
        | "chromaticAberrationRedCyan"
        | "chromaticAberrationBlueYellow"
        | "vignetteAmount"
        | "vignetteRoundness"
        | "lensDistortionAmount"
        | "lensVignetteAmount"
        | "lensTcaAmount"
        | "transformDistortion"
        | "transformVertical"
        | "transformHorizontal"
        | "transformAspect"
        | "transformXOffset"
        | "transformYOffset" => Some((-100.0, 100.0)),
        "hue" | "transformRotate" | "rotation" => Some((-180.0, 180.0)),
        "sharpnessThreshold" => Some((0.0, 80.0)),
        "lumaNoiseReduction"
        | "colorNoiseReduction"
        | "lensBlurAmount"
        | "lensBlurDiffusion"
        | "lensBlurMaxDepth"
        | "lensBlurMaxFade"
        | "lensBlurMinDepth"
        | "lensBlurMinFade"
        | "vignetteFeather"
        | "vignetteMidpoint"
        | "grainAmount"
        | "grainRoughness"
        | "grainSize"
        | "glowAmount"
        | "halationAmount"
        | "flareAmount" => Some((0.0, 100.0)),
        "orientationSteps" => Some((0.0, 3.0)),
        "transformScale" => Some((0.0, 500.0)),
        "lutIntensity" => Some((0.0, 100.0)),
        _ => None,
    }
}

pub(super) fn merge_adjustments(current: Value, changes: Value) -> Result<Value, String> {
    let mut current = current.as_object().cloned().unwrap_or_else(Map::new);
    let changes = changes
        .as_object()
        .ok_or("changes must be a JSON object".to_string())?;
    for (key, change) in changes {
        let merged = match (current.get(key), change) {
            (Some(existing), Value::Object(_)) if existing.is_object() => {
                merge_adjustments(existing.clone(), change.clone())?
            }
            _ => change.clone(),
        };
        current.insert(key.clone(), merged);
    }
    Ok(Value::Object(current))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn revision_is_stable_for_same_edit() {
        let adjustments = json!({ "exposure": 0.5, "crop": null });
        assert_eq!(
            revision_for("/tmp/example.raw", &adjustments),
            revision_for("/tmp/example.raw", &adjustments)
        );
        assert_ne!(
            revision_for("/tmp/example.raw", &adjustments),
            revision_for("/tmp/other.raw", &adjustments)
        );
    }

    #[test]
    fn adjustment_validation_rejects_unknown_fields() {
        assert!(validate_adjustments(&json!({ "exposure": 0.5 })).is_ok());
        assert!(validate_adjustments(&json!({ "exposure": 6.0 })).is_err());
        assert!(validate_adjustments(&json!({ "notAnAdjustment": 1 })).is_err());
        assert!(validate_adjustments(&json!({ "orientationSteps": 1.5 })).is_err());
        assert!(validate_adjustments(&json!(null)).is_err());
    }

    #[test]
    fn nested_adjustment_validation_matches_editor_ranges() {
        assert!(
            validate_adjustments(&json!({
                "toneMapper": "agx",
                "exposure": 0.5,
                "curves": { "red": [{ "x": 0, "y": 0 }, { "x": 255, "y": 255 }] },
                "parametricCurve": { "luma": { "whiteLevel": -25, "split2": 50 } },
                "colorGrading": { "shadows": { "hue": 220, "saturation": 35, "luminance": -10 } }
            }))
            .is_ok()
        );
        assert!(
            validate_adjustments(&json!({
                "curves": { "red": [{ "x": 0, "y": 0 }, { "x": 256, "y": 255 }] }
            }))
            .is_err()
        );
        assert!(
            validate_adjustments(&json!({
                "parametricCurve": { "luma": { "whiteLevel": 1 } }
            }))
            .is_err()
        );
        assert!(
            validate_adjustments(&json!({
                "colorGrading": { "shadows": { "hue": 361 } }
            }))
            .is_err()
        );
    }

    #[test]
    fn update_merges_nested_adjustment_fields() {
        let merged = merge_adjustments(
            json!({ "exposure": 0.0, "hsl": { "red": { "hue": 1.0, "saturation": 2.0 }, "blue": { "hue": 3.0 } } }),
            json!({ "exposure": 0.75, "hsl": { "red": { "hue": 4.0 } } }),
        ).expect("valid adjustment object");
        assert_eq!(merged["exposure"], 0.75);
        assert_eq!(merged["hsl"]["red"]["hue"], 4.0);
        assert_eq!(merged["hsl"]["red"]["saturation"], 2.0);
        assert_eq!(merged["hsl"]["blue"]["hue"], 3.0);
    }
}
