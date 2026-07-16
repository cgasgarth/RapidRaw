use std::collections::{BTreeMap, HashMap};
use std::fs;
use std::io::{BufReader, Cursor, Write};
use std::path::{Path, PathBuf};

use crate::formats::is_raw_file;
use crate::image_processing::{ImageMetadata, RawEngineArtifacts};
use chrono::{DateTime, NaiveDateTime, Utc};
use exif::{Exif, In, Value};
use little_exif::exif_tag::ExifTag;
use little_exif::filetype::FileExtension;
use little_exif::metadata::Metadata;
use little_exif::rational::{iR64, uR64};
use rawler::decoders::RawMetadata;
use serde::{Deserialize, Serialize};
use serde_json::Value as JsonValue;
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

const CURRENT_SIDECAR_CONTRACT: &str = "rapidraw.sidecar.v1";
const CURRENT_SIDECAR_SCHEMA_VERSION: u32 = 1;
const MAX_QUARANTINE_BACKUPS: usize = 3;

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct CurrentSidecarEnvelope {
    contract: String,
    schema_version: u32,
    source_identity: String,
    edit_revision: String,
    #[serde(rename = "editDocumentV2")]
    edit_document_v2: JsonValue,
    rating: u8,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    tags: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    exif: Option<HashMap<String, String>>,
    #[serde(
        default,
        rename = "rawEngineArtifacts",
        skip_serializing_if = "Option::is_none"
    )]
    raw_engine_artifacts: Option<RawEngineArtifacts>,
}

pub fn load_sidecar(sidecar_path: &Path) -> ImageMetadata {
    let source_identity = source_identity_from_sidecar_path(sidecar_path);
    load_sidecar_recovering(sidecar_path, Some(&source_identity))
        .map(|loaded| loaded.metadata)
        .unwrap_or_else(|_| neutral_current_metadata(source_identity))
}

pub fn load_sidecar_recovering(
    sidecar_path: &Path,
    expected_source_identity: Option<&str>,
) -> Result<PersistedStateLoad, String> {
    let source_identity = expected_source_identity
        .map(str::to_string)
        .unwrap_or_else(|| source_identity_from_sidecar_path(sidecar_path));
    if !sidecar_path.exists() {
        log::debug!(
            "persisted_state_outcome=absent sidecar={}",
            sidecar_path.display()
        );
        return Ok(PersistedStateLoad {
            metadata: neutral_current_metadata(source_identity),
            outcome: PersistedStateOutcome::Absent,
            backup_path: None,
            reason_codes: Vec::new(),
        });
    }

    let bytes = fs::read(sidecar_path)
        .map_err(|error| format!("Failed to read sidecar {}: {error}", sidecar_path.display()))?;
    let parsed = serde_json::from_slice::<JsonValue>(&bytes);
    let mut reasons = Vec::new();
    let mut outcome = PersistedStateOutcome::Quarantined;
    let envelope = match parsed {
        Ok(value) => {
            let object = value.as_object();
            let contract = object
                .and_then(|value| value.get("contract"))
                .and_then(JsonValue::as_str);
            let schema_version = object
                .and_then(|value| value.get("schemaVersion"))
                .and_then(JsonValue::as_u64);
            if contract != Some(CURRENT_SIDECAR_CONTRACT)
                || schema_version != Some(u64::from(CURRENT_SIDECAR_SCHEMA_VERSION))
            {
                outcome = PersistedStateOutcome::Unsupported;
                reasons.push("sidecar_contract_unsupported".to_string());
                None
            } else {
                match serde_json::from_value::<CurrentSidecarEnvelope>(value) {
                    Ok(envelope) => Some(envelope),
                    Err(_) => {
                        reasons.push("sidecar_shape_invalid".to_string());
                        None
                    }
                }
            }
        }
        Err(_) => {
            reasons.push("sidecar_json_malformed".to_string());
            None
        }
    };

    if let Some(envelope) = envelope {
        let validation = validate_current_envelope(&envelope, &source_identity);
        match validation {
            Ok(()) => {
                let adjustments = crate::adjustments::edit_document_v2::compile_edit_document_v2(
                    &envelope.edit_document_v2,
                )?;
                return Ok(PersistedStateLoad {
                    metadata: ImageMetadata {
                        rating: envelope.rating,
                        adjustments,
                        edit_document_v2: Some(envelope.edit_document_v2),
                        tags: envelope.tags,
                        exif: envelope.exif,
                        raw_engine_artifacts: envelope.raw_engine_artifacts,
                        source_identity: envelope.source_identity,
                        edit_revision: envelope.edit_revision,
                    },
                    outcome: PersistedStateOutcome::Current,
                    backup_path: None,
                    reason_codes: Vec::new(),
                });
            }
            Err(reason) => reasons.push(reason),
        }
    }

    let backup_path = quarantine_original_bytes(sidecar_path, &bytes)?;
    fs::remove_file(sidecar_path).map_err(|error| {
        format!(
            "Failed to retire quarantined sidecar {}: {error}",
            sidecar_path.display()
        )
    })?;
    log::warn!(
        "persisted_state_outcome={:?} sidecar={} backup={} reasons={}",
        outcome,
        sidecar_path.display(),
        backup_path.display(),
        reasons.join(",")
    );
    Ok(PersistedStateLoad {
        metadata: neutral_current_metadata(source_identity),
        outcome,
        backup_path: Some(backup_path),
        reason_codes: reasons,
    })
}

