use std::collections::BTreeSet;

use anyhow::{Context, Result, anyhow, ensure};
use sha2::{Digest, Sha256};

use super::{DcpProfileV1, HsvDelta, ProfileTable, ProfileTableEncoding, ToneCurvePoint};

const TAG_UNIQUE_CAMERA_MODEL: u16 = 50_708;
const TAG_COLOR_MATRIX_1: u16 = 50_721;
const TAG_COLOR_MATRIX_2: u16 = 50_722;
const TAG_CAMERA_CALIBRATION_1: u16 = 50_723;
const TAG_CAMERA_CALIBRATION_2: u16 = 50_724;
const TAG_REDUCTION_MATRIX_1: u16 = 50_725;
const TAG_REDUCTION_MATRIX_2: u16 = 50_726;
const TAG_ANALOG_BALANCE: u16 = 50_727;
const TAG_BASELINE_EXPOSURE: u16 = 50_730;
const TAG_CALIBRATION_ILLUMINANT_1: u16 = 50_778;
const TAG_CALIBRATION_ILLUMINANT_2: u16 = 50_779;
const TAG_PROFILE_NAME: u16 = 50_936;
const TAG_PROFILE_CALIBRATION_SIGNATURE: u16 = 50_932;
const TAG_HUE_SAT_DIMS: u16 = 50_937;
const TAG_HUE_SAT_DATA_1: u16 = 50_938;
const TAG_HUE_SAT_DATA_2: u16 = 50_939;
const TAG_TONE_CURVE: u16 = 50_940;
const TAG_EMBED_POLICY: u16 = 50_941;
const TAG_PROFILE_COPYRIGHT: u16 = 50_942;
const TAG_FORWARD_MATRIX_1: u16 = 50_964;
const TAG_FORWARD_MATRIX_2: u16 = 50_965;
const TAG_LOOK_DIMS: u16 = 50_981;
const TAG_LOOK_DATA: u16 = 50_982;
const TAG_BASELINE_EXPOSURE_OFFSET: u16 = 51_135;
const TAG_DEFAULT_BLACK_RENDER: u16 = 51_110;
const TAG_HUE_SAT_ENCODING: u16 = 51_107;
const TAG_LOOK_ENCODING: u16 = 51_108;
const EXECUTION_UNSUPPORTED_TAGS: &[u16] = &[
    52_529, // CalibrationIlluminant3
    52_530, // CameraCalibration3
    52_531, // ColorMatrix3
    52_532, // ForwardMatrix3
    52_533, // IlluminantData1
    52_534, // IlluminantData2
    52_535, // IlluminantData3
    52_537, // ProfileHueSatMapData3
    52_538, // ReductionMatrix3
    52_543, // RGBTables
    52_551, // ProfileDynamicRange
];

const SUPPORTED_TAGS: &[u16] = &[
    TAG_UNIQUE_CAMERA_MODEL,
    TAG_COLOR_MATRIX_1,
    TAG_COLOR_MATRIX_2,
    TAG_CAMERA_CALIBRATION_1,
    TAG_CAMERA_CALIBRATION_2,
    TAG_REDUCTION_MATRIX_1,
    TAG_REDUCTION_MATRIX_2,
    TAG_ANALOG_BALANCE,
    TAG_BASELINE_EXPOSURE,
    TAG_CALIBRATION_ILLUMINANT_1,
    TAG_CALIBRATION_ILLUMINANT_2,
    TAG_PROFILE_NAME,
    TAG_PROFILE_CALIBRATION_SIGNATURE,
    TAG_HUE_SAT_DIMS,
    TAG_HUE_SAT_DATA_1,
    TAG_HUE_SAT_DATA_2,
    TAG_TONE_CURVE,
    TAG_EMBED_POLICY,
    TAG_PROFILE_COPYRIGHT,
    TAG_FORWARD_MATRIX_1,
    TAG_FORWARD_MATRIX_2,
    TAG_LOOK_DIMS,
    TAG_LOOK_DATA,
    TAG_BASELINE_EXPOSURE_OFFSET,
    TAG_DEFAULT_BLACK_RENDER,
    TAG_HUE_SAT_ENCODING,
    TAG_LOOK_ENCODING,
];

#[derive(Debug, Clone, Copy)]
pub(crate) struct DcpParseLimits {
    pub max_file_bytes: usize,
    pub max_ifd_entries: usize,
    pub max_table_entries: usize,
    pub max_string_bytes: usize,
}

