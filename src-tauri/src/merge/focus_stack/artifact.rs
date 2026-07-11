use std::{fs, io::Cursor, path::Path};

use image::{DynamicImage, ImageFormat, Rgb, Rgb32FImage};
use serde::Deserialize;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CandidateManifest {
    accepted_plan: AcceptedPlan,
    inventory: CandidateInventory,
}

#[derive(Debug, Deserialize)]
struct AcceptedPlan {
    width: u32,
    height: u32,
}

#[derive(Debug, Deserialize)]
struct CandidateInventory {
    tiles: Vec<CandidateTile>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CandidateTile {
    index: u64,
    x: u64,
    y: u64,
    width: u32,
    height: u32,
}

pub(crate) struct DurableArtifact {
    pub tiff: Vec<u8>,
    pub preview: Vec<u8>,
    pub rgb_tiles: Vec<(String, Vec<u8>)>,
    pub map_tiles: Vec<(String, Vec<u8>)>,
}

pub(crate) fn build(candidate: &Path) -> Result<DurableArtifact, String> {
    let manifest: CandidateManifest = serde_json::from_slice(
        &fs::read(candidate.join("manifest.json"))
            .map_err(|error| format!("invalid_candidate_manifest_missing:{error}"))?,
    )
    .map_err(|error| format!("invalid_candidate_manifest:{error}"))?;
    let mut image = Rgb32FImage::new(manifest.accepted_plan.width, manifest.accepted_plan.height);
    let mut rgb_tiles = Vec::with_capacity(manifest.inventory.tiles.len());
    let mut map_tiles = Vec::with_capacity(manifest.inventory.tiles.len());
    for tile in manifest.inventory.tiles {
        let name = format!("{:08}.bin", tile.index);
        let rgb = fs::read(candidate.join("rgb").join(&name))
            .map_err(|error| format!("invalid_candidate_rgb_tile:{error}"))?;
        let expected = tile.width as usize * tile.height as usize * 12;
        if rgb.len() != expected {
            return Err("invalid_candidate_rgb_tile_length".into());
        }
        let map = fs::read(candidate.join("maps").join(&name))
            .map_err(|error| format!("invalid_candidate_map_tile:{error}"))?;
        if map.len() != tile.width as usize * tile.height as usize * 16 {
            return Err("invalid_candidate_map_tile_length".into());
        }
        for row in 0..tile.height {
            for column in 0..tile.width {
                let offset = ((row * tile.width + column) * 12) as usize;
                let channel = |index| {
                    f32::from_le_bytes(rgb[offset + index..offset + index + 4].try_into().unwrap())
                };
                image.put_pixel(
                    tile.x as u32 + column,
                    tile.y as u32 + row,
                    Rgb([channel(0), channel(4), channel(8)]),
                );
            }
        }
        rgb_tiles.push((format!("tiles/rgb/{name}"), rgb));
        map_tiles.push((format!("maps/{name}"), map));
    }
    Ok(DurableArtifact {
        tiff: encode(
            DynamicImage::ImageRgb32F(image.clone()).to_rgb16(),
            ImageFormat::Tiff,
        )?,
        preview: encode(DynamicImage::ImageRgb32F(image).to_rgb8(), ImageFormat::Png)?,
        rgb_tiles,
        map_tiles,
    })
}

fn encode(image: impl Into<DynamicImage>, format: ImageFormat) -> Result<Vec<u8>, String> {
    let mut bytes = Cursor::new(Vec::new());
    image
        .into()
        .write_to(&mut bytes, format)
        .map_err(|error| format!("focus_artifact_encode_failed:{error}"))?;
    Ok(bytes.into_inner())
}