fn validate_current_envelope(
    envelope: &CurrentSidecarEnvelope,
    expected_source_identity: &str,
) -> Result<(), String> {
    if envelope.contract != CURRENT_SIDECAR_CONTRACT
        || envelope.schema_version != CURRENT_SIDECAR_SCHEMA_VERSION
    {
        return Err("sidecar_contract_unsupported".to_string());
    }
    if envelope.source_identity.is_empty() || envelope.source_identity != expected_source_identity {
        return Err("source_identity_mismatch".to_string());
    }
    crate::adjustments::edit_document_v2::validate_edit_document_v2(&envelope.edit_document_v2)
        .map_err(|_| "edit_document_v2_invalid".to_string())?;
    validate_current_artifacts(
        envelope.raw_engine_artifacts.as_ref(),
        &envelope.source_identity,
    )?;
    let expected_revision = render_state_revision(
        &envelope.edit_document_v2,
        envelope.raw_engine_artifacts.as_ref(),
    )?;
    if envelope.edit_revision != expected_revision {
        return Err("edit_revision_mismatch".to_string());
    }
    Ok(())
}

fn source_identity_from_sidecar_path(sidecar_path: &Path) -> String {
    let display = sidecar_path.to_string_lossy();
    display
        .strip_suffix(".rrdata")
        .unwrap_or(display.as_ref())
        .to_string()
}

pub(crate) fn neutral_current_edit_document() -> JsonValue {
    serde_json::from_str(include_str!(
        "../../../fixtures/edit-document/current-neutral-v2.json"
    ))
    .expect("checked-in neutral current EditDocumentV2 fixture must be valid JSON")
}

fn neutral_current_metadata(source_identity: String) -> ImageMetadata {
    let document = neutral_current_edit_document();
    let adjustments = crate::adjustments::edit_document_v2::compile_edit_document_v2(&document)
        .expect("native neutral EditDocumentV2 must remain valid");
    let edit_revision = render_state_revision(&document, None)
        .expect("native neutral EditDocumentV2 must remain serializable");
    ImageMetadata {
        rating: 0,
        adjustments,
        edit_document_v2: Some(document),
        tags: None,
        exif: None,
        raw_engine_artifacts: None,
        source_identity,
        edit_revision,
    }
}

