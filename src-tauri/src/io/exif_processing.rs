use std::collections::HashMap;
use std::fs;
use std::io::{BufReader, Cursor, Write};
use std::path::{Path, PathBuf};

use crate::formats::is_raw_file;
use crate::image_processing::{
    ImageMetadata, PERSISTED_RENDER_STATE_SCHEMA_VERSION, PersistedRenderState,
    PersistedStateRecoveryReceipt,
};
use chrono::{DateTime, NaiveDateTime, Utc};
use exif::{Exif, In, Tag, Value};
use little_exif::exif_tag::ExifTag;
use little_exif::filetype::FileExtension;
use little_exif::metadata::Metadata;
use little_exif::rational::{iR64, uR64};
use rawler::decoders::RawMetadata;
use serde::Serialize;
use serde_json::{Map, Value as JsonValue};
use sha2::{Digest, Sha256};

pub fn truncate_large_exif(value: &str) -> String {
    if value.len() <= 500 {
        return value.to_string();
    }

    let mut start_idx = 200;
    while !value.is_char_boundary(start_idx) {
        start_idx -= 1;
    }

    let mut end_idx = value.len() - 200;
    while !value.is_char_boundary(end_idx) {
        end_idx += 1;
    }

    if start_idx < end_idx {
        let start_str = &value[..start_idx];
        let end_str = &value[end_idx..];
        return format!("{}...{}", start_str, end_str);
    }

    value.to_string()
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum PersistedStateOutcome {
    Absent,
    Current,
    Migrated,
    Recovered,
    Quarantined,
    Unsupported,
}

#[derive(Debug, Clone)]
pub struct PersistedStateLoad {
    pub metadata: ImageMetadata,
    pub outcome: PersistedStateOutcome,
    pub backup_path: Option<PathBuf>,
    pub reason_codes: Vec<String>,
}

const PERSISTED_STATE_IMPLEMENTATION_REVISION: u32 = 2;
const MAX_QUARANTINE_BACKUPS: usize = 3;

pub fn load_sidecar(sidecar_path: &Path) -> ImageMetadata {
    load_sidecar_recovering(sidecar_path, None)
        .map(|loaded| loaded.metadata)
        .unwrap_or_default()
}

pub fn load_sidecar_recovering(
    sidecar_path: &Path,
    expected_source_identity: Option<&str>,
) -> Result<PersistedStateLoad, String> {
    if !sidecar_path.exists() {
        log::debug!(
            "persisted_state_outcome=absent sidecar={}",
            sidecar_path.display()
        );
        return Ok(PersistedStateLoad {
            metadata: ImageMetadata::default(),
            outcome: PersistedStateOutcome::Absent,
            backup_path: None,
            reason_codes: Vec::new(),
        });
    }

    let bytes = fs::read(sidecar_path)
        .map_err(|error| format!("Failed to read sidecar {}: {error}", sidecar_path.display()))?;
    let content = String::from_utf8(bytes.clone())
        .map_err(|error| format!("Sidecar {} is not UTF-8: {error}", sidecar_path.display()));

    let mut reasons = Vec::new();
    let mut disabled_fields = Vec::new();
    let mut migrated_fields = Vec::new();
    let mut quarantined_extensions = Map::new();
    let mut outcome = PersistedStateOutcome::Current;
    let parsed = content
        .as_deref()
        .ok()
        .and_then(|text| serde_json::from_str::<JsonValue>(text).ok());
    let mut meta = match parsed {
        Some(document) => match serde_json::from_value::<ImageMetadata>(document) {
            Ok(metadata) => metadata,
            Err(_) => {
                reasons.push("sidecar_shape_invalid".to_string());
                outcome = PersistedStateOutcome::Quarantined;
                ImageMetadata::default()
            }
        },
        None => {
            reasons.push(if content.is_err() {
                "sidecar_encoding_invalid".to_string()
            } else {
                "sidecar_json_malformed".to_string()
            });
            outcome = PersistedStateOutcome::Quarantined;
            ImageMetadata::default()
        }
    };
    if heal_large_exif(&mut meta) {
        reasons.push("oversized_exif_trimmed".to_string());
        disabled_fields.push("exif.oversizedValues".to_string());
        if outcome == PersistedStateOutcome::Current {
            outcome = PersistedStateOutcome::Recovered;
        }
    }

    if meta.version > PERSISTED_RENDER_STATE_SCHEMA_VERSION
        || meta
            .persisted_render_state
            .as_ref()
            .is_some_and(|state| state.schema_version > PERSISTED_RENDER_STATE_SCHEMA_VERSION)
    {
        reasons.push("unsupported_future_document".to_string());
        outcome = PersistedStateOutcome::Unsupported;
        quarantine_all_render_state(&mut meta, &mut quarantined_extensions);
    } else {
        if let Some(user_edits) = meta
            .persisted_render_state
            .as_ref()
            .and_then(|state| state.user_edits.clone())
        {
            meta.adjustments = JsonValue::Object(user_edits);
        }
        let legacy = meta.version < PERSISTED_RENDER_STATE_SCHEMA_VERSION
            || meta.persisted_render_state.is_none()
            || meta
                .persisted_render_state
                .as_ref()
                .is_some_and(|state| state.schema_version < PERSISTED_RENDER_STATE_SCHEMA_VERSION)
            || meta
                .persisted_render_state
                .as_ref()
                .is_some_and(|state| state.user_edits.is_none())
            || meta.persisted_render_state.as_ref().is_some_and(|state| {
                state.implementation_revision < PERSISTED_STATE_IMPLEMENTATION_REVISION
            })
            || expected_source_identity.is_some_and(|_| {
                meta.persisted_render_state
                    .as_ref()
                    .is_some_and(|state| state.source_identity.is_empty())
            });
        if legacy && outcome == PersistedStateOutcome::Current {
            outcome = PersistedStateOutcome::Migrated;
            reasons.push("legacy_render_state_migrated".to_string());
        }
        let source_dimensions = crop_requires_unit_migration(&meta.adjustments)
            .then(|| {
                expected_source_identity
                    .and_then(resolve_oriented_source_dimensions)
                    .or_else(|| source_dimensions_for_sidecar(sidecar_path))
            })
            .flatten()
            .map(|dimensions| orient_dimensions_for_adjustments(dimensions, &meta.adjustments));
        validate_adjustments(
            &mut meta.adjustments,
            &mut quarantined_extensions,
            &mut disabled_fields,
            &mut migrated_fields,
            &mut reasons,
            source_dimensions,
        );
        if !migrated_fields.is_empty() && outcome == PersistedStateOutcome::Current {
            outcome = PersistedStateOutcome::Migrated;
        }
        validate_artifacts(
            &mut meta,
            expected_source_identity,
            &mut disabled_fields,
            &mut reasons,
        );
        if !disabled_fields.is_empty() && outcome != PersistedStateOutcome::Quarantined {
            outcome = PersistedStateOutcome::Recovered;
        }
    }

    let previous_revision = meta
        .persisted_render_state
        .as_ref()
        .map(|state| state.edit_revision.clone());
    if let (Some(expected), Some(state)) = (expected_source_identity, &meta.persisted_render_state)
        && !state.source_identity.is_empty()
        && state.source_identity != expected
    {
        reasons.push("source_identity_mismatch".to_string());
        disabled_fields.push("adjustments".to_string());
        quarantine_all_render_state(&mut meta, &mut quarantined_extensions);
        outcome = PersistedStateOutcome::Quarantined;
    }

    if outcome == PersistedStateOutcome::Current {
        log::debug!(
            "persisted_state_outcome=current sidecar={}",
            sidecar_path.display()
        );
        return Ok(PersistedStateLoad {
            metadata: meta,
            outcome,
            backup_path: None,
            reason_codes: reasons,
        });
    }

    let source_identity = expected_source_identity.unwrap_or_default().to_string();
    let from_version = meta.version;
    meta.version = PERSISTED_RENDER_STATE_SCHEMA_VERSION;
    let edit_revision =
        render_state_revision(&meta.adjustments, meta.raw_engine_artifacts.as_ref())?;
    let receipt = PersistedStateRecoveryReceipt {
        from_version,
        to_version: PERSISTED_RENDER_STATE_SCHEMA_VERSION,
        source_identity: source_identity.clone(),
        previous_edit_revision: previous_revision,
        disabled_fields,
        migrated_fields,
        reason_codes: reasons.clone(),
    };
    let mut receipts = meta
        .persisted_render_state
        .take()
        .map(|state| state.recovery_receipts)
        .unwrap_or_default();
    if receipts.last() != Some(&receipt) {
        receipts.push(receipt);
    }
    meta.persisted_render_state = Some(PersistedRenderState {
        schema_version: PERSISTED_RENDER_STATE_SCHEMA_VERSION,
        implementation_revision: PERSISTED_STATE_IMPLEMENTATION_REVISION,
        source_identity,
        edit_revision,
        user_edits: meta.adjustments.as_object().cloned(),
        defaults_policy_revision: 1,
        camera_input_transform_receipt: None,
        xmp_revision: None,
        recovery_receipts: receipts,
        quarantined_extensions,
    });

    let backup_path = quarantine_original_bytes(sidecar_path, &bytes)?;
    save_sidecar_metadata_atomic(sidecar_path, &meta)?;
    log::warn!(
        "persisted_state_outcome={:?} sidecar={} backup={} reasons={}",
        outcome,
        sidecar_path.display(),
        backup_path.display(),
        reasons.join(",")
    );
    Ok(PersistedStateLoad {
        metadata: meta,
        outcome,
        backup_path: Some(backup_path),
        reason_codes: reasons,
    })
}

fn render_state_revision(
    adjustments: &JsonValue,
    artifacts: Option<&crate::image_processing::RawEngineArtifacts>,
) -> Result<String, String> {
    let bytes = serde_json::to_vec(&(adjustments, artifacts))
        .map_err(|error| format!("Failed to hash persisted render state: {error}"))?;
    Ok(format!("sha256:{}", hex::encode(Sha256::digest(bytes))))
}

fn quarantine_all_render_state(meta: &mut ImageMetadata, extensions: &mut Map<String, JsonValue>) {
    if !meta.adjustments.is_null() && meta.adjustments != serde_json::json!({}) {
        extensions.insert(
            "rejectedAdjustments".to_string(),
            std::mem::take(&mut meta.adjustments),
        );
    }
    meta.adjustments = serde_json::json!({});
    if let Some(artifacts) = meta.raw_engine_artifacts.take()
        && let Ok(value) = serde_json::to_value(artifacts)
    {
        extensions.insert("rejectedRawEngineArtifacts".to_string(), value);
    }
}

fn crop_requires_unit_migration(adjustments: &JsonValue) -> bool {
    adjustments
        .get("crop")
        .and_then(JsonValue::as_object)
        .is_some_and(|crop| {
            matches!(
                crop.get("unit").and_then(JsonValue::as_str),
                Some("px" | "%")
            ) || crop
                .values()
                .filter_map(JsonValue::as_f64)
                .any(|value| value > 1.0)
        })
}

fn resolve_oriented_source_dimensions(source_identity: &str) -> Option<(u32, u32)> {
    let source_path = crate::file_management::parse_virtual_path(source_identity).0;
    if is_raw_file(&source_path) {
        let bytes = fs::read(&source_path).ok()?;
        let source = rawler::rawsource::RawSource::new_from_slice(&bytes);
        let decoder = rawler::get_decoder(&source).ok()?;
        let raw = decoder
            .raw_image(&source, &rawler::decoders::RawDecodeParams::default(), true)
            .ok()?;
        let active_dimensions = raw
            .active_area
            .map(|area| (area.d.w, area.d.h))
            .unwrap_or((raw.width, raw.height));
        let developed_dimensions = raw
            .crop_area
            .map(|mut crop| {
                if let Some(active_area) = raw.active_area {
                    crop = crop.intersection(&active_area).adapt(&active_area);
                }
                if crop.is_empty() {
                    active_dimensions
                } else {
                    (crop.d.w, crop.d.h)
                }
            })
            .unwrap_or(active_dimensions);
        let orientation = decoder
            .raw_metadata(&source, &Default::default())
            .ok()
            .and_then(|metadata| metadata.exif.orientation)
            .unwrap_or(1);
        return Some(oriented_dimensions(
            developed_dimensions.0 as u32,
            developed_dimensions.1 as u32,
            orientation,
        ));
    }

    let (width, height) = image::image_dimensions(&source_path).ok()?;
    let orientation = fs::read(&source_path)
        .ok()
        .and_then(|bytes| read_exif(&bytes))
        .and_then(|exif| {
            exif.get_field(Tag::Orientation, In::PRIMARY)?
                .value
                .get_uint(0)
        })
        .unwrap_or(1) as u16;
    Some(oriented_dimensions(width, height, orientation))
}

fn source_dimensions_for_sidecar(sidecar_path: &Path) -> Option<(u32, u32)> {
    let name = sidecar_path.file_name()?.to_string_lossy();
    let without_sidecar = name.strip_suffix(".rrdata")?;
    let mut candidate = sidecar_path.with_file_name(without_sidecar);
    if !candidate.exists() {
        candidate = candidate.with_extension("");
    }
    candidate
        .exists()
        .then(|| resolve_oriented_source_dimensions(&candidate.to_string_lossy()))
        .flatten()
}

fn oriented_dimensions(width: u32, height: u32, exif_orientation: u16) -> (u32, u32) {
    if matches!(exif_orientation, 5..=8) {
        (height, width)
    } else {
        (width, height)
    }
}

fn orient_dimensions_for_adjustments(
    dimensions: (u32, u32),
    adjustments: &JsonValue,
) -> (u32, u32) {
    let quarter_turns = adjustments
        .get("orientationSteps")
        .and_then(JsonValue::as_i64)
        .unwrap_or(0)
        .rem_euclid(4);
    if quarter_turns % 2 == 1 {
        (dimensions.1, dimensions.0)
    } else {
        dimensions
    }
}

fn migrate_crop_to_normalized(
    adjustments: &mut Map<String, JsonValue>,
    extensions: &mut Map<String, JsonValue>,
    disabled: &mut Vec<String>,
    migrated: &mut Vec<String>,
    reasons: &mut Vec<String>,
    oriented_source_dimensions: Option<(u32, u32)>,
) {
    let Some(crop_value) = adjustments.get("crop").cloned() else {
        return;
    };
    if crop_value.is_null() {
        return;
    }
    let Some(crop) = crop_value.as_object() else {
        quarantine_crop(
            adjustments,
            extensions,
            disabled,
            reasons,
            crop_value,
            "crop_shape_invalid",
        );
        return;
    };
    let unit = crop.get("unit").and_then(JsonValue::as_str);
    let values =
        ["x", "y", "width", "height"].map(|field| crop.get(field).and_then(JsonValue::as_f64));
    let [Some(x), Some(y), Some(width), Some(height)] = values else {
        quarantine_crop(
            adjustments,
            extensions,
            disabled,
            reasons,
            crop_value,
            "crop_shape_invalid",
        );
        return;
    };
    let normalized = match unit {
        Some("normalized") | None if [x, y, width, height].iter().all(|value| *value <= 1.0) => {
            [x, y, width, height]
        }
        Some("%") => [x / 100.0, y / 100.0, width / 100.0, height / 100.0],
        Some("px") | None => {
            let Some((source_width, source_height)) = oriented_source_dimensions else {
                quarantine_crop(
                    adjustments,
                    extensions,
                    disabled,
                    reasons,
                    crop_value,
                    "crop_dimensions_unavailable",
                );
                return;
            };
            [
                x / f64::from(source_width),
                y / f64::from(source_height),
                width / f64::from(source_width),
                height / f64::from(source_height),
            ]
        }
        _ => {
            quarantine_crop(
                adjustments,
                extensions,
                disabled,
                reasons,
                crop_value,
                "crop_unit_unsupported",
            );
            return;
        }
    };
    let [x, y, width, height] = normalized;
    let valid = [x, y, width, height]
        .iter()
        .all(|value| value.is_finite() && (0.0..=1.0).contains(value))
        && width > 0.0
        && height > 0.0
        && x + width <= 1.0 + 1.0e-9
        && y + height <= 1.0 + 1.0e-9;
    if !valid {
        quarantine_crop(
            adjustments,
            extensions,
            disabled,
            reasons,
            crop_value,
            "crop_bounds_invalid",
        );
        return;
    }
    let full_frame = x.abs() <= 1.0e-9
        && y.abs() <= 1.0e-9
        && (width - 1.0).abs() <= 1.0e-9
        && (height - 1.0).abs() <= 1.0e-9;
    if full_frame {
        adjustments.remove("crop");
        migrated.push("adjustments.crop".to_string());
        reasons.push("crop_full_frame_removed".to_string());
        return;
    }
    if unit != Some("normalized") {
        adjustments.insert(
            "crop".to_string(),
            serde_json::json!({ "x": x, "y": y, "width": width, "height": height, "unit": "normalized" }),
        );
        migrated.push("adjustments.crop".to_string());
        reasons.push("crop_units_normalized".to_string());
    }
}

fn quarantine_crop(
    adjustments: &mut Map<String, JsonValue>,
    extensions: &mut Map<String, JsonValue>,
    disabled: &mut Vec<String>,
    reasons: &mut Vec<String>,
    crop: JsonValue,
    reason: &str,
) {
    adjustments.remove("crop");
    extensions.insert("rejectedCrop".to_string(), crop);
    disabled.push("adjustments.crop".to_string());
    reasons.push(reason.to_string());
}

fn number_in_range(value: Option<&JsonValue>, min: f64, max: f64) -> bool {
    value
        .and_then(JsonValue::as_f64)
        .is_some_and(|value| value.is_finite() && (min..=max).contains(&value))
}

fn is_valid_view_transform(value: &JsonValue) -> bool {
    let Some(object) = value.as_object() else {
        return false;
    };
    const FIELDS: &[&str] = &[
        "chromaCompression",
        "contrast",
        "latitude",
        "middleGrey",
        "shoulder",
        "sourceBlackEv",
        "sourceWhiteEv",
        "toe",
    ];
    object.len() == FIELDS.len()
        && object.keys().all(|key| FIELDS.contains(&key.as_str()))
        && number_in_range(object.get("chromaCompression"), 0.0, 1.0)
        && number_in_range(object.get("contrast"), 0.5, 2.0)
        && number_in_range(object.get("latitude"), 0.0, 1.0)
        && number_in_range(object.get("middleGrey"), 0.08, 0.3)
        && number_in_range(object.get("shoulder"), 0.0, 1.0)
        && number_in_range(object.get("sourceBlackEv"), -32.0, 32.0)
        && object["sourceBlackEv"]
            .as_f64()
            .is_some_and(|value| value < -1.0)
        && number_in_range(object.get("sourceWhiteEv"), -32.0, 32.0)
        && object["sourceWhiteEv"]
            .as_f64()
            .is_some_and(|value| value > 1.0)
        && number_in_range(object.get("toe"), 0.0, 1.0)
        && object["sourceWhiteEv"].as_f64().unwrap_or_default()
            - object["sourceBlackEv"].as_f64().unwrap_or_default()
            >= 6.0
}

fn is_valid_tone_equalizer(value: &JsonValue) -> bool {
    let Some(object) = value.as_object() else {
        return false;
    };
    const FIELDS: &[&str] = &[
        "autoPlacement",
        "bandEv",
        "detailPreservation",
        "edgeRefinement",
        "enabled",
        "maskExposureCompensation",
        "pivotEv",
        "previewMode",
        "rangeEv",
        "selectedBand",
        "smoothingRadius",
    ];
    let valid_bands = object
        .get("bandEv")
        .and_then(JsonValue::as_array)
        .is_some_and(|bands| {
            bands.len() == 9
                && bands
                    .iter()
                    .all(|band| number_in_range(Some(band), -4.0, 4.0))
        });
    object.len() == FIELDS.len()
        && object.keys().all(|key| FIELDS.contains(&key.as_str()))
        && object
            .get("autoPlacement")
            .is_some_and(JsonValue::is_boolean)
        && valid_bands
        && number_in_range(object.get("detailPreservation"), 0.0, 1.0)
        && number_in_range(object.get("edgeRefinement"), 0.0, 8.0)
        && object.get("enabled").is_some_and(JsonValue::is_boolean)
        && number_in_range(object.get("maskExposureCompensation"), -4.0, 4.0)
        && number_in_range(object.get("pivotEv"), -8.0, 8.0)
        && object
            .get("previewMode")
            .and_then(JsonValue::as_u64)
            .is_some_and(|value| value <= 4)
        && number_in_range(object.get("rangeEv"), 4.0, 24.0)
        && object
            .get("selectedBand")
            .and_then(JsonValue::as_u64)
            .is_some_and(|value| value < 9)
        && number_in_range(object.get("smoothingRadius"), 4.0, 64.0)
}

fn validate_adjustments(
    adjustments: &mut JsonValue,
    extensions: &mut Map<String, JsonValue>,
    disabled: &mut Vec<String>,
    migrated: &mut Vec<String>,
    reasons: &mut Vec<String>,
    oriented_source_dimensions: Option<(u32, u32)>,
) {
    let Some(object) = adjustments.as_object_mut() else {
        if !adjustments.is_null() {
            extensions.insert(
                "invalidAdjustments".to_string(),
                std::mem::take(adjustments),
            );
            disabled.push("adjustments".to_string());
        }
        *adjustments = serde_json::json!({});
        return;
    };
    migrate_crop_to_normalized(
        object,
        extensions,
        disabled,
        migrated,
        reasons,
        oriented_source_dimensions,
    );
    const FORBIDDEN: &[&str] = &[
        "displayIcc",
        "displayLut",
        "displayProfile",
        "outputTransform",
        "cameraToWorkingMatrix",
        "cameraWhiteBalance",
        "legacyWhiteBalance",
        "inputTransform",
    ];
    const KNOWN: &[&str] = &[
        "aiPatches",
        "aspectRatio",
        "blacks",
        "brightness",
        "centré",
        "clarity",
        "chromaticAberrationBlueYellow",
        "chromaticAberrationRedCyan",
        "blackWhiteMixer",
        "cameraProfile",
        "colorBalanceRgb",
        "channelMixer",
        "colorCalibration",
        "colorGrading",
        "colorNoiseReduction",
        "contrast",
        "crop",
        "curves",
        "pointCurves",
        "parametricCurve",
        "curveMode",
        "rawProcessingModeOverride",
        "rawEngineEditGraphVersion",
        "deblurEnabled",
        "deblurSigmaPx",
        "deblurStrength",
        "dustSpotMinRadiusPx",
        "dustSpotOverlayEnabled",
        "dustSpotSensitivity",
        "dehaze",
        "exposure",
        "flipHorizontal",
        "flipVertical",
        "flareAmount",
        "filmLookId",
        "filmLookStrength",
        "glowAmount",
        "grainAmount",
        "grainRoughness",
        "grainSize",
        "halationAmount",
        "highlights",
        "hue",
        "hsl",
        "selectiveColorRangeControls",
        "levels",
        "lensCorrectionMode",
        "lensDistortionAmount",
        "lensVignetteAmount",
        "lensTcaAmount",
        "lensDistortionEnabled",
        "lensTcaEnabled",
        "lensVignetteEnabled",
        "lensDistortionParams",
        "lensMaker",
        "lensModel",
        "localContrastHaloGuard",
        "localContrastMidtoneMask",
        "localContrastRadiusPx",
        "lumaNoiseReduction",
        "lutData",
        "lutIntensity",
        "lutName",
        "lutPath",
        "lutSize",
        "masks",
        "orientationSteps",
        "rotation",
        "saturation",
        "sectionVisibility",
        "shadows",
        "sharpness",
        "sharpnessThreshold",
        "showClipping",
        "skinToneUniformity",
        "structure",
        "temperature",
        "tint",
        "toneMapper",
        "toneEqualizer",
        "viewTransform",
        "toneCurve",
        "transformDistortion",
        "transformVertical",
        "transformHorizontal",
        "transformRotate",
        "transformAspect",
        "transformScale",
        "transformXOffset",
        "transformYOffset",
        "vibrance",
        "vignetteAmount",
        "vignetteFeather",
        "vignetteMidpoint",
        "vignetteRoundness",
        "whites",
        "capturePreSharpening",
        "lutContentIdentity",
        "negativeLab",
        "softProof",
        "panorama",
        "hdrMerge",
    ];
    for field in FORBIDDEN {
        if let Some(value) = object.remove(*field) {
            extensions.insert((*field).to_string(), value);
            disabled.push(format!("adjustments.{field}"));
        }
    }
    for (legacy, canonical) in [
        ("whiteBalanceTemperature", "temperature"),
        ("whiteBalanceTint", "tint"),
        ("rotate", "rotation"),
    ] {
        if let Some(value) = object.remove(legacy) {
            object.entry(canonical.to_string()).or_insert(value);
            disabled.push(format!("adjustments.{legacy}->adjustments.{canonical}"));
        }
    }
    let unknown: Vec<String> = object
        .keys()
        .filter(|key| !KNOWN.contains(&key.as_str()))
        .cloned()
        .collect();
    for field in unknown {
        if let Some(value) = object.remove(&field) {
            extensions.insert(field.clone(), value);
            disabled.push(format!("adjustments.{field}"));
        }
    }
    for (field, supported) in [
        (
            "cameraProfile",
            &[
                "camera_standard",
                "camera_neutral",
                "camera_portrait",
                "camera_landscape",
                "linear_raw",
            ][..],
        ),
        (
            "rawProcessingModeOverride",
            &["fast", "balanced", "maximum"][..],
        ),
        ("toneMapper", &["agx", "basic", "rapidView"][..]),
    ] {
        let invalid = object.get(field).is_some_and(|value| {
            !value.is_null()
                && value
                    .as_str()
                    .is_none_or(|value| !supported.contains(&value))
        });
        if invalid && let Some(value) = object.remove(field) {
            extensions.insert(field.to_string(), value);
            disabled.push(format!("adjustments.{field}"));
        }
    }
    for (field, valid) in [
        (
            "rawEngineEditGraphVersion",
            object.get("rawEngineEditGraphVersion").is_none_or(|value| {
                value
                    .as_u64()
                    .is_some_and(|version| matches!(version, 1 | 2))
            }),
        ),
        (
            "toneEqualizer",
            object
                .get("toneEqualizer")
                .is_none_or(is_valid_tone_equalizer),
        ),
        (
            "viewTransform",
            object
                .get("viewTransform")
                .is_none_or(is_valid_view_transform),
        ),
    ] {
        if !valid && let Some(value) = object.remove(field) {
            extensions.insert(field.to_string(), value);
            disabled.push(format!("adjustments.{field}"));
        }
    }
    for (field, min, max) in [
        ("exposure", -20.0, 20.0),
        ("temperature", -250.0, 250.0),
        ("tint", -250.0, 250.0),
        ("rotation", -360.0, 360.0),
        ("orientationSteps", -4.0, 4.0),
        ("lutIntensity", 0.0, 100.0),
        ("transformScale", 1.0, 1000.0),
    ] {
        let invalid = object
            .get(field)
            .and_then(JsonValue::as_f64)
            .is_some_and(|value| !(min..=max).contains(&value));
        if invalid && let Some(value) = object.remove(field) {
            extensions.insert(field.to_string(), value);
            disabled.push(format!("adjustments.{field}"));
        }
    }
    let invalid_numeric: Vec<String> = object
        .iter()
        .filter(|(_, value)| contains_extreme_number(value))
        .map(|(key, _)| key.clone())
        .collect();
    for field in invalid_numeric {
        if let Some(value) = object.remove(&field) {
            extensions.insert(field.clone(), value);
            disabled.push(format!("adjustments.{field}"));
        }
    }
    if object
        .get("lutPath")
        .and_then(JsonValue::as_str)
        .is_some_and(|path| !Path::new(path).is_file())
    {
        for field in ["lutPath", "lutData", "lutName", "lutSize"] {
            if let Some(value) = object.remove(field) {
                extensions.insert(field.to_string(), value);
            }
        }
        object.insert("lutIntensity".to_string(), JsonValue::from(0));
        disabled.push("adjustments.lut".to_string());
    } else if let (Some(path), Some(expected_hash)) = (
        object.get("lutPath").and_then(JsonValue::as_str),
        object.get("lutContentIdentity").and_then(JsonValue::as_str),
    ) && fs::read(path)
        .ok()
        .map(|bytes| format!("sha256:{}", hex::encode(Sha256::digest(bytes))))
        .as_deref()
        != Some(expected_hash)
    {
        for field in [
            "lutPath",
            "lutData",
            "lutName",
            "lutSize",
            "lutContentIdentity",
        ] {
            if let Some(value) = object.remove(field) {
                extensions.insert(field.to_string(), value);
            }
        }
        object.insert("lutIntensity".to_string(), JsonValue::from(0));
        disabled.push("adjustments.lutContentIdentity".to_string());
    }
}

fn contains_extreme_number(value: &JsonValue) -> bool {
    match value {
        JsonValue::Number(number) => number
            .as_f64()
            .is_none_or(|number| !number.is_finite() || number.abs() > 1_000_000.0),
        JsonValue::Array(values) => values.iter().any(contains_extreme_number),
        JsonValue::Object(values) => values.values().any(contains_extreme_number),
        _ => false,
    }
}

fn validate_artifacts(
    meta: &mut ImageMetadata,
    expected_source: Option<&str>,
    disabled: &mut Vec<String>,
    reasons: &mut Vec<String>,
) {
    let Some(artifacts) = meta.raw_engine_artifacts.as_mut() else {
        return;
    };
    if artifacts.schema_version != 1 {
        meta.raw_engine_artifacts = None;
        disabled.push("rawEngineArtifacts".to_string());
        reasons.push("artifact_schema_unsupported".to_string());
        return;
    }
    if let Some(expected) = expected_source {
        let before = artifacts.layer_stack_sidecars.len();
        artifacts.layer_stack_sidecars.retain(|sidecar| {
            sidecar.get("schemaVersion").and_then(JsonValue::as_u64) == Some(1)
                && sidecar
                    .get("sourceImagePath")
                    .and_then(JsonValue::as_str)
                    .is_some_and(|source| render_sources_match(source, expected))
        });
        if before != artifacts.layer_stack_sidecars.len() {
            disabled.push("rawEngineArtifacts.layerStackSidecars".to_string());
            reasons.push("layer_authority_source_mismatch".to_string());
        }
    }
}

fn render_sources_match(left: &str, right: &str) -> bool {
    if left == right {
        return true;
    }
    crate::file_management::parse_virtual_path(left).0
        == crate::file_management::parse_virtual_path(right).0
}

fn quarantine_original_bytes(sidecar_path: &Path, bytes: &[u8]) -> Result<PathBuf, String> {
    let base = sidecar_path.with_extension("rrdata.quarantine");
    for index in (1..MAX_QUARANTINE_BACKUPS).rev() {
        let from = if index == 1 {
            base.clone()
        } else {
            sidecar_path.with_extension(format!("rrdata.quarantine.{index}"))
        };
        let to = sidecar_path.with_extension(format!("rrdata.quarantine.{}", index + 1));
        if from.exists() {
            let _ = fs::rename(from, to);
        }
    }
    write_bytes_atomic(&base, bytes)?;
    Ok(base)
}

fn write_bytes_atomic(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let parent = path.parent().unwrap_or_else(|| Path::new("."));
    let mut temp_file = tempfile::NamedTempFile::new_in(parent)
        .map_err(|error| format!("Failed to create quarantine temp file: {error}"))?;
    temp_file
        .write_all(bytes)
        .and_then(|_| temp_file.as_file_mut().sync_all())
        .map_err(|error| format!("Failed to persist quarantine bytes: {error}"))?;
    temp_file.persist(path).map(|_| ()).map_err(|error| {
        format!(
            "Failed to publish quarantine {}: {}",
            path.display(),
            error.error
        )
    })
}

fn heal_large_exif(meta: &mut ImageMetadata) -> bool {
    let mut healed = false;

    if let Some(ref mut exif_map) = meta.exif {
        for val in exif_map.values_mut() {
            if val.len() > 500 {
                *val = truncate_large_exif(val);
                healed = true;
            }
        }
    }

    healed
}

fn to_ur64(val: &exif::Rational) -> uR64 {
    uR64 {
        nominator: val.num,
        denominator: val.denom,
    }
}

fn to_ir64(val: &exif::SRational) -> iR64 {
    iR64 {
        nominator: val.num,
        denominator: val.denom,
    }
}

fn clean_creation_datetime_str(s: &str) -> &str {
    s.trim().trim_matches('"').trim_matches('\'').trim()
}

fn fmt_date_str(s: String) -> String {
    if let Some(dt) = parse_creation_datetime(&s) {
        return dt.format("%Y-%m-%d %H:%M:%S").to_string();
    }
    clean_creation_datetime_str(&s).to_string()
}

fn format_positive_ratio(num: u32, denom: u32) -> Option<String> {
    if denom == 0 {
        return None;
    }

    let parsed = num as f32 / denom as f32;
    (parsed > 0.0).then(|| parsed.to_string())
}

fn merge_numeric_exif_value(map: &mut HashMap<String, String>, key: &str, value: Option<String>) {
    if let Some(value) = value {
        map.entry(key.to_string()).or_insert(value);
    }
}

fn parse_positive_metadata_number(value: &str) -> Option<f32> {
    let cleaned = value
        .trim()
        .trim_matches('"')
        .trim_matches('\'')
        .replace(" mm", "")
        .replace(" s", "")
        .replace(" EV", "")
        .replace("f/", "");

    let parsed = cleaned.parse::<f32>().ok()?;
    (parsed > 0.0).then_some(parsed)
}

fn is_positive_camera_field_value(key: &str, value: &str) -> bool {
    match key {
        "FNumber" | "ApertureValue" => parse_positive_metadata_number(value).is_some(),
        "FocalLength" | "FocalLengthIn35mmFilm" => parse_positive_metadata_number(value).is_some(),
        _ => true,
    }
}

fn repair_raw_camera_metadata(
    mut metadata: HashMap<String, String>,
    extracted: &HashMap<String, String>,
) -> (HashMap<String, String>, bool) {
    let mut changed = false;

    for key in [
        "FNumber",
        "ApertureValue",
        "FocalLength",
        "FocalLengthIn35mmFilm",
    ] {
        let keep_existing = metadata
            .get(key)
            .is_some_and(|value| is_positive_camera_field_value(key, value));
        if keep_existing {
            continue;
        }

        if let Some(extracted_value) = extracted
            .get(key)
            .filter(|value| is_positive_camera_field_value(key, value))
        {
            metadata.insert(key.to_string(), extracted_value.clone());
            changed = true;
        } else if metadata.remove(key).is_some() {
            changed = true;
        }
    }

    (metadata, changed)
}

pub fn repair_raw_sidecar_camera_metadata(
    source_path: &Path,
    metadata: &mut ImageMetadata,
) -> bool {
    let Some(sidecar_exif) = metadata.exif.take() else {
        return false;
    };

    let Ok(file_bytes) = fs::read(source_path) else {
        metadata.exif = Some(sidecar_exif);
        return false;
    };

    let source_path_str = source_path.to_string_lossy();
    let extracted_exif = read_exif_data_from_bytes(source_path_str.as_ref(), &file_bytes);
    let (repaired_exif, changed) = repair_raw_camera_metadata(sidecar_exif, &extracted_exif);
    metadata.exif = Some(repaired_exif);
    changed
}

fn normalize_creation_datetime(s: &str) -> Option<String> {
    let normalized = s.replace('T', " ");
    let (date, time) = normalized.split_once(' ')?;
    Some(format!("{} {}", date.replace(':', "-"), time))
}

fn parse_creation_datetime(s: &str) -> Option<NaiveDateTime> {
    let clean = clean_creation_datetime_str(s);
    if clean.is_empty() {
        return None;
    }

    let normalized = normalize_creation_datetime(clean);
    for candidate in std::iter::once(clean).chain(normalized.as_deref()) {
        for format in [
            "%Y:%m:%d %H:%M:%S",
            "%Y:%m:%d %H:%M:%S%.f",
            "%Y-%m-%d %H:%M:%S",
            "%Y-%m-%d %H:%M:%S%.f",
        ] {
            if let Ok(dt) = NaiveDateTime::parse_from_str(candidate, format) {
                return Some(dt);
            }
        }
    }

    None
}

fn parse_creation_field(field: &exif::Field) -> Option<DateTime<Utc>> {
    parse_creation_datetime(&field.display_value().to_string())
        .map(|dt| DateTime::from_naive_utc_and_offset(dt, Utc))
}

fn parse_raw_creation_date(date_str: Option<&str>) -> Option<DateTime<Utc>> {
    parse_creation_datetime(date_str?).map(|dt| DateTime::from_naive_utc_and_offset(dt, Utc))
}

pub fn read_exif(file_bytes: &[u8]) -> Option<Exif> {
    let exifreader = exif::Reader::new();
    exifreader
        .read_from_container(&mut Cursor::new(file_bytes))
        .ok()
}

pub fn read_raw_metadata(file_bytes: &[u8]) -> Option<RawMetadata> {
    let loader = rawler::RawLoader::new();
    let raw_source = rawler::rawsource::RawSource::new_from_slice(file_bytes);
    let decoder = loader.get_decoder(&raw_source).ok()?;
    decoder.raw_metadata(&raw_source, &Default::default()).ok()
}

pub fn read_exposure_time_secs(path: &str, file_bytes: &[u8]) -> Option<f32> {
    if let Some(map) = read_rrexif_sidecar(Path::new(path))
        && let Some(val_str) = map.get("ExposureTime").or(map.get("ShutterSpeedValue"))
    {
        let cleaned = val_str.replace(" s", "");
        if cleaned.contains('/') {
            let parts: Vec<&str> = cleaned.split('/').collect();
            if parts.len() == 2
                && let (Ok(num), Ok(den)) = (parts[0].parse::<f32>(), parts[1].parse::<f32>())
                && den != 0.0
            {
                return Some(num / den);
            }
        } else if let Ok(val) = cleaned.parse::<f32>() {
            return Some(val);
        }
    }

    if is_raw_file(path)
        && let Some(meta) = read_raw_metadata(file_bytes)
    {
        if let Some(r) = meta.exif.exposure_time {
            return if r.d == 0 {
                None
            } else {
                Some(r.n as f32 / r.d as f32)
            };
        } else if let Some(r) = meta.exif.shutter_speed_value {
            return if r.d == 0 {
                None
            } else {
                Some(r.n as f32 / r.d as f32)
            };
        }
    }

    if let Some(exif) = read_exif(file_bytes) {
        if let Some(exposure) = exif.get_field(exif::Tag::ExposureTime, In::PRIMARY) {
            if let Value::Rational(ref r) = exposure.value {
                if r.is_empty() {
                    return None;
                }

                let val = r.first()?;

                return if val.denom == 0 {
                    None
                } else {
                    Some(val.num as f32 / val.denom as f32)
                };
            }
        } else if let Some(shutter_speed) =
            exif.get_field(exif::Tag::ShutterSpeedValue, In::PRIMARY)
            && let Value::Rational(ref r) = shutter_speed.value
        {
            if r.is_empty() {
                return None;
            }

            let val = r.first()?;

            return if val.denom == 0 {
                None
            } else {
                Some(val.num as f32 / val.denom as f32)
            };
        }
    }
    None
}

pub fn read_iso(path: &str, file_bytes: &[u8]) -> Option<u32> {
    if let Some(map) = read_rrexif_sidecar(Path::new(path))
        && let Some(val_str) = map
            .get("ISOSpeed")
            .or(map.get("PhotographicSensitivity"))
            .or(map.get("ISOSpeedRatings"))
        && let Ok(val) = val_str.parse::<u32>()
    {
        return Some(val);
    }

    if is_raw_file(path)
        && let Some(meta) = read_raw_metadata(file_bytes)
    {
        if let Some(r) = meta.exif.iso_speed {
            return Some(r);
        } else if let Some(r) = meta.exif.iso_speed_ratings {
            return Some(r as u32);
        }
    }

    if let Some(exif) = read_exif(file_bytes) {
        if let Some(r) = exif.get_field(exif::Tag::ISOSpeed, In::PRIMARY) {
            return r.value.get_uint(0);
        } else if let Some(r) = exif.get_field(exif::Tag::PhotographicSensitivity, In::PRIMARY) {
            return r.value.get_uint(0);
        }
    }
    None
}

pub fn extract_metadata(file_bytes: &[u8]) -> Option<HashMap<String, String>> {
    let mut map = HashMap::new();

    if let Some(exif_obj) = read_exif(file_bytes) {
        for field in exif_obj.fields() {
            match field.tag {
                exif::Tag::ExposureTime => {
                    if let exif::Value::Rational(ref v) = field.value
                        && !v.is_empty()
                    {
                        let r = &v[0];
                        if r.num == 1 && r.denom > 1 {
                            map.insert("ExposureTime".to_string(), format!("1/{} s", r.denom));
                        } else {
                            let val = r.num as f32 / r.denom as f32;
                            if val < 1.0 && val > 0.0 {
                                map.insert(
                                    "ExposureTime".to_string(),
                                    format!("1/{} s", (1.0 / val).round()),
                                );
                            } else {
                                map.insert("ExposureTime".to_string(), format!("{} s", val));
                            }
                        }
                    }
                }
                exif::Tag::ShutterSpeedValue => {
                    if let exif::Value::SRational(ref v) = field.value
                        && !v.is_empty()
                    {
                        let val = v[0].num as f32 / v[0].denom as f32;
                        map.insert("ShutterSpeedValue".to_string(), val.to_string());
                    }
                }
                exif::Tag::FNumber => {
                    if let exif::Value::Rational(ref v) = field.value
                        && !v.is_empty()
                    {
                        merge_numeric_exif_value(
                            &mut map,
                            "FNumber",
                            format_positive_ratio(v[0].num, v[0].denom)
                                .map(|val| format!("f/{}", val)),
                        );
                    }
                }
                exif::Tag::ApertureValue => {
                    if let exif::Value::Rational(ref v) = field.value
                        && !v.is_empty()
                    {
                        merge_numeric_exif_value(
                            &mut map,
                            "ApertureValue",
                            format_positive_ratio(v[0].num, v[0].denom)
                                .map(|val| format!("f/{}", val)),
                        );
                    }
                }
                exif::Tag::FocalLength => {
                    if let exif::Value::Rational(ref v) = field.value
                        && !v.is_empty()
                        && let Some(val) = format_positive_ratio(v[0].num, v[0].denom)
                    {
                        map.insert("FocalLength".to_string(), val.clone());
                        map.insert("FocalLengthIn35mmFilm".to_string(), val);
                    }
                }
                exif::Tag::PhotographicSensitivity | exif::Tag::ISOSpeed => {
                    map.insert(
                        "PhotographicSensitivity".to_string(),
                        field.display_value().to_string(),
                    );
                    map.insert("ISOSpeed".to_string(), field.display_value().to_string());
                }
                exif::Tag::DateTimeOriginal => {
                    map.insert(
                        "DateTimeOriginal".to_string(),
                        fmt_date_str(field.display_value().to_string()),
                    );
                }
                exif::Tag::DateTime => {
                    map.insert(
                        "CreateDate".to_string(),
                        fmt_date_str(field.display_value().to_string()),
                    );
                }
                exif::Tag::DateTimeDigitized => {
                    map.insert(
                        "ModifyDate".to_string(),
                        fmt_date_str(field.display_value().to_string()),
                    );
                }
                _ => {
                    let val = field.display_value().with_unit(&exif_obj).to_string();
                    if !val.trim().is_empty() {
                        map.insert(field.tag.to_string(), val);
                    }
                }
            }
        }
    }

    if !map.is_empty() {
        if let Some(metadata) = read_raw_metadata(file_bytes) {
            let exif = metadata.exif;
            let make = metadata.make;
            let model = metadata.model;

            if !make.trim().is_empty() {
                map.entry("Make".to_string()).or_insert(make);
            }
            if !model.trim().is_empty() {
                map.entry("Model".to_string()).or_insert(model);
            }
            if map
                .get("LensModel")
                .is_none_or(|v| v.trim().is_empty() || v.trim() == "----")
                && let Some(lens_desc) = &metadata.lens
            {
                map.insert("LensModel".to_string(), lens_desc.lens_model.clone());
                map.entry("LensMake".to_string())
                    .or_insert(lens_desc.lens_make.clone());
            }

            if !map.contains_key("FNumber")
                && let Some(r) = exif.fnumber.as_ref().or(exif.aperture_value.as_ref())
                && let Some(val) = format_positive_ratio(r.n, r.d)
            {
                map.insert("FNumber".to_string(), format!("f/{}", val));
            }
            if !map.contains_key("ApertureValue")
                && let Some(r) = exif
                    .aperture_value
                    .as_ref()
                    .or(exif.max_aperture_value.as_ref())
                && let Some(val) = format_positive_ratio(r.n, r.d)
            {
                map.insert("ApertureValue".to_string(), format!("f/{}", val));
            }
            if !map.contains_key("FocalLength")
                && let Some(r) = exif.focal_length.as_ref()
                && let Some(val) = format_positive_ratio(r.n, r.d)
            {
                map.insert("FocalLength".to_string(), val.clone());
                map.insert("FocalLengthIn35mmFilm".to_string(), val);
            }
        }

        return Some(map);
    }

    let metadata = read_raw_metadata(file_bytes)?;

    let exif = metadata.exif;

    let fmt_rat = |r: &rawler::formats::tiff::Rational| -> f32 {
        if r.d == 0 {
            0.0
        } else {
            r.n as f32 / r.d as f32
        }
    };

    let fmt_srat = |r: &rawler::formats::tiff::SRational| -> f32 {
        if r.d == 0 {
            0.0
        } else {
            r.n as f32 / r.d as f32
        }
    };

    let mut insert_if_present = |key: &str, val: String| {
        let trimmed = val.trim();
        if !trimmed.is_empty() {
            map.insert(key.to_string(), truncate_large_exif(trimmed));
        }
    };

    insert_if_present("Make", metadata.make);
    insert_if_present("Model", metadata.model);

    if let Some(v) = exif.artist {
        insert_if_present("Artist", v);
    }
    if let Some(v) = exif.copyright {
        insert_if_present("Copyright", v);
    }
    if let Some(v) = exif.owner_name {
        insert_if_present("OwnerName", v);
    }
    if let Some(v) = exif.serial_number {
        insert_if_present("SerialNumber", v);
    }
    if let Some(v) = exif.image_number {
        insert_if_present("ImageNumber", v.to_string());
    }
    if let Some(v) = exif.user_comment {
        insert_if_present("UserComment", v);
    }

    if let Some(v) = exif.date_time_original {
        insert_if_present("DateTimeOriginal", fmt_date_str(v));
    }
    if let Some(v) = exif.create_date {
        insert_if_present("CreateDate", fmt_date_str(v));
    }
    if let Some(v) = exif.modify_date {
        insert_if_present("ModifyDate", fmt_date_str(v));
    }

    if let Some(v) = exif.offset_time {
        insert_if_present("OffsetTime", v);
    }
    if let Some(v) = exif.offset_time_original {
        insert_if_present("OffsetTimeOriginal", v);
    }
    if let Some(v) = exif.offset_time_digitized {
        insert_if_present("OffsetTimeDigitized", v);
    }
    if let Some(v) = exif.sub_sec_time {
        insert_if_present("SubSecTime", v);
    }
    if let Some(v) = exif.sub_sec_time_original {
        insert_if_present("SubSecTimeOriginal", v);
    }
    if let Some(v) = exif.sub_sec_time_digitized {
        insert_if_present("SubSecTimeDigitized", v);
    }

    if let Some(v) = exif.lens_model {
        insert_if_present("LensModel", v);
    } else if let Some(lens_desc) = &metadata.lens {
        insert_if_present("LensModel", lens_desc.lens_model.clone());
    }

    if let Some(v) = exif.lens_make {
        insert_if_present("LensMake", v);
    } else if let Some(lens_desc) = &metadata.lens {
        insert_if_present("LensMake", lens_desc.lens_make.clone());
    }

    if let Some(v) = exif.lens_serial_number {
        insert_if_present("LensSerialNumber", v);
    }

    if let Some(v) = exif.orientation {
        insert_if_present("Orientation", v.to_string());
    }

    if let Some(r) = exif.fnumber
        && let Some(val) = format_positive_ratio(r.n, r.d)
    {
        insert_if_present("FNumber", format!("f/{}", val));
    }

    if let Some(r) = exif.aperture_value
        && let Some(val) = format_positive_ratio(r.n, r.d)
    {
        insert_if_present("ApertureValue", format!("f/{}", val));
    }

    if let Some(r) = exif.max_aperture_value
        && let Some(val) = format_positive_ratio(r.n, r.d)
    {
        insert_if_present("MaxApertureValue", val);
    }

    if let Some(r) = exif.exposure_time {
        if r.n == 1 && r.d > 1 {
            insert_if_present("ExposureTime", format!("1/{} s", r.d));
        } else {
            let val = fmt_rat(&r);
            if val < 1.0 && val > 0.0 {
                insert_if_present("ExposureTime", format!("1/{} s", (1.0 / val).round()));
            } else {
                insert_if_present("ExposureTime", format!("{} s", val));
            }
        }
    }

    if let Some(r) = exif.shutter_speed_value {
        insert_if_present("ShutterSpeedValue", fmt_srat(&r).to_string());
    }

    if let Some(v) = exif.iso_speed {
        insert_if_present("PhotographicSensitivity", v.to_string());
        insert_if_present("ISOSpeed", v.to_string());
    } else if let Some(v) = exif.iso_speed_ratings {
        insert_if_present("PhotographicSensitivity", v.to_string());
        insert_if_present("ISOSpeedRatings", v.to_string());
    }

    if let Some(v) = exif.recommended_exposure_index {
        insert_if_present("RecommendedExposureIndex", v.to_string());
    }
    if let Some(v) = exif.sensitivity_type {
        insert_if_present("SensitivityType", v.to_string());
    }

    if let Some(r) = exif.focal_length
        && let Some(val) = format_positive_ratio(r.n, r.d)
    {
        insert_if_present("FocalLength", val.clone());
        insert_if_present("FocalLengthIn35mmFilm", val);
    }

    if let Some(r) = exif.exposure_bias {
        insert_if_present("ExposureBiasValue", fmt_srat(&r).to_string());
    }

    if let Some(v) = exif.metering_mode {
        insert_if_present("MeteringMode", v.to_string());
    }
    if let Some(v) = exif.light_source {
        insert_if_present("LightSource", v.to_string());
    }
    if let Some(v) = exif.flash {
        insert_if_present("Flash", v.to_string());
    }
    if let Some(v) = exif.white_balance {
        insert_if_present("WhiteBalance", v.to_string());
    }
    if let Some(v) = exif.exposure_program {
        insert_if_present("ExposureProgram", v.to_string());
    }
    if let Some(v) = exif.exposure_mode {
        insert_if_present("ExposureMode", v.to_string());
    }
    if let Some(v) = exif.scene_capture_type {
        insert_if_present("SceneCaptureType", v.to_string());
    }
    if let Some(v) = exif.color_space {
        insert_if_present("ColorSpace", v.to_string());
    }
    if let Some(r) = exif.flash_energy {
        insert_if_present("FlashEnergy", fmt_rat(&r).to_string());
    }
    if let Some(r) = exif.brightness_value {
        insert_if_present("BrightnessValue", fmt_srat(&r).to_string());
    }

    if let Some(r) = exif.subject_distance {
        insert_if_present("SubjectDistance", fmt_rat(&r).to_string());
    }
    if let Some(v) = exif.subject_distance_range {
        insert_if_present("SubjectDistanceRange", v.to_string());
    }

    if let Some(gps) = exif.gps {
        let fmt_gps_coord = |coords: &[rawler::formats::tiff::Rational; 3]| -> String {
            format!(
                "{} deg {} min {} sec",
                fmt_rat(&coords[0]),
                fmt_rat(&coords[1]),
                fmt_rat(&coords[2])
            )
        };

        if let Some(lat) = gps.gps_latitude {
            insert_if_present("GPSLatitude", fmt_gps_coord(&lat));
        }
        if let Some(lat_ref) = gps.gps_latitude_ref {
            insert_if_present("GPSLatitudeRef", lat_ref);
        }
        if let Some(lon) = gps.gps_longitude {
            insert_if_present("GPSLongitude", fmt_gps_coord(&lon));
        }
        if let Some(lon_ref) = gps.gps_longitude_ref {
            insert_if_present("GPSLongitudeRef", lon_ref);
        }
        if let Some(alt) = gps.gps_altitude {
            insert_if_present("GPSAltitude", fmt_rat(&alt).to_string());
        }
        if let Some(alt_ref) = gps.gps_altitude_ref {
            insert_if_present("GPSAltitudeRef", alt_ref.to_string());
        }
        if let Some(v) = gps.gps_img_direction {
            insert_if_present("GPSImgDirection", fmt_rat(&v).to_string());
        }
        if let Some(v) = gps.gps_img_direction_ref {
            insert_if_present("GPSImgDirectionRef", v);
        }
        if let Some(v) = gps.gps_speed {
            insert_if_present("GPSSpeed", fmt_rat(&v).to_string());
        }
        if let Some(v) = gps.gps_speed_ref {
            insert_if_present("GPSSpeedRef", v);
        }
        if let Some(v) = gps.gps_status {
            insert_if_present("GPSStatus", v);
        }
        if let Some(v) = gps.gps_measure_mode {
            insert_if_present("GPSMeasureMode", v);
        }
        if let Some(v) = gps.gps_dop {
            insert_if_present("GPSDOP", fmt_rat(&v).to_string());
        }
        if let Some(v) = gps.gps_map_datum {
            insert_if_present("GPSMapDatum", v);
        }
    }

    Some(map)
}

pub fn get_creation_date_from_path(path: &Path) -> DateTime<Utc> {
    if let Some(map) = read_rrexif_sidecar(path)
        && let Some(dt_str) = map.get("DateTimeOriginal").or(map.get("CreateDate"))
        && let Some(dt) = parse_creation_datetime(dt_str)
    {
        return DateTime::from_naive_utc_and_offset(dt, Utc);
    }

    if let Ok(file) = std::fs::File::open(path) {
        let mut bufreader = BufReader::new(&file);
        let exifreader = exif::Reader::new();

        if let Ok(exif_obj) = exifreader.read_from_container(&mut bufreader) {
            for tag in [exif::Tag::DateTimeOriginal, exif::Tag::DateTime] {
                if let Some(field) = exif_obj.get_field(tag, exif::In::PRIMARY)
                    && let Some(dt) = parse_creation_field(field)
                {
                    return dt;
                }
            }
        }
    }

    if is_raw_file(path.to_string_lossy().as_ref()) {
        let loader = rawler::RawLoader::new();
        if let Ok(raw_source) = rawler::rawsource::RawSource::new(path)
            && let Ok(decoder) = loader.get_decoder(&raw_source)
            && let Ok(metadata) = decoder.raw_metadata(&raw_source, &Default::default())
        {
            if let Some(dt) = parse_raw_creation_date(metadata.exif.date_time_original.as_deref()) {
                return dt;
            }
            if let Some(dt) = parse_raw_creation_date(metadata.exif.create_date.as_deref()) {
                return dt;
            }
        }
    }

    fs::metadata(path)
        .ok()
        .and_then(|m| m.created().ok())
        .map(DateTime::<Utc>::from)
        .unwrap_or_else(Utc::now)
}

#[cfg(target_os = "android")]
pub fn get_creation_date_from_bytes(path_hint: &str, file_bytes: &[u8]) -> DateTime<Utc> {
    if let Some(exif_obj) = read_exif(file_bytes) {
        for tag in [exif::Tag::DateTimeOriginal, exif::Tag::DateTime] {
            if let Some(field) = exif_obj.get_field(tag, exif::In::PRIMARY)
                && let Some(dt) = parse_creation_field(field)
            {
                return dt;
            }
        }
    }

    if is_raw_file(path_hint)
        && let Some(metadata) = read_raw_metadata(file_bytes)
    {
        if let Some(dt) = parse_raw_creation_date(metadata.exif.date_time_original.as_deref()) {
            return dt;
        }
        if let Some(dt) = parse_raw_creation_date(metadata.exif.create_date.as_deref()) {
            return dt;
        }
    }

    Utc::now()
}

pub fn write_image_with_metadata(
    image_bytes: &mut Vec<u8>,
    original_path_str: &str,
    output_format: &str,
    keep_metadata: bool,
    strip_gps: bool,
) -> Result<(), String> {
    // FIXME: temporary solution until I find a way to write metadata to TIFF
    if !keep_metadata || output_format.to_lowercase() == "tiff" {
        return Ok(());
    }

    let original_path = Path::new(original_path_str);
    if !original_path.exists() {
        return Ok(());
    }

    // Skip TIFF sources to avoid potential tag corruption issues
    let original_ext = original_path
        .extension()
        .and_then(|s| s.to_str())
        .unwrap_or("")
        .to_lowercase();
    if original_ext == "tiff" || original_ext == "tif" {
        return Ok(());
    }

    let file_type = match output_format.to_lowercase().as_str() {
        "jpg" | "jpeg" => FileExtension::JPEG,
        "png" => FileExtension::PNG {
            as_zTXt_chunk: true,
        },
        "tiff" => FileExtension::TIFF,
        _ => return Ok(()),
    };

    let mut metadata = Metadata::new();
    let mut source_read_success = false;

    if let Some(map) = read_rrexif_sidecar(original_path) {
        source_read_success = true;

        let clean_s = |s: &String| s.replace('"', "").trim().to_string();

        let parse_ur64 = |s: &str| -> Option<uR64> {
            let cleaned_string = s
                .replace("f/", "")
                .replace(" s", "")
                .replace(" mm", "")
                .replace("\"", "");

            let val = cleaned_string.trim();

            if val.contains('/') {
                let parts: Vec<&str> = val.split('/').collect();
                if parts.len() == 2
                    && let (Ok(n), Ok(d)) = (parts[0].parse::<u32>(), parts[1].parse::<u32>())
                {
                    return Some(uR64 {
                        nominator: n,
                        denominator: d,
                    });
                }
            } else if let Ok(f) = val.parse::<f32>() {
                return Some(uR64 {
                    nominator: (f * 1000.0) as u32,
                    denominator: 1000,
                });
            }
            None
        };
        if let Some(val) = map.get("Make") {
            metadata.set_tag(ExifTag::Make(clean_s(val)));
        }
        if let Some(val) = map.get("Model") {
            metadata.set_tag(ExifTag::Model(clean_s(val)));
        }
        if let Some(val) = map.get("LensMake") {
            metadata.set_tag(ExifTag::LensMake(clean_s(val)));
        }
        if let Some(val) = map.get("LensModel") {
            metadata.set_tag(ExifTag::LensModel(clean_s(val)));
        }
        if let Some(val) = map.get("Artist") {
            metadata.set_tag(ExifTag::Artist(clean_s(val)));
        }
        if let Some(val) = map.get("Copyright") {
            metadata.set_tag(ExifTag::Copyright(clean_s(val)));
        }
        if let Some(val) = map.get("UserComment") {
            metadata.set_tag(ExifTag::UserComment(clean_s(val).into_bytes()));
        }
        if let Some(val) = map.get("ImageDescription") {
            metadata.set_tag(ExifTag::ImageDescription(clean_s(val)));
        }
        if let Some(val) = map.get("DateTimeOriginal") {
            metadata.set_tag(ExifTag::DateTimeOriginal(clean_s(val)));
        }
        if let Some(val) = map.get("CreateDate") {
            metadata.set_tag(ExifTag::CreateDate(clean_s(val)));
        }
        if let Some(val) = map.get("FNumber")
            && let Some(ur) = parse_ur64(val)
        {
            metadata.set_tag(ExifTag::FNumber(vec![ur]));
        }
        if let Some(val) = map.get("ExposureTime")
            && let Some(ur) = parse_ur64(val)
        {
            metadata.set_tag(ExifTag::ExposureTime(vec![ur]));
        }
        if let Some(val) = map.get("FocalLength")
            && let Some(ur) = parse_ur64(val)
        {
            metadata.set_tag(ExifTag::FocalLength(vec![ur]));
        }
        if let Some(val) = map.get("FocalLengthIn35mmFilm") {
            let cleaned = val.replace(" mm", "").replace("\"", "");
            let trimmed = cleaned.trim();
            if let Ok(f_val) = trimmed.parse::<f32>() {
                metadata.set_tag(ExifTag::FocalLengthIn35mmFormat(vec![f_val.round() as u16]));
            }
        }
        if let Some(val) = map.get("ISOSpeed").or(map.get("PhotographicSensitivity"))
            && let Ok(iso) = val.replace('"', "").trim().parse::<u16>()
        {
            metadata.set_tag(ExifTag::ISO(vec![iso]));
        }
    }

    if !source_read_success && let Ok(file) = std::fs::File::open(original_path) {
        let mut bufreader = std::io::BufReader::new(&file);
        let exifreader = exif::Reader::new();

        if let Ok(exif_obj) = exifreader.read_from_container(&mut bufreader) {
            source_read_success = true;

            let get_string_val = |field: &exif::Field| -> String {
                match &field.value {
                    exif::Value::Ascii(vec) => vec
                        .iter()
                        .map(|v| {
                            String::from_utf8_lossy(v)
                                .trim_matches(char::from(0))
                                .to_string()
                        })
                        .collect::<Vec<String>>()
                        .join(" "),
                    _ => field
                        .display_value()
                        .to_string()
                        .replace("\"", "")
                        .trim()
                        .to_string(),
                }
            };

            if let Some(f) = exif_obj.get_field(exif::Tag::Make, exif::In::PRIMARY) {
                metadata.set_tag(ExifTag::Make(get_string_val(f)));
            }
            if let Some(f) = exif_obj.get_field(exif::Tag::Model, exif::In::PRIMARY) {
                metadata.set_tag(ExifTag::Model(get_string_val(f)));
            }
            if let Some(f) = exif_obj.get_field(exif::Tag::LensMake, exif::In::PRIMARY) {
                metadata.set_tag(ExifTag::LensMake(get_string_val(f)));
            }
            if let Some(f) = exif_obj.get_field(exif::Tag::LensModel, exif::In::PRIMARY) {
                metadata.set_tag(ExifTag::LensModel(get_string_val(f)));
            }
            if let Some(f) = exif_obj.get_field(exif::Tag::Artist, exif::In::PRIMARY) {
                metadata.set_tag(ExifTag::Artist(get_string_val(f)));
            }
            if let Some(f) = exif_obj.get_field(exif::Tag::Copyright, exif::In::PRIMARY) {
                metadata.set_tag(ExifTag::Copyright(get_string_val(f)));
            }
            if let Some(f) = exif_obj.get_field(exif::Tag::DateTimeOriginal, exif::In::PRIMARY) {
                metadata.set_tag(ExifTag::DateTimeOriginal(get_string_val(f)));
            }
            if let Some(f) = exif_obj.get_field(exif::Tag::DateTime, exif::In::PRIMARY) {
                metadata.set_tag(ExifTag::CreateDate(get_string_val(f)));
            }
            if let Some(f) = exif_obj.get_field(exif::Tag::FNumber, exif::In::PRIMARY)
                && let exif::Value::Rational(v) = &f.value
                && !v.is_empty()
            {
                metadata.set_tag(ExifTag::FNumber(vec![to_ur64(&v[0])]));
            }
            if let Some(f) = exif_obj.get_field(exif::Tag::ExposureTime, exif::In::PRIMARY)
                && let exif::Value::Rational(v) = &f.value
                && !v.is_empty()
            {
                metadata.set_tag(ExifTag::ExposureTime(vec![to_ur64(&v[0])]));
            }
            if let Some(f) = exif_obj.get_field(exif::Tag::FocalLength, exif::In::PRIMARY)
                && let exif::Value::Rational(v) = &f.value
                && !v.is_empty()
            {
                metadata.set_tag(ExifTag::FocalLength(vec![to_ur64(&v[0])]));
            }
            if let Some(f) = exif_obj.get_field(exif::Tag::ExposureBiasValue, exif::In::PRIMARY) {
                match &f.value {
                    exif::Value::SRational(v) if !v.is_empty() => {
                        metadata.set_tag(ExifTag::ExposureCompensation(vec![to_ir64(&v[0])]));
                    }
                    exif::Value::Rational(v) if !v.is_empty() => {
                        metadata.set_tag(ExifTag::ExposureCompensation(vec![iR64 {
                            nominator: v[0].num as i32,
                            denominator: v[0].denom as i32,
                        }]));
                    }
                    _ => {}
                }
            }
            if let Some(f) =
                exif_obj.get_field(exif::Tag::PhotographicSensitivity, exif::In::PRIMARY)
            {
                if let Some(val) = f.value.get_uint(0) {
                    metadata.set_tag(ExifTag::ISO(vec![val as u16]));
                }
            } else if let Some(f) = exif_obj.get_field(exif::Tag::ISOSpeed, exif::In::PRIMARY)
                && let Some(val) = f.value.get_uint(0)
            {
                metadata.set_tag(ExifTag::ISO(vec![val as u16]));
            }
            if let Some(f) = exif_obj.get_field(exif::Tag::FocalLengthIn35mmFilm, exif::In::PRIMARY)
                && let Some(val) = f.value.get_uint(0)
            {
                metadata.set_tag(ExifTag::FocalLengthIn35mmFormat(vec![val as u16]));
            }
            if !strip_gps {
                if let Some(f) = exif_obj.get_field(exif::Tag::GPSLatitude, exif::In::PRIMARY)
                    && let exif::Value::Rational(v) = &f.value
                    && v.len() >= 3
                {
                    metadata.set_tag(ExifTag::GPSLatitude(vec![
                        to_ur64(&v[0]),
                        to_ur64(&v[1]),
                        to_ur64(&v[2]),
                    ]));
                }
                if let Some(f) = exif_obj.get_field(exif::Tag::GPSLatitudeRef, exif::In::PRIMARY) {
                    metadata.set_tag(ExifTag::GPSLatitudeRef(get_string_val(f)));
                }
                if let Some(f) = exif_obj.get_field(exif::Tag::GPSLongitude, exif::In::PRIMARY)
                    && let exif::Value::Rational(v) = &f.value
                    && v.len() >= 3
                {
                    metadata.set_tag(ExifTag::GPSLongitude(vec![
                        to_ur64(&v[0]),
                        to_ur64(&v[1]),
                        to_ur64(&v[2]),
                    ]));
                }
                if let Some(f) = exif_obj.get_field(exif::Tag::GPSLongitudeRef, exif::In::PRIMARY) {
                    metadata.set_tag(ExifTag::GPSLongitudeRef(get_string_val(f)));
                }
                if let Some(f) = exif_obj.get_field(exif::Tag::GPSAltitude, exif::In::PRIMARY)
                    && let exif::Value::Rational(v) = &f.value
                    && !v.is_empty()
                {
                    metadata.set_tag(ExifTag::GPSAltitude(vec![to_ur64(&v[0])]));
                }
                if let Some(f) = exif_obj.get_field(exif::Tag::GPSAltitudeRef, exif::In::PRIMARY) {
                    let alt_ref = f.value.get_uint(0).unwrap_or(0) as u8;
                    metadata.set_tag(ExifTag::GPSAltitudeRef(vec![alt_ref]));
                }
            }
        }
    }

    if !source_read_success && is_raw_file(original_path_str) {
        let loader = rawler::RawLoader::new();
        if let Ok(raw_source) = rawler::rawsource::RawSource::new(Path::new(original_path_str))
            && let Ok(decoder) = loader.get_decoder(&raw_source)
            && let Ok(meta) = decoder.raw_metadata(&raw_source, &Default::default())
        {
            if !meta.make.is_empty() {
                metadata.set_tag(ExifTag::Make(meta.make.clone()));
            }
            if !meta.model.is_empty() {
                metadata.set_tag(ExifTag::Model(meta.model.clone()));
            }
            let exif = meta.exif;
            if let Some(artist) = exif.artist {
                metadata.set_tag(ExifTag::Artist(artist));
            }
            if let Some(copyright) = exif.copyright {
                metadata.set_tag(ExifTag::Copyright(copyright));
            }
            if let Some(dt) = exif.date_time_original {
                metadata.set_tag(ExifTag::DateTimeOriginal(dt));
            }
            if let Some(dt) = exif.create_date {
                metadata.set_tag(ExifTag::CreateDate(dt));
            }
            if let Some(lens_make) = exif.lens_make {
                metadata.set_tag(ExifTag::LensMake(lens_make));
            }
            if let Some(lens_model) = exif.lens_model {
                metadata.set_tag(ExifTag::LensModel(lens_model));
            }
            if let Some(f) = exif.fnumber {
                metadata.set_tag(ExifTag::FNumber(vec![uR64 {
                    nominator: f.n,
                    denominator: f.d,
                }]));
            }
            if let Some(t) = exif.exposure_time {
                metadata.set_tag(ExifTag::ExposureTime(vec![uR64 {
                    nominator: t.n,
                    denominator: t.d,
                }]));
            }
            if let Some(fl) = exif.focal_length {
                metadata.set_tag(ExifTag::FocalLength(vec![uR64 {
                    nominator: fl.n,
                    denominator: fl.d,
                }]));
            }
            if let Some(iso) = exif.iso_speed {
                metadata.set_tag(ExifTag::ISO(vec![iso as u16]));
            } else if let Some(iso) = exif.iso_speed_ratings {
                metadata.set_tag(ExifTag::ISO(vec![iso]));
            }
            if let Some(ev) = exif.exposure_bias {
                metadata.set_tag(ExifTag::ExposureCompensation(vec![iR64 {
                    nominator: ev.n,
                    denominator: ev.d,
                }]));
            }
            if let Some(flash) = exif.flash {
                metadata.set_tag(ExifTag::Flash(vec![flash]));
            }
            if let Some(metering) = exif.metering_mode {
                metadata.set_tag(ExifTag::MeteringMode(vec![metering]));
            }
            if let Some(wb) = exif.white_balance {
                metadata.set_tag(ExifTag::WhiteBalance(vec![wb]));
            }
            if let Some(prog) = exif.exposure_program {
                metadata.set_tag(ExifTag::ExposureProgram(vec![prog]));
            }
            if !strip_gps && let Some(gps) = exif.gps {
                if let Some(lat) = gps.gps_latitude {
                    metadata.set_tag(ExifTag::GPSLatitude(vec![
                        uR64 {
                            nominator: lat[0].n,
                            denominator: lat[0].d,
                        },
                        uR64 {
                            nominator: lat[1].n,
                            denominator: lat[1].d,
                        },
                        uR64 {
                            nominator: lat[2].n,
                            denominator: lat[2].d,
                        },
                    ]));
                }
                if let Some(lat_ref) = gps.gps_latitude_ref {
                    metadata.set_tag(ExifTag::GPSLatitudeRef(lat_ref));
                }
                if let Some(lon) = gps.gps_longitude {
                    metadata.set_tag(ExifTag::GPSLongitude(vec![
                        uR64 {
                            nominator: lon[0].n,
                            denominator: lon[0].d,
                        },
                        uR64 {
                            nominator: lon[1].n,
                            denominator: lon[1].d,
                        },
                        uR64 {
                            nominator: lon[2].n,
                            denominator: lon[2].d,
                        },
                    ]));
                }
                if let Some(lon_ref) = gps.gps_longitude_ref {
                    metadata.set_tag(ExifTag::GPSLongitudeRef(lon_ref));
                }
                if let Some(alt) = gps.gps_altitude {
                    metadata.set_tag(ExifTag::GPSAltitude(vec![uR64 {
                        nominator: alt.n,
                        denominator: alt.d,
                    }]));
                }
                if let Some(alt_ref) = gps.gps_altitude_ref {
                    metadata.set_tag(ExifTag::GPSAltitudeRef(vec![alt_ref]));
                }
            }
        }
    }

    metadata.set_tag(ExifTag::Software("RapidRAW".to_string()));
    metadata.set_tag(ExifTag::Orientation(vec![1u16]));
    metadata.set_tag(ExifTag::ColorSpace(vec![1u16]));

    if let Err(e) = metadata.write_to_vec(image_bytes, file_type) {
        log::warn!("Failed to write metadata: {}", e);
    }

    Ok(())
}

pub fn get_primary_sidecar_path(image_path: &Path) -> PathBuf {
    let mut filename = image_path.file_name().unwrap_or_default().to_os_string();
    filename.push(".rrdata");
    image_path.with_file_name(filename)
}

pub fn get_rrexif_path(image_path: &Path) -> PathBuf {
    let mut filename = image_path.file_name().unwrap_or_default().to_os_string();
    filename.push(".rrexif");
    image_path.with_file_name(filename)
}

fn load_primary_metadata(image_path: &Path) -> ImageMetadata {
    let primary = get_primary_sidecar_path(image_path);
    load_sidecar(&primary)
}

fn save_primary_metadata(image_path: &Path, metadata: &ImageMetadata) -> std::io::Result<()> {
    let primary = get_primary_sidecar_path(image_path);
    save_sidecar_metadata_atomic(&primary, metadata).map_err(std::io::Error::other)
}

pub fn save_sidecar_metadata_atomic(
    sidecar_path: &Path,
    metadata: &ImageMetadata,
) -> Result<(), String> {
    let mut normalized = metadata.clone();
    let mut extensions = normalized
        .persisted_render_state
        .as_mut()
        .map(|state| std::mem::take(&mut state.quarantined_extensions))
        .unwrap_or_default();
    let mut disabled = Vec::new();
    let mut reasons = Vec::new();
    let mut migrated = Vec::new();
    let dimensions = source_dimensions_for_sidecar(sidecar_path)
        .map(|dimensions| orient_dimensions_for_adjustments(dimensions, &normalized.adjustments));
    validate_adjustments(
        &mut normalized.adjustments,
        &mut extensions,
        &mut disabled,
        &mut migrated,
        &mut reasons,
        dimensions,
    );
    validate_artifacts(&mut normalized, None, &mut disabled, &mut reasons);
    if !disabled.is_empty() {
        return Err(format!(
            "Refusing to persist invalid render state in {}: {}",
            sidecar_path.display(),
            disabled.join(", ")
        ));
    }
    normalized.version = PERSISTED_RENDER_STATE_SCHEMA_VERSION;
    let revision = render_state_revision(
        &normalized.adjustments,
        normalized.raw_engine_artifacts.as_ref(),
    )?;
    let state = normalized
        .persisted_render_state
        .get_or_insert_with(|| PersistedRenderState {
            schema_version: PERSISTED_RENDER_STATE_SCHEMA_VERSION,
            implementation_revision: PERSISTED_STATE_IMPLEMENTATION_REVISION,
            source_identity: String::new(),
            edit_revision: revision.clone(),
            user_edits: normalized.adjustments.as_object().cloned(),
            defaults_policy_revision: 1,
            camera_input_transform_receipt: None,
            xmp_revision: None,
            recovery_receipts: Vec::new(),
            quarantined_extensions: Map::new(),
        });
    state.schema_version = PERSISTED_RENDER_STATE_SCHEMA_VERSION;
    state.implementation_revision = PERSISTED_STATE_IMPLEMENTATION_REVISION;
    state.edit_revision = revision;
    state.user_edits = normalized.adjustments.as_object().cloned();
    state.defaults_policy_revision = 1;
    state.quarantined_extensions = extensions;

    let json = serde_json::to_string_pretty(&normalized).map_err(|e| {
        format!(
            "Failed to serialize sidecar {}: {}",
            sidecar_path.display(),
            e
        )
    })?;
    write_text_file_atomic(sidecar_path, &json)
        .map_err(|e| format!("Failed to write sidecar {}: {}", sidecar_path.display(), e))
}

pub fn write_text_file_atomic(path: &Path, content: &str) -> Result<(), String> {
    write_text_atomic(path, content)
        .map_err(|e| format!("Failed to write {}: {}", path.display(), e))
}

fn write_text_atomic(path: &Path, content: &str) -> std::io::Result<()> {
    let parent = path.parent().unwrap_or_else(|| Path::new("."));
    let mut temp_file = tempfile::NamedTempFile::new_in(parent)?;
    temp_file.write_all(content.as_bytes())?;
    temp_file.as_file_mut().sync_all()?;
    temp_file
        .persist(path)
        .map(|_| ())
        .map_err(|persist_error| persist_error.error)
}

pub fn read_rrexif_sidecar(image_path: &Path) -> Option<HashMap<String, String>> {
    let metadata = load_primary_metadata(image_path);
    if let Some(exif) = metadata.exif {
        return Some(exif);
    }

    let legacy = get_rrexif_path(image_path);
    if legacy.exists()
        && let Ok(content) = fs::read_to_string(&legacy)
        && let Ok(map) = serde_json::from_str::<HashMap<String, String>>(&content)
    {
        let mut migrated = load_primary_metadata(image_path);
        migrated.exif = Some(map.clone());
        if save_primary_metadata(image_path, &migrated).is_ok() {
            let _ = fs::remove_file(&legacy);
        }
        return Some(map);
    }

    None
}

pub fn read_exif_data_from_bytes(path: &str, file_bytes: &[u8]) -> HashMap<String, String> {
    if is_raw_file(path)
        && let Some(map) = extract_metadata(file_bytes)
    {
        return map;
    }

    let mut exif_data = HashMap::new();
    if let Some(exif) = read_exif(file_bytes) {
        for field in exif.fields() {
            let raw_val = field.display_value().with_unit(&exif).to_string();
            exif_data.insert(field.tag.to_string(), truncate_large_exif(&raw_val));
        }
    }
    exif_data
}

pub fn read_exif_data(path: &str, file_bytes: &[u8]) -> HashMap<String, String> {
    let source_path = Path::new(path);
    if let Some(sidecar_exif) = read_rrexif_sidecar(source_path) {
        if is_raw_file(path) {
            let extracted_exif = read_exif_data_from_bytes(path, file_bytes);
            let (repaired_exif, changed) =
                repair_raw_camera_metadata(sidecar_exif, &extracted_exif);
            if changed {
                let mut metadata = load_primary_metadata(source_path);
                metadata.exif = Some(repaired_exif.clone());
                let _ = save_primary_metadata(source_path, &metadata);
            }
            return repaired_exif;
        } else {
            return sidecar_exif;
        }
    }

    let exif_map = read_exif_data_from_bytes(path, file_bytes);
    if !exif_map.is_empty() {
        let mut metadata = load_primary_metadata(source_path);
        metadata.exif = Some(exif_map.clone());
        let _ = save_primary_metadata(source_path, &metadata);
    }
    exif_map
}

pub fn persist_exif_if_missing(source_path: &Path, source_path_str: &str, file_bytes: &[u8]) {
    {
        let metadata = load_primary_metadata(source_path);
        if metadata.exif.is_some() {
            return;
        }
    }

    let legacy = get_rrexif_path(source_path);
    if legacy.exists()
        && let Ok(content) = fs::read_to_string(&legacy)
        && let Ok(map) = serde_json::from_str::<HashMap<String, String>>(&content)
    {
        let mut metadata = load_primary_metadata(source_path);
        metadata.exif = Some(map);
        if save_primary_metadata(source_path, &metadata).is_ok() {
            let _ = fs::remove_file(&legacy);
        }
        return;
    }

    let exif_map = read_exif_data_from_bytes(source_path_str, file_bytes);
    if exif_map.is_empty() {
        return;
    }

    let mut metadata = load_primary_metadata(source_path);

    if metadata.exif.is_none() {
        metadata.exif = Some(exif_map);
        let _ = save_primary_metadata(source_path, &metadata);
    }
}

pub fn write_rrexif_sidecar(source_path_str: &str, target_image_path: &Path) -> Result<(), String> {
    let source_path = Path::new(source_path_str);

    let exif_data = if let Some(existing) = read_rrexif_sidecar(source_path) {
        existing
    } else if let Ok(bytes) = fs::read(source_path) {
        read_exif_data_from_bytes(source_path_str, &bytes)
    } else {
        return Ok(());
    };

    if exif_data.is_empty() {
        return Ok(());
    }

    let mut metadata = load_primary_metadata(target_image_path);
    metadata.exif = Some(exif_data);
    save_primary_metadata(target_image_path, &metadata)
        .map_err(|e| format!("Failed to write sidecar: {}", e))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn write_sidecar(path: &Path, value: &JsonValue) -> Vec<u8> {
        let bytes = serde_json::to_vec_pretty(value).expect("fixture json");
        fs::write(path, &bytes).expect("write fixture");
        bytes
    }

    #[test]
    fn legacy_recovery_is_byte_preserving_and_idempotent() {
        let temp_dir = tempfile::tempdir().expect("tempdir");
        let sidecar = temp_dir.path().join("landscape.arw.rrdata");
        let original = write_sidecar(
            &sidecar,
            &serde_json::json!({
                "version": 1,
                "rating": 5,
                "tags": ["keeper"],
                "exif": {"Artist": "RawEngine"},
                "adjustments": {"exposure": 1.25, "displayIcc": "stale"}
            }),
        );

        let first = load_sidecar_recovering(&sidecar, Some("/photos/landscape.arw"))
            .expect("recover legacy sidecar");
        assert_eq!(first.outcome, PersistedStateOutcome::Recovered);
        assert_eq!(
            fs::read(first.backup_path.expect("backup")).unwrap(),
            original
        );
        assert_eq!(first.metadata.rating, 5);
        assert_eq!(first.metadata.tags, Some(vec!["keeper".to_string()]));
        assert_eq!(first.metadata.adjustments["exposure"], 1.25);
        assert!(first.metadata.adjustments.get("displayIcc").is_none());
        let repaired_bytes = fs::read(&sidecar).unwrap();

        let second = load_sidecar_recovering(&sidecar, Some("/photos/landscape.arw"))
            .expect("reopen repaired sidecar");
        assert_eq!(second.outcome, PersistedStateOutcome::Current);
        assert!(second.backup_path.is_none());
        assert_eq!(fs::read(&sidecar).unwrap(), repaired_bytes);
    }

    #[test]
    fn malformed_and_future_sidecars_quarantine_render_state() {
        let temp_dir = tempfile::tempdir().expect("tempdir");
        let malformed = temp_dir.path().join("bad.arw.rrdata");
        let malformed_bytes = br#"{"version":1,"adjustments":{"exposure":2"#;
        fs::write(&malformed, malformed_bytes).unwrap();
        let loaded = load_sidecar_recovering(&malformed, Some("/photos/bad.arw"))
            .expect("quarantine malformed");
        assert_eq!(loaded.outcome, PersistedStateOutcome::Quarantined);
        assert_eq!(loaded.metadata.adjustments, serde_json::json!({}));
        assert_eq!(
            fs::read(loaded.backup_path.unwrap()).unwrap(),
            malformed_bytes
        );

        let future = temp_dir.path().join("future.arw.rrdata");
        write_sidecar(
            &future,
            &serde_json::json!({
                "version": 99,
                "rating": 4,
                "tags": ["preserve"],
                "adjustments": {"temperature": 9000}
            }),
        );
        let loaded = load_sidecar_recovering(&future, Some("/photos/future.arw"))
            .expect("quarantine future");
        assert_eq!(loaded.outcome, PersistedStateOutcome::Unsupported);
        assert_eq!(loaded.metadata.rating, 4);
        assert_eq!(loaded.metadata.tags, Some(vec!["preserve".to_string()]));
        assert_eq!(loaded.metadata.adjustments, serde_json::json!({}));
    }

    #[test]
    fn mismatched_authority_and_missing_lut_cannot_reach_render_state() {
        let temp_dir = tempfile::tempdir().expect("tempdir");
        let sidecar = temp_dir.path().join("owned.arw.rrdata");
        write_sidecar(
            &sidecar,
            &serde_json::json!({
                "version": 1,
                "rating": 3,
                "adjustments": {"lutPath": "/missing/look.cube", "lutIntensity": 100},
                "rawEngineArtifacts": {
                    "schemaVersion": 1,
                    "layerStackSidecars": [{
                        "schemaVersion": 1,
                        "sourceImagePath": "/photos/other.arw"
                    }]
                }
            }),
        );

        let loaded = load_sidecar_recovering(&sidecar, Some("/photos/owned.arw"))
            .expect("recover mismatched authority");
        assert_eq!(loaded.outcome, PersistedStateOutcome::Recovered);
        assert_eq!(loaded.metadata.rating, 3);
        assert_eq!(loaded.metadata.adjustments["lutIntensity"], 0);
        assert!(loaded.metadata.adjustments.get("lutPath").is_none());
        assert!(
            loaded
                .metadata
                .raw_engine_artifacts
                .unwrap()
                .layer_stack_sidecars
                .is_empty()
        );
    }

    #[test]
    fn source_identity_mismatch_quarantines_all_pixel_authority() {
        let temp_dir = tempfile::tempdir().expect("tempdir");
        let sidecar = temp_dir.path().join("copy.arw.rrdata");
        let state = PersistedRenderState {
            schema_version: 2,
            implementation_revision: 1,
            source_identity: "/photos/original.arw".to_string(),
            edit_revision: "sha256:old".to_string(),
            user_edits: Some(Map::from_iter([(
                "exposure".to_string(),
                JsonValue::from(4),
            )])),
            defaults_policy_revision: 1,
            camera_input_transform_receipt: None,
            xmp_revision: None,
            recovery_receipts: Vec::new(),
            quarantined_extensions: Map::new(),
        };
        write_sidecar(
            &sidecar,
            &serde_json::json!({
                "version": 2,
                "rating": 2,
                "adjustments": {"exposure": 4},
                "persistedRenderState": state
            }),
        );
        let loaded = load_sidecar_recovering(&sidecar, Some("/photos/copy.arw"))
            .expect("quarantine identity mismatch");
        assert_eq!(loaded.outcome, PersistedStateOutcome::Quarantined);
        assert_eq!(loaded.metadata.adjustments, serde_json::json!({}));
        assert_eq!(loaded.metadata.rating, 2);
    }

    #[test]
    fn private_alaska_raw_recovery_reopen_and_decode_lifecycle() {
        if std::env::var_os("RAPIDRAW_RUN_PRIVATE_SIDECAR_PROOF").is_none() {
            eprintln!("skipping private persisted-state RAW lifecycle proof");
            return;
        }
        let source = Path::new("/Users/cgas/Pictures/Capture One/Alaska/_DSC8786.ARW");
        assert!(source.is_file(), "private Alaska RAW fixture must exist");
        let source_bytes = fs::read(source).expect("read private RAW");
        let temp_dir = tempfile::tempdir().expect("tempdir");
        let sidecar = temp_dir.path().join("_DSC8786.ARW.rrdata");
        write_sidecar(
            &sidecar,
            &serde_json::json!({
                "version": 1,
                "rating": 5,
                "tags": ["private-proof"],
                "adjustments": {
                    "displayIcc": "stale-profile",
                    "cameraProfile": "obsolete-double-transform",
                    "exposure": 0.25
                }
            }),
        );
        let source_identity = source.to_string_lossy();
        let recovered = load_sidecar_recovering(&sidecar, Some(source_identity.as_ref()))
            .expect("recover private RAW sidecar");
        assert_eq!(recovered.outcome, PersistedStateOutcome::Recovered);
        assert_eq!(recovered.metadata.rating, 5);
        assert_eq!(
            recovered.metadata.tags,
            Some(vec!["private-proof".to_string()])
        );
        assert!(recovered.metadata.adjustments.get("displayIcc").is_none());
        assert!(
            recovered
                .metadata
                .adjustments
                .get("cameraProfile")
                .is_none()
        );

        let settings = crate::app_settings::AppSettings::default();
        let decoded = crate::image_loader::load_base_image_from_bytes(
            &source_bytes,
            source_identity.as_ref(),
            false,
            &settings,
            None,
        )
        .expect("decode recovered private RAW");
        assert!(decoded.width() > 1000 && decoded.height() > 1000);
        assert!(
            decoded
                .to_rgb32f()
                .pixels()
                .take(4096)
                .all(|pixel| { pixel.0.into_iter().all(f32::is_finite) })
        );

        let repaired_bytes = fs::read(&sidecar).expect("read repaired sidecar");
        let reopened = load_sidecar_recovering(&sidecar, Some(source_identity.as_ref()))
            .expect("reopen repaired private RAW sidecar");
        assert_eq!(reopened.outcome, PersistedStateOutcome::Current);
        assert_eq!(fs::read(&sidecar).unwrap(), repaired_bytes);
    }

    #[test]
    fn save_sidecar_metadata_atomic_roundtrips_json() {
        let temp_dir = tempfile::tempdir().expect("tempdir");
        let sidecar_path = temp_dir.path().join("image.raf.rrdata");
        let metadata = ImageMetadata {
            exif: Some(HashMap::from([(
                "Artist".to_string(),
                "RawEngine".to_string(),
            )])),
            ..Default::default()
        };

        save_sidecar_metadata_atomic(&sidecar_path, &metadata).expect("atomic sidecar write");

        let reloaded = load_sidecar(&sidecar_path);
        assert_eq!(
            reloaded.exif.as_ref().and_then(|exif| exif.get("Artist")),
            Some(&"RawEngine".to_string())
        );
    }

    #[test]
    fn save_sidecar_roundtrips_versioned_tone_and_view_authority() {
        let temp_dir = tempfile::tempdir().expect("tempdir");
        let sidecar_path = temp_dir.path().join("image.arw.rrdata");
        let adjustments = serde_json::json!({
            "rawEngineEditGraphVersion": 2,
            "toneMapper": "rapidView",
            "toneEqualizer": {
                "autoPlacement": true,
                "bandEv": [-1.0, -0.75, -0.5, -0.25, 0.0, 0.25, 0.5, 0.75, 1.0],
                "detailPreservation": 0.65,
                "edgeRefinement": 2.0,
                "enabled": true,
                "maskExposureCompensation": 0.25,
                "pivotEv": -0.5,
                "previewMode": 3,
                "rangeEv": 16.0,
                "selectedBand": 6,
                "smoothingRadius": 32.0
            },
            "viewTransform": {
                "chromaCompression": 0.25,
                "contrast": 1.15,
                "latitude": 0.55,
                "middleGrey": 0.18,
                "shoulder": 0.5,
                "sourceBlackEv": -10.0,
                "sourceWhiteEv": 6.5,
                "toe": 0.35
            }
        });
        let metadata = ImageMetadata {
            adjustments: adjustments.clone(),
            ..Default::default()
        };

        save_sidecar_metadata_atomic(&sidecar_path, &metadata).expect("persist render authority");

        let reloaded = load_sidecar(&sidecar_path);
        assert_eq!(reloaded.adjustments, adjustments);
        assert_eq!(
            reloaded
                .persisted_render_state
                .and_then(|state| state.user_edits),
            adjustments.as_object().cloned()
        );
    }

    #[test]
    fn save_sidecar_rejects_corrupt_tone_or_view_authority() {
        for (field, corrupt) in [
            ("rawEngineEditGraphVersion", serde_json::json!(99)),
            (
                "toneEqualizer",
                serde_json::json!({
                    "autoPlacement": false,
                    "bandEv": [0.0, 0.0],
                    "detailPreservation": 0.65,
                    "edgeRefinement": 2.0,
                    "enabled": true,
                    "maskExposureCompensation": 0.0,
                    "pivotEv": 0.0,
                    "previewMode": 0,
                    "rangeEv": 16.0,
                    "selectedBand": 4,
                    "smoothingRadius": 32.0
                }),
            ),
            (
                "viewTransform",
                serde_json::json!({
                    "chromaCompression": 0.25,
                    "contrast": 1.15,
                    "latitude": 0.55,
                    "middleGrey": 0.18,
                    "shoulder": 0.5,
                    "sourceBlackEv": -2.0,
                    "sourceWhiteEv": 2.0,
                    "toe": 0.35
                }),
            ),
        ] {
            let temp_dir = tempfile::tempdir().expect("tempdir");
            let sidecar_path = temp_dir.path().join("image.arw.rrdata");
            let metadata = ImageMetadata {
                adjustments: JsonValue::Object(Map::from_iter([(field.to_string(), corrupt)])),
                ..Default::default()
            };

            let error = save_sidecar_metadata_atomic(&sidecar_path, &metadata)
                .expect_err("corrupt render authority must not persist");
            assert!(error.contains(&format!("adjustments.{field}")));
            assert!(!sidecar_path.exists());
        }
    }

    #[test]
    fn save_sidecar_metadata_atomic_reports_missing_parent() {
        let temp_dir = tempfile::tempdir().expect("tempdir");
        let sidecar_path = temp_dir.path().join("missing").join("image.raf.rrdata");
        let err = save_sidecar_metadata_atomic(&sidecar_path, &ImageMetadata::default())
            .expect_err("missing parent should fail");

        assert!(err.contains("Failed to write sidecar"));
        assert!(!sidecar_path.exists());
    }

    #[test]
    fn write_text_file_atomic_preserves_existing_directory_on_replace_failure() {
        let temp_dir = tempfile::tempdir().expect("tempdir");
        let directory_path = temp_dir.path().join("image.raf.rrdata");
        fs::create_dir(&directory_path).expect("target directory");

        let err = write_text_file_atomic(&directory_path, "replacement")
            .expect_err("persisting over a directory should fail");

        assert!(err.contains("Failed to write"));
        assert!(directory_path.is_dir());
    }

    #[test]
    fn repair_raw_camera_metadata_replaces_or_removes_zero_placeholders() {
        let mut sidecar = HashMap::new();
        sidecar.insert("Make".to_string(), "Sony".to_string());
        sidecar.insert("FNumber".to_string(), "f/0".to_string());
        sidecar.insert("ApertureValue".to_string(), "0".to_string());
        sidecar.insert("FocalLength".to_string(), "0".to_string());
        sidecar.insert(
            "FocalLengthIn35mmFilm".to_string(),
            "unknown mm".to_string(),
        );

        let mut extracted = HashMap::new();
        extracted.insert("FNumber".to_string(), "f/8".to_string());
        extracted.insert("FocalLength".to_string(), "105".to_string());

        let (repaired, changed) = repair_raw_camera_metadata(sidecar, &extracted);

        assert!(changed);
        assert_eq!(repaired.get("Make").map(String::as_str), Some("Sony"));
        assert_eq!(repaired.get("FNumber").map(String::as_str), Some("f/8"));
        assert_eq!(repaired.get("FocalLength").map(String::as_str), Some("105"));
        assert!(!repaired.contains_key("ApertureValue"));
        assert!(!repaired.contains_key("FocalLengthIn35mmFilm"));
    }

    #[test]
    fn alaska_sony_arw_metadata_omits_zero_placeholders() {
        let path = Path::new("/Users/cgas/Pictures/Capture One/Alaska/_DSC7513.ARW");
        if !path.exists() {
            eprintln!(
                "skipping Alaska Sony ARW metadata regression: missing {}",
                path.display()
            );
            return;
        }

        let bytes = fs::read(path).expect("read private Alaska ARW");
        let metadata = read_exif_data(path.to_string_lossy().as_ref(), &bytes);

        assert_ne!(metadata.get("FNumber").map(String::as_str), Some("f/0"));
        assert_ne!(metadata.get("FocalLength").map(String::as_str), Some("0"));
        assert_ne!(
            metadata.get("FocalLengthIn35mmFilm").map(String::as_str),
            Some("unknown mm")
        );

        if let Some(f_number) = metadata.get("FNumber") {
            let parsed_f_number = f_number
                .trim_start_matches("f/")
                .parse::<f32>()
                .expect("FNumber should parse as a positive number");
            assert!(parsed_f_number > 0.0);
        }
        if let Some(focal_length) = metadata.get("FocalLength") {
            let parsed_focal_length = focal_length
                .parse::<f32>()
                .expect("FocalLength should parse as a positive number");
            assert!(parsed_focal_length > 0.0);
        }
        if let Some(focal_length_35mm) = metadata.get("FocalLengthIn35mmFilm") {
            let parsed_focal_length_35mm = focal_length_35mm
                .parse::<f32>()
                .expect("FocalLengthIn35mmFilm should parse as a positive number");
            assert!(parsed_focal_length_35mm > 0.0);
        }
    }
}

#[cfg(test)]
mod crop_migration_tests {
    use super::*;

    fn migrate_crop_fixture(
        crop: JsonValue,
        dimensions: Option<(u32, u32)>,
    ) -> (JsonValue, Vec<String>, Vec<String>) {
        let mut adjustments = serde_json::json!({ "crop": crop, "exposure": 0.25 });
        let mut extensions = Map::new();
        let mut disabled = Vec::new();
        let mut migrated = Vec::new();
        let mut reasons = Vec::new();
        validate_adjustments(
            &mut adjustments,
            &mut extensions,
            &mut disabled,
            &mut migrated,
            &mut reasons,
            dimensions,
        );
        (adjustments, migrated, reasons)
    }

    #[test]
    fn pixel_crop_migration_handles_landscape_portrait_and_nontrivial_bounds() {
        for dimensions in [(6000, 4000), (4000, 6000)] {
            let (adjustments, migrated, reasons) = migrate_crop_fixture(
                serde_json::json!({
                    "unit": "px", "x": 0, "y": 0,
                    "width": dimensions.0, "height": dimensions.1
                }),
                Some(dimensions),
            );
            assert!(adjustments.get("crop").is_none());
            assert_eq!(migrated, ["adjustments.crop"]);
            assert_eq!(reasons, ["crop_full_frame_removed"]);
        }

        let (adjustments, migrated, reasons) = migrate_crop_fixture(
            serde_json::json!({ "unit": "px", "x": 600, "y": 400, "width": 3000, "height": 2000 }),
            Some((6000, 4000)),
        );
        assert_eq!(
            adjustments["crop"],
            serde_json::json!({
                "unit": "normalized", "x": 0.1, "y": 0.1, "width": 0.5, "height": 0.5
            })
        );
        assert_eq!(migrated, ["adjustments.crop"]);
        assert_eq!(reasons, ["crop_units_normalized"]);
    }

    #[test]
    fn percent_crop_migration_is_idempotent() {
        let (mut adjustments, migrated, _) = migrate_crop_fixture(
            serde_json::json!({ "unit": "%", "x": 10, "y": 20, "width": 50, "height": 60 }),
            None,
        );
        assert_eq!(
            adjustments["crop"],
            serde_json::json!({
                "unit": "normalized", "x": 0.1, "y": 0.2, "width": 0.5, "height": 0.6
            })
        );
        assert_eq!(migrated, ["adjustments.crop"]);

        let mut extensions = Map::new();
        let mut disabled = Vec::new();
        let mut second_migrated = Vec::new();
        let mut reasons = Vec::new();
        validate_adjustments(
            &mut adjustments,
            &mut extensions,
            &mut disabled,
            &mut second_migrated,
            &mut reasons,
            None,
        );
        assert!(second_migrated.is_empty());
        assert!(reasons.is_empty());
    }

    #[test]
    fn null_crop_is_a_valid_no_op_and_normalized_full_frame_is_removed() {
        let (adjustments, migrated, reasons) = migrate_crop_fixture(JsonValue::Null, None);
        assert!(adjustments["crop"].is_null());
        assert!(migrated.is_empty());
        assert!(reasons.is_empty());

        let (adjustments, migrated, reasons) = migrate_crop_fixture(
            serde_json::json!({
                "unit": "normalized",
                "x": 0.0000000001,
                "y": 0.0,
                "width": 0.9999999999,
                "height": 1.0
            }),
            None,
        );
        assert!(adjustments.get("crop").is_none());
        assert_eq!(migrated, ["adjustments.crop"]);
        assert_eq!(reasons, ["crop_full_frame_removed"]);
    }

    #[test]
    fn pixel_crop_without_dimensions_is_disabled_and_quarantined() {
        let mut adjustments = serde_json::json!({
            "crop": { "unit": "px", "x": 0, "y": 0, "width": 6000, "height": 4000 },
            "exposure": 0.25
        });
        let mut extensions = Map::new();
        let mut disabled = Vec::new();
        let mut migrated = Vec::new();
        let mut reasons = Vec::new();
        validate_adjustments(
            &mut adjustments,
            &mut extensions,
            &mut disabled,
            &mut migrated,
            &mut reasons,
            None,
        );
        assert!(adjustments.get("crop").is_none());
        assert_eq!(adjustments["exposure"], 0.25);
        assert_eq!(extensions["rejectedCrop"]["unit"], "px");
        assert_eq!(disabled, ["adjustments.crop"]);
        assert_eq!(reasons, ["crop_dimensions_unavailable"]);
    }

    #[test]
    fn version_two_pixel_crop_recovers_at_production_boundary_and_is_idempotent() {
        let temp = tempfile::tempdir().unwrap();
        let source = temp.path().join("landscape.png");
        image::RgbImage::new(600, 400).save(&source).unwrap();
        let sidecar = get_primary_sidecar_path(&source);
        let source_identity = source.to_string_lossy().into_owned();
        let legacy = serde_json::json!({
            "version": 2,
            "rating": 4,
            "tags": ["user:alaska"],
            "exif": { "Camera": "Migration Fixture" },
            "adjustments": {
                "crop": { "unit": "px", "x": 60, "y": 40, "width": 300, "height": 200 },
                "exposure": 0.25
            },
            "persistedRenderState": {
                "schemaVersion": 2,
                "implementationRevision": 2,
                "sourceIdentity": source_identity,
                "editRevision": "sha256:legacy",
                "userEdits": {
                    "crop": { "unit": "px", "x": 60, "y": 40, "width": 300, "height": 200 },
                    "exposure": 0.25
                },
                "defaultsPolicyRevision": 1
            }
        });
        fs::write(&sidecar, serde_json::to_vec_pretty(&legacy).unwrap()).unwrap();

        let first = load_sidecar_recovering(&sidecar, None).unwrap();
        assert_eq!(first.outcome, PersistedStateOutcome::Migrated);
        assert_eq!(first.metadata.rating, 4);
        assert_eq!(
            first.metadata.tags.as_deref(),
            Some(["user:alaska".to_string()].as_slice())
        );
        assert_eq!(
            first.metadata.exif.as_ref().unwrap()["Camera"],
            "Migration Fixture"
        );
        assert_eq!(
            first.metadata.adjustments["crop"],
            serde_json::json!({
                "unit": "normalized", "x": 0.1, "y": 0.1, "width": 0.5, "height": 0.5
            })
        );
        let compiled = crate::render_plan::compile_render_plan(
            &first.metadata.adjustments,
            crate::render_plan::CompileRenderPlanContext {
                revision: crate::render_plan::RenderPlanRevision {
                    image_session: 1,
                    source_revision: 1,
                    adjustment_revision: 1,
                    schema_version: 1,
                    settings_revision: 0,
                },
                is_raw: true,
                tonemapper_override: None,
            },
            None,
        )
        .expect("migrated crop must compile into the native render plan");
        assert_eq!(compiled.crop.unwrap().width, 0.5);
        let state = first.metadata.persisted_render_state.as_ref().unwrap();
        assert_eq!(state.implementation_revision, 2);
        assert_eq!(
            state.recovery_receipts.last().unwrap().migrated_fields,
            ["adjustments.crop"]
        );
        assert!(first.backup_path.as_ref().is_some_and(|path| path.exists()));

        let repaired_bytes = fs::read(&sidecar).unwrap();
        let second = load_sidecar_recovering(&sidecar, None).unwrap();
        assert_eq!(second.outcome, PersistedStateOutcome::Current);
        assert!(second.backup_path.is_none());
        assert_eq!(fs::read(&sidecar).unwrap(), repaired_bytes);
    }

    #[test]
    fn pixel_crop_with_missing_source_is_quarantined_without_losing_metadata() {
        let temp = tempfile::tempdir().unwrap();
        let source = temp.path().join("missing.arw");
        let sidecar = get_primary_sidecar_path(&source);
        let source_identity = source.to_string_lossy().into_owned();
        let legacy = serde_json::json!({
            "version": 2,
            "rating": 5,
            "tags": ["user:keeper"],
            "exif": { "Camera": "Unavailable Source Fixture" },
            "adjustments": {
                "crop": { "unit": "px", "x": 0, "y": 0, "width": 6000, "height": 4000 },
                "contrast": 12
            },
            "persistedRenderState": {
                "schemaVersion": 2,
                "implementationRevision": 1,
                "sourceIdentity": source_identity,
                "editRevision": "sha256:legacy",
                "userEdits": {
                    "crop": { "unit": "px", "x": 0, "y": 0, "width": 6000, "height": 4000 },
                    "contrast": 12
                },
                "defaultsPolicyRevision": 1
            }
        });
        fs::write(&sidecar, serde_json::to_vec_pretty(&legacy).unwrap()).unwrap();

        let recovered = load_sidecar_recovering(&sidecar, Some(&source_identity)).unwrap();
        assert_eq!(recovered.outcome, PersistedStateOutcome::Recovered);
        assert_eq!(recovered.metadata.rating, 5);
        assert_eq!(recovered.metadata.adjustments["contrast"], 12);
        assert!(recovered.metadata.adjustments.get("crop").is_none());
        let state = recovered.metadata.persisted_render_state.as_ref().unwrap();
        assert_eq!(state.quarantined_extensions["rejectedCrop"]["unit"], "px");
        let receipt = state.recovery_receipts.last().unwrap();
        assert_eq!(receipt.disabled_fields, ["adjustments.crop"]);
        assert!(
            receipt
                .reason_codes
                .iter()
                .any(|reason| reason == "crop_dimensions_unavailable")
        );
        assert!(
            recovered
                .backup_path
                .as_ref()
                .is_some_and(|path| path.exists())
        );
    }
}

#[cfg(test)]
#[test]
fn persisted_orientation_steps_swap_source_dimensions_only_for_odd_turns() {
    for (steps, expected) in [
        (0, (6000, 4000)),
        (1, (4000, 6000)),
        (2, (6000, 4000)),
        (3, (4000, 6000)),
        (-1, (4000, 6000)),
    ] {
        let adjustments = serde_json::json!({ "orientationSteps": steps });
        assert_eq!(
            orient_dimensions_for_adjustments((6000, 4000), &adjustments),
            expected
        );
    }
}

#[cfg(test)]
#[test]
fn save_then_load_does_not_double_swap_or_renormalize_portrait_crop() {
    let temp = tempfile::tempdir().unwrap();
    let source = temp.path().join("portrait.png");
    image::RgbImage::new(600, 400).save(&source).unwrap();
    let sidecar = get_primary_sidecar_path(&source);
    let metadata = ImageMetadata {
        rating: 5,
        adjustments: serde_json::json!({
            "orientationSteps": 1,
            "crop": { "unit": "px", "x": 0, "y": 0, "width": 400, "height": 600 }
        }),
        ..ImageMetadata::default()
    };

    save_sidecar_metadata_atomic(&sidecar, &metadata).unwrap();
    let first_bytes = fs::read(&sidecar).unwrap();
    let loaded = load_sidecar_recovering(&sidecar, None).unwrap();
    assert_eq!(loaded.outcome, PersistedStateOutcome::Current);
    assert!(loaded.metadata.adjustments.get("crop").is_none());
    assert_eq!(loaded.metadata.rating, 5);
    assert_eq!(fs::read(&sidecar).unwrap(), first_bytes);
}