impl Default for DcpParseLimits {
    fn default() -> Self {
        Self {
            max_file_bytes: 64 * 1024 * 1024,
            max_ifd_entries: 512,
            max_table_entries: 1_048_576,
            max_string_bytes: 4096,
        }
    }
}

#[derive(Clone, Copy)]
enum Endian {
    Little,
    Big,
}

#[derive(Debug)]
struct Field<'a> {
    tag: u16,
    kind: u16,
    count: usize,
    bytes: &'a [u8],
}

pub(crate) fn parse_dcp(bytes: &[u8], limits: DcpParseLimits) -> Result<DcpProfileV1> {
    ensure!(
        !bytes.is_empty() && bytes.len() <= limits.max_file_bytes,
        "dcp_file_size_out_of_bounds"
    );
    ensure!(bytes.len() >= 8, "dcp_truncated_header");
    let endian = match &bytes[..2] {
        b"II" => Endian::Little,
        b"MM" => Endian::Big,
        _ => return Err(anyhow!("dcp_invalid_byte_order")),
    };
    ensure!(read_u16(bytes, 2, endian)? == 42, "dcp_invalid_tiff_magic");
    let ifd_offset =
        usize::try_from(read_u32(bytes, 4, endian)?).context("dcp_ifd_offset_overflow")?;
    let entry_count = usize::from(read_u16(bytes, ifd_offset, endian)?);
    ensure!(
        entry_count > 0 && entry_count <= limits.max_ifd_entries,
        "dcp_ifd_entry_count_out_of_bounds"
    );
    let table_end = ifd_offset
        .checked_add(2)
        .and_then(|v| v.checked_add(entry_count.checked_mul(12)?))
        .and_then(|v| v.checked_add(4))
        .ok_or_else(|| anyhow!("dcp_ifd_size_overflow"))?;
    ensure!(table_end <= bytes.len(), "dcp_truncated_ifd");
    ensure!(
        read_u32(bytes, table_end - 4, endian)? == 0,
        "dcp_multiple_ifds_not_supported"
    );

    let mut fields = Vec::with_capacity(entry_count);
    let mut seen = BTreeSet::new();
    for index in 0..entry_count {
        let at = ifd_offset + 2 + index * 12;
        let tag = read_u16(bytes, at, endian)?;
        ensure!(seen.insert(tag), "dcp_duplicate_tag_{tag}");
        let kind = read_u16(bytes, at + 2, endian)?;
        let count = usize::try_from(read_u32(bytes, at + 4, endian)?)
            .context("dcp_value_count_overflow")?;
        let unit = type_width(kind).ok_or_else(|| anyhow!("dcp_unsupported_tiff_type_{kind}"))?;
        let byte_len = count
            .checked_mul(unit)
            .ok_or_else(|| anyhow!("dcp_value_size_overflow"))?;
        ensure!(
            byte_len <= limits.max_file_bytes,
            "dcp_value_size_out_of_bounds"
        );
        let start = if byte_len <= 4 {
            at + 8
        } else {
            usize::try_from(read_u32(bytes, at + 8, endian)?)
                .context("dcp_value_offset_overflow")?
        };
        ensure!(
            byte_len <= 4 || start >= table_end,
            "dcp_value_overlaps_ifd"
        );
        let end = start
            .checked_add(byte_len)
            .ok_or_else(|| anyhow!("dcp_value_range_overflow"))?;
        ensure!(end <= bytes.len(), "dcp_value_range_out_of_bounds");
        fields.push(Field {
            tag,
            kind,
            count,
            bytes: &bytes[start..end],
        });
    }
    let field = |tag| fields.iter().find(|candidate| candidate.tag == tag);
    ensure!(
        fields
            .iter()
            .all(|candidate| !EXECUTION_UNSUPPORTED_TAGS.contains(&candidate.tag)),
        "dcp_render_authoritative_tag_unsupported"
    );
    let dims = parse_dims(field(TAG_HUE_SAT_DIMS), endian, limits)?;
    let look_dims = parse_dims(field(TAG_LOOK_DIMS), endian, limits)?;
    let hue_encoding = parse_encoding(field(TAG_HUE_SAT_ENCODING), endian)?;
    let look_encoding = parse_encoding(field(TAG_LOOK_ENCODING), endian)?;
    let profile = DcpProfileV1 {
        name: parse_ascii(field(TAG_PROFILE_NAME), limits)?
            .unwrap_or_else(|| "Unnamed DCP".to_string()),
        camera_model: parse_ascii(field(TAG_UNIQUE_CAMERA_MODEL), limits)?,
        calibration_illuminants: [
            parse_scalar_u16(field(TAG_CALIBRATION_ILLUMINANT_1), endian)?,
            parse_scalar_u16(field(TAG_CALIBRATION_ILLUMINANT_2), endian)?,
        ],
        color_matrices: [
            parse_matrix(field(TAG_COLOR_MATRIX_1), endian)?,
            parse_matrix(field(TAG_COLOR_MATRIX_2), endian)?,
        ],
        camera_calibrations: [
            parse_matrix(field(TAG_CAMERA_CALIBRATION_1), endian)?,
            parse_matrix(field(TAG_CAMERA_CALIBRATION_2), endian)?,
        ],
        reduction_matrices: [
            parse_matrix(field(TAG_REDUCTION_MATRIX_1), endian)?,
            parse_matrix(field(TAG_REDUCTION_MATRIX_2), endian)?,
        ],
        analog_balance: parse_vector3(field(TAG_ANALOG_BALANCE), endian)?.unwrap_or([1.0; 3]),
        forward_matrices: [
            parse_matrix(field(TAG_FORWARD_MATRIX_1), endian)?,
            parse_matrix(field(TAG_FORWARD_MATRIX_2), endian)?,
        ],
        hue_sat_maps: [
            parse_table(
                field(TAG_HUE_SAT_DATA_1),
                dims,
                hue_encoding,
                endian,
                limits,
            )?,
            parse_table(
                field(TAG_HUE_SAT_DATA_2),
                dims,
                hue_encoding,
                endian,
                limits,
            )?,
        ],
        look_table: parse_table(
            field(TAG_LOOK_DATA),
            look_dims,
            look_encoding,
            endian,
            limits,
        )?,
        tone_curve: parse_tone_curve(field(TAG_TONE_CURVE), endian, limits)?,
        baseline_exposure_ev: parse_scalar_f32(field(TAG_BASELINE_EXPOSURE), endian)?
            .unwrap_or(0.0)
            + parse_scalar_f32(field(TAG_BASELINE_EXPOSURE_OFFSET), endian)?.unwrap_or(0.0),
        default_black_render: parse_scalar_u32(field(TAG_DEFAULT_BLACK_RENDER), endian)?,
        calibration_signature: parse_ascii(field(TAG_PROFILE_CALIBRATION_SIGNATURE), limits)?,
        copyright: parse_ascii(field(TAG_PROFILE_COPYRIGHT), limits)?,
        embed_policy: parse_scalar_u32(field(TAG_EMBED_POLICY), endian)?,
        content_sha256: format!("sha256:{}", hex::encode(Sha256::digest(bytes))),
        unsupported_tag_ids: fields
            .iter()
            .filter(|candidate| candidate.tag >= 50_000 && !SUPPORTED_TAGS.contains(&candidate.tag))
            .map(|candidate| candidate.tag)
            .collect(),
    };
    ensure!(
        profile.color_matrices[0].is_some(),
        "dcp_missing_primary_color_matrix"
    );
    ensure!(
        dims.is_none() || profile.hue_sat_maps.iter().any(Option::is_some),
        "dcp_table_dimensions_without_data"
    );
    ensure!(
        look_dims.is_none() || profile.look_table.is_some(),
        "dcp_look_dimensions_without_data"
    );
    ensure!(
        profile
            .calibration_illuminants
            .iter()
            .flatten()
            .all(|value| *value <= 24),
        "dcp_unsupported_calibration_illuminant"
    );
    ensure!(
        profile.embed_policy.is_none_or(|value| value <= 3),
        "dcp_embed_policy_out_of_bounds"
    );
    ensure!(
        profile.default_black_render.is_none_or(|value| value <= 1),
        "dcp_default_black_render_out_of_bounds"
    );
    ensure!(
        profile.baseline_exposure_ev.is_finite() && profile.baseline_exposure_ev.abs() <= 16.0,
        "dcp_baseline_exposure_out_of_bounds"
    );
    Ok(profile)
}