fn validate_current_artifacts(
    artifacts: Option<&RawEngineArtifacts>,
    source_identity: &str,
) -> Result<(), String> {
    let Some(artifacts) = artifacts else {
        return Ok(());
    };
    if artifacts.schema_version != 1 {
        return Err("artifact_schema_unsupported".to_string());
    }
    if artifacts.layer_stack_sidecars.iter().any(|sidecar| {
        sidecar.get("schemaVersion").and_then(JsonValue::as_u64) != Some(1)
            || sidecar
                .get("sourceImagePath")
                .and_then(JsonValue::as_str)
                .is_none_or(|source| source != source_identity)
    }) {
        return Err("layer_authority_source_mismatch".to_string());
    }
    Ok(())
}

pub(crate) fn render_state_revision(
    adjustments: &JsonValue,
    artifacts: Option<&crate::image_processing::RawEngineArtifacts>,
) -> Result<String, String> {
    fn canonical_json(value: &JsonValue) -> String {
        match value {
            JsonValue::Object(map) => {
                let sorted = map.iter().collect::<BTreeMap<_, _>>();
                format!(
                    "{{{}}}",
                    sorted
                        .into_iter()
                        .map(|(key, value)| format!(
                            "{}:{}",
                            serde_json::to_string(key).expect("JSON object key"),
                            canonical_json(value)
                        ))
                        .collect::<Vec<_>>()
                        .join(",")
                )
            }
            JsonValue::Array(items) => format!(
                "[{}]",
                items
                    .iter()
                    .map(canonical_json)
                    .collect::<Vec<_>>()
                    .join(",")
            ),
            _ => serde_json::to_string(value).expect("JSON scalar"),
        }
    }

    let value = serde_json::to_value((adjustments, artifacts))
        .map_err(|error| format!("Failed to hash persisted render state: {error}"))?;
    Ok(format!(
        "sha256:{}",
        hex::encode(Sha256::digest(canonical_json(&value).as_bytes()))
    ))
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
    let neutral_document;
    let document = match metadata.edit_document_v2.as_ref() {
        Some(document) => document,
        None if metadata.adjustments.is_null() || metadata.adjustments == serde_json::json!({}) => {
            neutral_document = neutral_current_edit_document();
            &neutral_document
        }
        None => {
            return Err(format!(
                "Refusing flat-only render authority without current EditDocumentV2 in {}",
                sidecar_path.display()
            ));
        }
    };
    crate::adjustments::edit_document_v2::validate_edit_document_v2(document).map_err(|error| {
        format!(
            "Refusing to persist invalid render state in {}: editDocumentV2 ({error})",
            sidecar_path.display()
        )
    })?;
    let source_identity = if metadata.source_identity.is_empty() {
        source_identity_from_sidecar_path(sidecar_path)
    } else {
        metadata.source_identity.clone()
    };
    validate_current_artifacts(metadata.raw_engine_artifacts.as_ref(), &source_identity).map_err(
        |reason| {
            format!(
                "Refusing to persist invalid artifacts in {}: {reason}",
                sidecar_path.display()
            )
        },
    )?;
    let mut envelope = CurrentSidecarEnvelope {
        contract: CURRENT_SIDECAR_CONTRACT.to_string(),
        schema_version: CURRENT_SIDECAR_SCHEMA_VERSION,
        source_identity,
        edit_revision: String::new(),
        edit_document_v2: document.clone(),
        rating: metadata.rating,
        tags: metadata.tags.clone(),
        exif: metadata.exif.clone(),
        raw_engine_artifacts: metadata.raw_engine_artifacts.clone(),
    };
    // Hash the exact typed representation that will reopen from disk. Some artifact
    // payloads contain values whose Serde roundtrip normalization is significant.
    let normalized_json = serde_json::to_string(&envelope).map_err(|error| {
        format!(
            "Failed to normalize sidecar {} before hashing: {error}",
            sidecar_path.display()
        )
    })?;
    let normalized =
        serde_json::from_str::<CurrentSidecarEnvelope>(&normalized_json).map_err(|error| {
            format!(
                "Failed to normalize sidecar {} before hashing: {error}",
                sidecar_path.display()
            )
        })?;
    envelope = normalized;
    envelope.edit_revision = render_state_revision(
        &envelope.edit_document_v2,
        envelope.raw_engine_artifacts.as_ref(),
    )?;
    let json = serde_json::to_string_pretty(&envelope).map_err(|error| {
        format!(
            "Failed to serialize sidecar {}: {error}",
            sidecar_path.display()
        )
    })?;
    write_text_file_atomic(sidecar_path, &json).map_err(|error| {
        format!(
            "Failed to write sidecar {}: {error}",
            sidecar_path.display()
        )
    })
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

    fn metadata_for(source: &Path) -> ImageMetadata {
        let mut metadata = neutral_current_metadata(source.to_string_lossy().into_owned());
        metadata.rating = 4;
        metadata.tags = Some(vec!["user:current".to_string()]);
        metadata.exif = Some(HashMap::from([(
            "Artist".to_string(),
            "RawEngine".to_string(),
        )]));
        metadata
    }

    #[test]
    fn current_sidecar_roundtrip_is_deterministic_and_has_one_pixel_authority() {
        let temp = tempfile::tempdir().unwrap();
        let source = temp.path().join("current.arw");
        let sidecar = get_primary_sidecar_path(&source);
        let metadata = metadata_for(&source);

        save_sidecar_metadata_atomic(&sidecar, &metadata).unwrap();
        let first_bytes = fs::read(&sidecar).unwrap();
        let persisted: JsonValue = serde_json::from_slice(&first_bytes).unwrap();
        let object = persisted.as_object().unwrap();
        assert_eq!(object["contract"], CURRENT_SIDECAR_CONTRACT);
        assert_eq!(
            object["schemaVersion"],
            JsonValue::from(CURRENT_SIDECAR_SCHEMA_VERSION)
        );
        assert_eq!(object["sourceIdentity"], source.to_string_lossy().as_ref());
        assert!(object.contains_key("editDocumentV2"));
        assert!(!object.contains_key("adjustments"));
        assert!(!object.contains_key("persistedRenderState"));
        assert_eq!(
            object
                .keys()
                .cloned()
                .collect::<std::collections::BTreeSet<_>>(),
            [
                "contract",
                "editDocumentV2",
                "editRevision",
                "exif",
                "rating",
                "schemaVersion",
                "sourceIdentity",
                "tags",
            ]
            .into_iter()
            .map(str::to_string)
            .collect()
        );

        let loaded =
            load_sidecar_recovering(&sidecar, Some(source.to_string_lossy().as_ref())).unwrap();
        assert_eq!(loaded.outcome, PersistedStateOutcome::Current);
        assert_eq!(loaded.metadata.edit_document_v2, metadata.edit_document_v2);
        assert_eq!(loaded.metadata.rating, 4);
        assert_eq!(loaded.metadata.tags, metadata.tags);
        assert_eq!(loaded.metadata.exif, metadata.exif);

        save_sidecar_metadata_atomic(&sidecar, &loaded.metadata).unwrap();
        assert_eq!(fs::read(&sidecar).unwrap(), first_bytes);
    }

    #[test]
    fn unsupported_and_malformed_sidecars_are_backed_up_then_retired() {
        let cases = [
            (
                "old",
                br#"{"version":2,"adjustments":{"exposure":1}}"#.as_slice(),
                PersistedStateOutcome::Unsupported,
                "sidecar_contract_unsupported",
            ),
            (
                "future",
                br#"{"contract":"rapidraw.sidecar.v1","schemaVersion":2}"#.as_slice(),
                PersistedStateOutcome::Unsupported,
                "sidecar_contract_unsupported",
            ),
            (
                "malformed",
                br#"{"contract":"#.as_slice(),
                PersistedStateOutcome::Quarantined,
                "sidecar_json_malformed",
            ),
        ];
        for (name, bytes, expected_outcome, expected_reason) in cases {
            let temp = tempfile::tempdir().unwrap();
            let source = temp.path().join(format!("{name}.arw"));
            let sidecar = get_primary_sidecar_path(&source);
            fs::write(&sidecar, bytes).unwrap();

            let loaded =
                load_sidecar_recovering(&sidecar, Some(source.to_string_lossy().as_ref())).unwrap();
            assert_eq!(loaded.outcome, expected_outcome);
            assert_eq!(loaded.reason_codes, [expected_reason]);
            assert!(loaded.metadata.edit_document_v2.is_some());
            assert_eq!(
                fs::read(loaded.backup_path.unwrap()).unwrap(),
                bytes,
                "{name} original bytes"
            );
            assert!(!sidecar.exists(), "{name} unsupported sidecar retired");
        }
    }

    #[test]
    fn source_and_revision_mismatch_never_become_active_authority() {
        let temp = tempfile::tempdir().unwrap();
        let source = temp.path().join("source.arw");
        let sidecar = get_primary_sidecar_path(&source);
        save_sidecar_metadata_atomic(&sidecar, &metadata_for(&source)).unwrap();
        let current_bytes = fs::read(&sidecar).unwrap();

        let wrong_source = temp.path().join("other.arw");
        let wrong =
            load_sidecar_recovering(&sidecar, Some(wrong_source.to_string_lossy().as_ref()))
                .unwrap();
        assert_eq!(wrong.outcome, PersistedStateOutcome::Quarantined);
        assert_eq!(wrong.reason_codes, ["source_identity_mismatch"]);
        assert_eq!(fs::read(wrong.backup_path.unwrap()).unwrap(), current_bytes);
        assert!(!sidecar.exists());

        save_sidecar_metadata_atomic(&sidecar, &metadata_for(&source)).unwrap();
        let mut tampered: JsonValue = serde_json::from_slice(&fs::read(&sidecar).unwrap()).unwrap();
        tampered["editRevision"] = JsonValue::String("sha256:tampered".to_string());
        let tampered_bytes = serde_json::to_vec_pretty(&tampered).unwrap();
        fs::write(&sidecar, &tampered_bytes).unwrap();
        let rejected =
            load_sidecar_recovering(&sidecar, Some(source.to_string_lossy().as_ref())).unwrap();
        assert_eq!(rejected.outcome, PersistedStateOutcome::Quarantined);
        assert_eq!(rejected.reason_codes, ["edit_revision_mismatch"]);
        assert_eq!(
            fs::read(rejected.backup_path.unwrap()).unwrap(),
            tampered_bytes
        );
        assert!(!sidecar.exists());
    }

    #[test]
    fn save_rejects_flat_only_or_invalid_current_authority() {
        let temp = tempfile::tempdir().unwrap();
        let source = temp.path().join("invalid.arw");
        let sidecar = get_primary_sidecar_path(&source);
        let flat_only = ImageMetadata {
            adjustments: serde_json::json!({"exposure": 1}),
            source_identity: source.to_string_lossy().into_owned(),
            ..ImageMetadata::default()
        };
        let error = save_sidecar_metadata_atomic(&sidecar, &flat_only).unwrap_err();
        assert!(error.contains("flat-only"));
        assert!(!sidecar.exists());

        let mut invalid = metadata_for(&source);
        invalid.edit_document_v2.as_mut().unwrap()["schemaVersion"] = JsonValue::from(1);
        let error = save_sidecar_metadata_atomic(&sidecar, &invalid).unwrap_err();
        assert!(error.contains("editDocumentV2"));
        assert!(!sidecar.exists());
    }

    #[test]
    fn missing_sidecar_returns_explicit_current_neutral_document() {
        let temp = tempfile::tempdir().unwrap();
        let source = temp.path().join("new.arw");
        let sidecar = get_primary_sidecar_path(&source);
        let loaded =
            load_sidecar_recovering(&sidecar, Some(source.to_string_lossy().as_ref())).unwrap();
        assert_eq!(loaded.outcome, PersistedStateOutcome::Absent);
        assert_eq!(loaded.metadata.source_identity, source.to_string_lossy());
        let document = loaded.metadata.edit_document_v2.as_ref().unwrap();
        crate::adjustments::edit_document_v2::validate_edit_document_v2(document).unwrap();
        assert_eq!(
            loaded.metadata.adjustments,
            crate::adjustments::edit_document_v2::compile_edit_document_v2(document).unwrap()
        );
    }

    #[test]
    fn current_artifact_source_is_strict() {
        let temp = tempfile::tempdir().unwrap();
        let source = temp.path().join("artifact.arw");
        let sidecar = get_primary_sidecar_path(&source);
        let mut metadata = metadata_for(&source);
        metadata.raw_engine_artifacts = Some(RawEngineArtifacts {
            layer_stack_sidecars: vec![serde_json::json!({
                "schemaVersion": 1,
                "sourceImagePath": "/wrong/source.arw"
            })],
            ..RawEngineArtifacts::new_v1()
        });
        let error = save_sidecar_metadata_atomic(&sidecar, &metadata).unwrap_err();
        assert!(error.contains("layer_authority_source_mismatch"));
        assert!(!sidecar.exists());
    }

    #[test]
    fn save_sidecar_metadata_atomic_reports_missing_parent() {
        let temp = tempfile::tempdir().unwrap();
        let source = temp.path().join("missing").join("image.arw");
        let sidecar = get_primary_sidecar_path(&source);
        let error = save_sidecar_metadata_atomic(&sidecar, &metadata_for(&source)).unwrap_err();
        assert!(error.contains("Failed to write sidecar"));
        assert!(!sidecar.exists());
    }
}

