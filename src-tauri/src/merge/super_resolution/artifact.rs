use std::{fs, io::Cursor, path::Path};

use image::{DynamicImage, ImageFormat, Rgb, Rgb32FImage};
use serde::Deserialize;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Manifest {
    accepted_review: AcceptedReview,
    inventory: Inventory,
}

#[derive(Deserialize)]
struct AcceptedReview {
    width: u32,
    height: u32,
}

#[derive(Deserialize)]
struct Inventory {
    tiles: Vec<Tile>,
}

#[derive(Deserialize)]
struct Tile {
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
    let manifest: Manifest = serde_json::from_slice(
        &fs::read(candidate.join("manifest.json"))
            .map_err(|error| format!("invalid_candidate_manifest_missing:{error}"))?,
    )
    .map_err(|error| format!("invalid_candidate_manifest:{error}"))?;
    let mut image = Rgb32FImage::new(
        manifest.accepted_review.width,
        manifest.accepted_review.height,
    );
    let mut rgb_tiles = Vec::with_capacity(manifest.inventory.tiles.len());
    let mut map_tiles = Vec::with_capacity(manifest.inventory.tiles.len());
    for tile in manifest.inventory.tiles {
        let name = format!("{:08}.bin", tile.index);
        let rgb = fs::read(candidate.join("rgb").join(&name))
            .map_err(|error| format!("invalid_candidate_rgb_tile:{error}"))?;
        let maps = fs::read(candidate.join("maps").join(&name))
            .map_err(|error| format!("invalid_candidate_map_tile:{error}"))?;
        if rgb.len() != tile.width as usize * tile.height as usize * 12
            || maps.len() != tile.width as usize * tile.height as usize * 68
        {
            return Err("invalid_candidate_tile_length".into());
        }
        for row in 0..tile.height {
            for column in 0..tile.width {
                let offset = ((row * tile.width + column) * 12) as usize;
                let channel = |at| f32::from_le_bytes(rgb[at..at + 4].try_into().unwrap());
                image.put_pixel(
                    tile.x as u32 + column,
                    tile.y as u32 + row,
                    Rgb([channel(offset), channel(offset + 4), channel(offset + 8)]),
                );
            }
        }
        rgb_tiles.push((format!("tiles/rgb/{name}"), rgb));
        map_tiles.push((format!("maps/measured/{name}"), maps));
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
        .map_err(|error| format!("sr_artifact_encode_failed:{error}"))?;
    Ok(bytes.into_inner())
}

#[cfg(test)]
mod tests {
    use super::*;
    use image::GenericImageView;
    use serde_json::json;

    #[test]
    fn committed_payload_is_assembled_from_float_tiles_and_retains_maps() {
        let root = tempfile::tempdir().unwrap();
        fs::create_dir(root.path().join("rgb")).unwrap();
        fs::create_dir(root.path().join("maps")).unwrap();
        let mut rgb = Vec::new();
        for value in [0.25_f32, 0.5, 1.0, 0.75, 0.125, 0.0] {
            rgb.extend_from_slice(&value.to_le_bytes());
        }
        let maps = vec![7_u8; 2 * 68];
        fs::write(root.path().join("rgb/00000000.bin"), &rgb).unwrap();
        fs::write(root.path().join("maps/00000000.bin"), &maps).unwrap();
        fs::write(
            root.path().join("manifest.json"),
            serde_json::to_vec(&json!({
                "acceptedReview": {"width": 2, "height": 1},
                "inventory": {"tiles": [{"index": 0, "x": 0, "y": 0, "width": 2, "height": 1}]}
            }))
            .unwrap(),
        )
        .unwrap();

        let artifact = build(root.path()).unwrap();
        assert_eq!(artifact.rgb_tiles[0].1, rgb);
        assert_eq!(artifact.map_tiles[0].1, maps);
        assert_eq!(
            image::load_from_memory(&artifact.tiff)
                .unwrap()
                .dimensions(),
            (2, 1)
        );
    }
}