fn parse_ascii(field: Option<&Field<'_>>, limits: DcpParseLimits) -> Result<Option<String>> {
    let Some(field) = field else { return Ok(None) };
    ensure!(
        field.kind == 2 && field.count <= limits.max_string_bytes,
        "dcp_invalid_ascii"
    );
    let value = field.bytes.strip_suffix(&[0]).unwrap_or(field.bytes);
    ensure!(!value.contains(&0), "dcp_embedded_nul");
    ensure!(value.iter().all(u8::is_ascii), "dcp_non_ascii_text");
    let text = std::str::from_utf8(value)
        .context("dcp_non_utf8_ascii")?
        .trim();
    ensure!(!text.is_empty(), "dcp_empty_ascii");
    Ok(Some(text.to_string()))
}

fn parse_dims(
    field: Option<&Field<'_>>,
    endian: Endian,
    limits: DcpParseLimits,
) -> Result<Option<[usize; 3]>> {
    let Some(field) = field else { return Ok(None) };
    ensure!(field.count == 3, "dcp_invalid_table_dimensions");
    let mut dims = [0; 3];
    for (index, value) in dims.iter_mut().enumerate() {
        *value = usize::try_from(read_numeric_u32(field, index, endian)?)
            .context("dcp_dimension_overflow")?;
    }
    ensure!(
        dims[0] >= 1 && dims[1] >= 2 && dims[2] >= 1,
        "dcp_degenerate_table_dimensions"
    );
    let count = dims
        .into_iter()
        .try_fold(1usize, |total, value| total.checked_mul(value))
        .ok_or_else(|| anyhow!("dcp_table_dimension_overflow"))?;
    ensure!(count <= limits.max_table_entries, "dcp_table_too_large");
    Ok(Some(dims))
}