#[cfg(test)]
#[test]
fn normalized_crop_contract_does_not_depend_on_source_dimensions_or_orientation() {
    let crop: crate::geometry::Crop = serde_json::from_value(serde_json::json!({
        "unit": "normalized", "x": 0.1, "y": 0.2, "width": 0.5, "height": 0.6
    }))
    .unwrap();
    assert_eq!(crop.pixel_bounds(6000, 4000), Some((600, 800, 3000, 2400)));
    assert_eq!(crop.pixel_bounds(4000, 6000), Some((400, 1200, 2000, 3600)));
}

#[cfg(test)]
#[test]
fn save_then_load_preserves_normalized_portrait_crop_exactly() {
    let temp = tempfile::tempdir().unwrap();
    let source = temp.path().join("portrait.png");
    image::RgbImage::new(600, 400).save(&source).unwrap();
    let sidecar = get_primary_sidecar_path(&source);
    let mut metadata = neutral_current_metadata(source.to_string_lossy().into_owned());
    metadata.rating = 5;
    let document = metadata.edit_document_v2.as_mut().unwrap();
    document["geometry"]["orientationSteps"] = JsonValue::from(1);
    document["geometry"]["crop"] = serde_json::json!({
        "unit": "normalized", "x": 0.1, "y": 0.2, "width": 0.5, "height": 0.6
    });
    document["nodes"]["geometry"] = serde_json::json!({
        "enabled": true,
        "implementationVersion": 1,
        "params": document["geometry"].clone(),
        "process": "scene_referred_v2",
        "type": "geometry"
    });

    save_sidecar_metadata_atomic(&sidecar, &metadata).unwrap();
    let first_bytes = fs::read(&sidecar).unwrap();
    let loaded = load_sidecar_recovering(&sidecar, None).unwrap();
    assert_eq!(loaded.outcome, PersistedStateOutcome::Current);
    assert_eq!(
        loaded.metadata.adjustments["crop"],
        serde_json::json!({ "unit": "normalized", "x": 0.1, "y": 0.2, "width": 0.5, "height": 0.6 })
    );
    assert_eq!(loaded.metadata.rating, 5);
    assert_eq!(fs::read(&sidecar).unwrap(), first_bytes);
}
