use std::{fs, path::Path};

use serde::{Deserialize, Serialize};

use super::raw_frame::{
    CalibratedBayerSensor, GreenPhaseProxy, SuperResolutionBayerBurstSource,
    SuperResolutionRawFrame,
};

const FORMAT_ID: &str = "rapidraw_sr_calibrated_cfa_v1";
pub(crate) const CACHE_TILE: usize = 512;

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct CfaCacheIndex {
    format_id: String,
    pub source: SuperResolutionBayerBurstSource,
    pub proxy: GreenPhaseProxy,
    pub tiles: Vec<CfaCacheTile>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct CfaCacheTile {
    pub index: u64,
    pub x: usize,
    pub y: usize,
    pub width: usize,
    pub height: usize,
    pub hash: String,
}

fn hash(bytes: &[u8]) -> String {
    format!("blake3:{}", blake3::hash(bytes).to_hex())
}

pub(crate) fn write(root: &Path, frame: SuperResolutionRawFrame) -> Result<CfaCacheIndex, String> {
    let source_root = root.join(format!("source-{:02}", frame.source.source_index));
    fs::create_dir_all(&source_root).map_err(|e| format!("sr_cfa_cache_create_failed:{e}"))?;
    let mut tiles = Vec::new();
    let mut index = 0;
    for y in (0..frame.sensor.height).step_by(CACHE_TILE) {
        for x in (0..frame.sensor.width).step_by(CACHE_TILE) {
            let width = CACHE_TILE.min(frame.sensor.width - x);
            let height = CACHE_TILE.min(frame.sensor.height - y);
            let mut bytes = Vec::with_capacity(width * height * 10);
            for py in y..y + height {
                for px in x..x + width {
                    let at = py * frame.sensor.width + px;
                    bytes.push(match frame.sensor.classes[at] {
                        super::raw_frame::CfaClass::R => 0,
                        super::raw_frame::CfaClass::G1 => 1,
                        super::raw_frame::CfaClass::G2 => 2,
                        super::raw_frame::CfaClass::B => 3,
                    });
                    bytes.push(u8::from(frame.sensor.valid[at]));
                    bytes.extend_from_slice(&frame.sensor.values[at].to_le_bytes());
                    bytes.extend_from_slice(&frame.sensor.variances[at].to_le_bytes());
                }
            }
            let name = format!("{index:08}.bin");
            fs::write(source_root.join(name), &bytes)
                .map_err(|e| format!("sr_cfa_cache_write_failed:{e}"))?;
            tiles.push(CfaCacheTile {
                index,
                x,
                y,
                width,
                height,
                hash: hash(&bytes),
            });
            index += 1;
        }
    }
    let cache = CfaCacheIndex {
        format_id: FORMAT_ID.into(),
        source: frame.source,
        proxy: frame.proxy,
        tiles,
    };
    let bytes =
        serde_json::to_vec_pretty(&cache).map_err(|e| format!("sr_cfa_cache_index_failed:{e}"))?;
    fs::write(source_root.join("index.json"), bytes)
        .map_err(|e| format!("sr_cfa_cache_index_failed:{e}"))?;
    validate(root, &cache)?;
    Ok(cache)
}

pub(crate) fn read_frame(
    root: &Path,
    cache: &CfaCacheIndex,
) -> Result<SuperResolutionRawFrame, String> {
    validate(root, cache)?;
    let width = cache.source.width as usize;
    let height = cache.source.height as usize;
    let mut sensor = CalibratedBayerSensor {
        classes: vec![super::raw_frame::CfaClass::R; width * height],
        height,
        valid: vec![false; width * height],
        values: vec![0.0; width * height],
        variances: vec![0.0; width * height],
        width,
    };
    let source_root = root.join(format!("source-{:02}", cache.source.source_index));
    for tile in &cache.tiles {
        let bytes = fs::read(source_root.join(format!("{:08}.bin", tile.index)))
            .map_err(|e| format!("sr_cfa_cache_read_failed:{e}"))?;
        for local in 0..tile.width * tile.height {
            let offset = local * 10;
            let x = tile.x + local % tile.width;
            let y = tile.y + local / tile.width;
            let at = y * width + x;
            sensor.classes[at] = match bytes[offset] {
                0 => super::raw_frame::CfaClass::R,
                1 => super::raw_frame::CfaClass::G1,
                2 => super::raw_frame::CfaClass::G2,
                3 => super::raw_frame::CfaClass::B,
                _ => return Err("sr_cfa_cache_class_invalid".into()),
            };
            sensor.valid[at] = bytes[offset + 1] != 0;
            sensor.values[at] =
                f32::from_le_bytes(bytes[offset + 2..offset + 6].try_into().unwrap());
            sensor.variances[at] =
                f32::from_le_bytes(bytes[offset + 6..offset + 10].try_into().unwrap());
        }
    }
    Ok(SuperResolutionRawFrame {
        sensor,
        proxy: cache.proxy.clone(),
        source: cache.source.clone(),
    })
}

pub(crate) fn validate(root: &Path, cache: &CfaCacheIndex) -> Result<(), String> {
    if cache.format_id != FORMAT_ID {
        return Err("sr_cfa_cache_format_invalid".into());
    }
    let source_root = root.join(format!("source-{:02}", cache.source.source_index));
    for tile in &cache.tiles {
        let bytes = fs::read(source_root.join(format!("{:08}.bin", tile.index)))
            .map_err(|e| format!("sr_cfa_cache_tile_missing:{e}"))?;
        if hash(&bytes) != tile.hash || bytes.len() != tile.width * tile.height * 10 {
            return Err("sr_cfa_cache_tile_invalid".into());
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::merge::super_resolution::raw_frame::{CfaClass, SuperResolutionBayerCalibration};

    fn frame() -> SuperResolutionRawFrame {
        let width = CACHE_TILE + 7;
        let height = CACHE_TILE + 5;
        let count = width * height;
        SuperResolutionRawFrame {
            sensor: CalibratedBayerSensor {
                classes: (0..count)
                    .map(|index| [CfaClass::R, CfaClass::G1, CfaClass::G2, CfaClass::B][index % 4])
                    .collect(),
                height,
                valid: vec![true; count],
                values: (0..count)
                    .map(|index| index as f32 / count as f32)
                    .collect(),
                variances: vec![0.0001; count],
                width,
            },
            proxy: GreenPhaseProxy {
                clipped_ratio: 0.0,
                height: 2,
                proxy_pixel_scale: 256.0,
                quality_score: 1.0,
                valid: vec![true; 4],
                values: vec![0.1, 0.2, 0.3, 0.4],
                width: 2,
            },
            source: SuperResolutionBayerBurstSource {
                block_codes: vec![],
                calibration: SuperResolutionBayerCalibration {
                    bayer_pattern: "RGGB".into(),
                    black_level: vec![0.0; 4],
                    black_level_repeat: [2, 2, 1],
                    bits_per_sample: 14,
                    white_balance: [1.0; 4],
                    white_level: vec![16383; 4],
                },
                calibration_identity: "blake3:calibration".into(),
                camera_make: "fixture".into(),
                camera_model: "fixture".into(),
                content_hash: "blake3:source".into(),
                graph_revision: "revision".into(),
                height: height as u32,
                path: "fixture.raw".into(),
                source_index: 0,
                width: width as u32,
            },
        }
    }

    #[test]
    fn multi_tile_cache_round_trips_and_detects_corruption() {
        let root = tempfile::tempdir().unwrap();
        let original = frame();
        let cache = write(root.path(), original.clone()).unwrap();
        assert!(cache.tiles.len() > 1);
        let restored = read_frame(root.path(), &cache).unwrap();
        assert_eq!(restored.sensor.values, original.sensor.values);
        assert_eq!(restored.sensor.classes, original.sensor.classes);
        let tile = root.path().join("source-00/00000000.bin");
        let mut bytes = fs::read(&tile).unwrap();
        bytes[2] ^= 1;
        fs::write(tile, bytes).unwrap();
        assert_eq!(
            validate(root.path(), &cache).unwrap_err(),
            "sr_cfa_cache_tile_invalid"
        );
    }
}