fn parse_table(
    field: Option<&Field<'_>>,
    dims: Option<[usize; 3]>,
    encoding: ProfileTableEncoding,
    endian: Endian,
    limits: DcpParseLimits,
) -> Result<Option<ProfileTable>> {
    let Some(field) = field else {
        return Ok(None);
    };
    let dims = dims.ok_or_else(|| anyhow!("dcp_table_data_without_dimensions"))?;
    let count = dims.into_iter().product::<usize>();
    ensure!(
        count <= limits.max_table_entries && field.count == count * 3,
        "dcp_table_value_count_mismatch"
    );
    let mut entries = Vec::with_capacity(count);
    for index in 0..count {
        let delta = HsvDelta {
            hue_shift_degrees: read_numeric_f32(field, index * 3, endian)?,
            saturation_scale: read_numeric_f32(field, index * 3 + 1, endian)?,
            value_scale: read_numeric_f32(field, index * 3 + 2, endian)?,
        };
        ensure!(
            delta.hue_shift_degrees.is_finite()
                && delta.hue_shift_degrees.abs() <= 180.0
                && delta.saturation_scale.is_finite()
                && (0.0..=8.0).contains(&delta.saturation_scale)
                && delta.value_scale.is_finite()
                && (0.0..=8.0).contains(&delta.value_scale),
            "dcp_table_value_out_of_bounds"
        );
        entries.push(delta);
    }
    let saturation_divisions = dims[1];
    ensure!(
        entries
            .iter()
            .enumerate()
            .filter(|(index, _)| index % saturation_divisions == 0)
            .all(|(_, delta)| (delta.value_scale - 1.0).abs() <= f32::EPSILON),
        "dcp_zero_saturation_value_scale_not_identity"
    );
    Ok(Some(ProfileTable {
        dimensions: dims,
        encoding,
        entries,
    }))
}

fn parse_matrix(field: Option<&Field<'_>>, endian: Endian) -> Result<Option<[[f64; 3]; 3]>> {
    let Some(field) = field else { return Ok(None) };
    ensure!(field.count == 9, "dcp_matrix_value_count_mismatch");
    let mut matrix = [[0.0; 3]; 3];
    for index in 0..9 {
        let value = read_numeric_f64(field, index, endian)?;
        ensure!(
            value.is_finite() && value.abs() <= 32.0,
            "dcp_matrix_value_out_of_bounds"
        );
        matrix[index / 3][index % 3] = value;
    }
    Ok(Some(matrix))
}

fn parse_vector3(field: Option<&Field<'_>>, endian: Endian) -> Result<Option<[f64; 3]>> {
    let Some(field) = field else { return Ok(None) };
    ensure!(field.count == 3, "dcp_vector3_value_count_mismatch");
    let vector = [
        read_numeric_f64(field, 0, endian)?,
        read_numeric_f64(field, 1, endian)?,
        read_numeric_f64(field, 2, endian)?,
    ];
    ensure!(
        vector
            .into_iter()
            .all(|value| value.is_finite() && value > 0.0 && value <= 32.0),
        "dcp_vector3_value_out_of_bounds"
    );
    Ok(Some(vector))
}

fn parse_tone_curve(
    field: Option<&Field<'_>>,
    endian: Endian,
    limits: DcpParseLimits,
) -> Result<Vec<ToneCurvePoint>> {
    let Some(field) = field else {
        return Ok(Vec::new());
    };
    ensure!(
        field.count >= 4 && field.count % 2 == 0 && field.count / 2 <= limits.max_table_entries,
        "dcp_invalid_tone_curve_count"
    );
    let mut points = Vec::with_capacity(field.count / 2);
    for index in 0..field.count / 2 {
        let point = ToneCurvePoint {
            input: read_numeric_f32(field, index * 2, endian)?,
            output: read_numeric_f32(field, index * 2 + 1, endian)?,
        };
        ensure!(
            point.input.is_finite()
                && point.output.is_finite()
                && (0.0..=1.0).contains(&point.input)
                && (0.0..=1.0).contains(&point.output),
            "dcp_tone_curve_out_of_bounds"
        );
        ensure!(
            points
                .last()
                .is_none_or(|previous: &ToneCurvePoint| point.input > previous.input),
            "dcp_tone_curve_not_strictly_increasing"
        );
        points.push(point);
    }
    let first = points.first().expect("minimum count checked");
    let last = points.last().expect("minimum count checked");
    ensure!(
        first.input == 0.0 && first.output == 0.0 && last.input == 1.0 && last.output == 1.0,
        "dcp_sdr_tone_curve_endpoints_invalid"
    );
    Ok(points)
}

fn parse_encoding(field: Option<&Field<'_>>, endian: Endian) -> Result<ProfileTableEncoding> {
    match parse_scalar_u32(field, endian)?.unwrap_or(0) {
        0 => Ok(ProfileTableEncoding::Linear),
        1 => Ok(ProfileTableEncoding::Srgb),
        _ => Err(anyhow!("dcp_unknown_table_encoding")),
    }
}
fn parse_scalar_u16(field: Option<&Field<'_>>, endian: Endian) -> Result<Option<u16>> {
    let Some(field) = field else { return Ok(None) };
    ensure!(field.count == 1, "dcp_invalid_scalar_count");
    Ok(Some(
        u16::try_from(read_numeric_u32(field, 0, endian)?).context("dcp_scalar_u16_overflow")?,
    ))
}
fn parse_scalar_u32(field: Option<&Field<'_>>, endian: Endian) -> Result<Option<u32>> {
    let Some(field) = field else { return Ok(None) };
    ensure!(field.count == 1, "dcp_invalid_scalar_count");
    Ok(Some(read_numeric_u32(field, 0, endian)?))
}
fn parse_scalar_f32(field: Option<&Field<'_>>, endian: Endian) -> Result<Option<f32>> {
    let Some(field) = field else { return Ok(None) };
    ensure!(field.count == 1, "dcp_invalid_scalar_count");
    Ok(Some(read_numeric_f32(field, 0, endian)?))
}

fn read_numeric_u32(field: &Field<'_>, index: usize, endian: Endian) -> Result<u32> {
    match field.kind {
        1 => field
            .bytes
            .get(index)
            .copied()
            .map(u32::from)
            .ok_or_else(|| anyhow!("dcp_numeric_index_out_of_bounds")),
        3 => read_u16(field.bytes, index * 2, endian).map(u32::from),
        4 => read_u32(field.bytes, index * 4, endian),
        _ => Err(anyhow!("dcp_numeric_type_mismatch")),
    }
}
fn read_numeric_f32(field: &Field<'_>, index: usize, endian: Endian) -> Result<f32> {
    let value = read_numeric_f64(field, index, endian)? as f32;
    ensure!(value.is_finite(), "dcp_non_finite_numeric_value");
    Ok(value)
}
fn read_numeric_f64(field: &Field<'_>, index: usize, endian: Endian) -> Result<f64> {
    let value = match field.kind {
        3 | 4 | 1 => f64::from(read_numeric_u32(field, index, endian)?),
        5 => {
            let at = index * 8;
            let n = read_u32(field.bytes, at, endian)?;
            let d = read_u32(field.bytes, at + 4, endian)?;
            ensure!(d != 0, "dcp_zero_rational_denominator");
            f64::from(n) / f64::from(d)
        }
        10 => {
            let at = index * 8;
            let n = read_i32(field.bytes, at, endian)?;
            let d = read_i32(field.bytes, at + 4, endian)?;
            ensure!(d != 0, "dcp_zero_rational_denominator");
            f64::from(n) / f64::from(d)
        }
        11 => f64::from(f32::from_bits(read_u32(field.bytes, index * 4, endian)?)),
        12 => read_f64(field.bytes, index * 8, endian)?,
        _ => return Err(anyhow!("dcp_numeric_type_mismatch")),
    };
    ensure!(value.is_finite(), "dcp_non_finite_numeric_value");
    Ok(value)
}
fn type_width(kind: u16) -> Option<usize> {
    match kind {
        1 | 2 | 6 | 7 => Some(1),
        3 | 8 => Some(2),
        4 | 9 | 11 => Some(4),
        5 | 10 | 12 => Some(8),
        _ => None,
    }
}
fn read_u16(bytes: &[u8], at: usize, endian: Endian) -> Result<u16> {
    let value: [u8; 2] = bytes
        .get(at..at + 2)
        .ok_or_else(|| anyhow!("dcp_read_out_of_bounds"))?
        .try_into()
        .expect("slice length");
    Ok(match endian {
        Endian::Little => u16::from_le_bytes(value),
        Endian::Big => u16::from_be_bytes(value),
    })
}
fn read_u32(bytes: &[u8], at: usize, endian: Endian) -> Result<u32> {
    let value: [u8; 4] = bytes
        .get(at..at + 4)
        .ok_or_else(|| anyhow!("dcp_read_out_of_bounds"))?
        .try_into()
        .expect("slice length");
    Ok(match endian {
        Endian::Little => u32::from_le_bytes(value),
        Endian::Big => u32::from_be_bytes(value),
    })
}
fn read_i32(bytes: &[u8], at: usize, endian: Endian) -> Result<i32> {
    Ok(read_u32(bytes, at, endian)? as i32)
}
fn read_f64(bytes: &[u8], at: usize, endian: Endian) -> Result<f64> {
    let value: [u8; 8] = bytes
        .get(at..at + 8)
        .ok_or_else(|| anyhow!("dcp_read_out_of_bounds"))?
        .try_into()
        .expect("slice length");
    Ok(match endian {
        Endian::Little => f64::from_le_bytes(value),
        Endian::Big => f64::from_be_bytes(value),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture(entries: &[(u16, u16, Vec<u8>)]) -> Vec<u8> {
        let mut bytes = vec![b'I', b'I', 42, 0, 8, 0, 0, 0];
        bytes.extend_from_slice(&(entries.len() as u16).to_le_bytes());
        let data_start = 8 + 2 + entries.len() * 12 + 4;
        let mut data = Vec::new();
        for (tag, kind, value) in entries {
            bytes.extend_from_slice(&tag.to_le_bytes());
            bytes.extend_from_slice(&kind.to_le_bytes());
            let width = type_width(*kind).unwrap();
            bytes.extend_from_slice(&u32::try_from(value.len() / width).unwrap().to_le_bytes());
            if value.len() <= 4 {
                let mut inline = [0; 4];
                inline[..value.len()].copy_from_slice(value);
                bytes.extend_from_slice(&inline);
            } else {
                bytes.extend_from_slice(&((data_start + data.len()) as u32).to_le_bytes());
                data.extend_from_slice(value);
            }
        }
        bytes.extend_from_slice(&[0; 4]);
        bytes.extend_from_slice(&data);
        bytes
    }
    fn floats(values: &[f32]) -> Vec<u8> {
        values
            .iter()
            .flat_map(|value| value.to_le_bytes())
            .collect()
    }
    fn matrix() -> Vec<u8> {
        floats(&[1.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0])
    }

    #[test]
    fn parses_bounded_profile_and_hashes_identity() {
        let table_values = [0.0, 1.0, 1.0, 0.0, 1.0, 1.0, 0.0, 1.0, 1.0, 0.0, 1.0, 1.0];
        let bytes = fixture(&[
            (TAG_PROFILE_NAME, 2, b"Test Profile\0".to_vec()),
            (TAG_UNIQUE_CAMERA_MODEL, 2, b"SONY ILCE-7RM4\0".to_vec()),
            (TAG_COLOR_MATRIX_1, 11, matrix()),
            (
                TAG_HUE_SAT_DIMS,
                4,
                [2u32, 2, 1]
                    .into_iter()
                    .flat_map(u32::to_le_bytes)
                    .collect(),
            ),
            (TAG_HUE_SAT_DATA_1, 11, floats(&table_values)),
        ]);
        let profile = parse_dcp(&bytes, DcpParseLimits::default()).unwrap();
        assert_eq!(profile.name, "Test Profile");
        assert_eq!(profile.camera_model.as_deref(), Some("SONY ILCE-7RM4"));
        assert_eq!(profile.hue_sat_maps[0].as_ref().unwrap().entries.len(), 4);
        assert!(profile.content_sha256.starts_with("sha256:"));
    }

    #[test]
    fn rejects_oversized_counts_offsets_duplicates_and_nan() {
        let mut oversized = fixture(&[(TAG_COLOR_MATRIX_1, 11, matrix())]);
        oversized[8..10].copy_from_slice(&513u16.to_le_bytes());
        assert!(parse_dcp(&oversized, DcpParseLimits::default()).is_err());
        let duplicate = fixture(&[
            (TAG_COLOR_MATRIX_1, 11, matrix()),
            (TAG_COLOR_MATRIX_1, 11, matrix()),
        ]);
        assert!(
            parse_dcp(&duplicate, DcpParseLimits::default())
                .unwrap_err()
                .to_string()
                .contains("duplicate")
        );
        let invalid_offset = {
            let mut value = fixture(&[(TAG_COLOR_MATRIX_1, 11, matrix())]);
            value[18..22].copy_from_slice(&u32::MAX.to_le_bytes());
            value
        };
        assert!(parse_dcp(&invalid_offset, DcpParseLimits::default()).is_err());
        let nan = fixture(&[(TAG_COLOR_MATRIX_1, 11, floats(&[f32::NAN; 9]))]);
        assert!(
            parse_dcp(&nan, DcpParseLimits::default())
                .unwrap_err()
                .to_string()
                .contains("non_finite")
        );
    }

    #[test]
    fn rejects_non_identity_neutral_axis_and_invalid_sdr_curve_endpoints() {
        let invalid_neutral_table = fixture(&[
            (TAG_COLOR_MATRIX_1, 11, matrix()),
            (
                TAG_HUE_SAT_DIMS,
                4,
                [1u32, 2, 1]
                    .into_iter()
                    .flat_map(u32::to_le_bytes)
                    .collect(),
            ),
            (
                TAG_HUE_SAT_DATA_1,
                11,
                floats(&[0.0, 1.0, 0.5, 0.0, 1.0, 1.0]),
            ),
        ]);
        assert!(
            parse_dcp(&invalid_neutral_table, DcpParseLimits::default())
                .unwrap_err()
                .to_string()
                .contains("zero_saturation")
        );

        let invalid_curve = fixture(&[
            (TAG_COLOR_MATRIX_1, 11, matrix()),
            (TAG_TONE_CURVE, 11, floats(&[0.0, 0.0, 0.5, 0.4, 1.0, 0.9])),
        ]);
        assert!(
            parse_dcp(&invalid_curve, DcpParseLimits::default())
                .unwrap_err()
                .to_string()
                .contains("tone_curve_endpoints")
        );

        let hdr_profile = fixture(&[
            (TAG_COLOR_MATRIX_1, 11, matrix()),
            (52_551, 7, vec![1, 0, 1, 0, 0, 0, 128, 64]),
        ]);
        assert!(
            parse_dcp(&hdr_profile, DcpParseLimits::default())
                .unwrap_err()
                .to_string()
                .contains("render_authoritative_tag_unsupported")
        );
    }

    #[test]
    fn arbitrary_bounded_bytes_never_panic() {
        for length in 0..512 {
            let bytes: Vec<u8> = (0..length)
                .map(|index| (index as u8).wrapping_mul(73).wrapping_add(length as u8))
                .collect();
            assert!(
                std::panic::catch_unwind(|| parse_dcp(&bytes, DcpParseLimits::default())).is_ok()
            );
        }
    }
}
