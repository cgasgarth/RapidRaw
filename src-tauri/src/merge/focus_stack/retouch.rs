use std::{
    collections::{BTreeMap, BTreeSet},
    fs,
    io::Write,
    path::{Path, PathBuf},
};

use image::{GenericImageView, Rgb32FImage};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use uuid::Uuid;

const FIXED_SCALE: i64 = 256;
const AUTOMATIC_SOURCE: u16 = u16::MAX;

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct FixedPoint {
    pub x: i32,
    pub y: i32,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FocusOverrideStroke {
    pub stroke_id: String,
    pub source_index: Option<u16>,
    pub points_fixed_1_256_px: Vec<FixedPoint>,
    pub radius_fixed_1_256_px: u32,
    pub hardness_u16: u16,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RectU32 {
    pub x: u32,
    pub y: u32,
    pub width: u32,
    pub height: u32,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FocusRetouchRequest {
    pub package_path: String,
    pub expected_revision_id: Option<String>,
    pub stroke: FocusOverrideStroke,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FocusRetouchHistoryRequest {
    pub package_path: String,
    pub direction: String,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FocusRetouchOpenRequest {
    pub package_path: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FocusRetouchRevision {
    pub schema_version: u32,
    pub revision_id: String,
    pub parent_revision_id: Option<String>,
    pub base_focus_artifact_hash: String,
    pub ordered_source_hashes: Vec<String>,
    pub override_map_hash: String,
    pub changed_tile_index_hash: String,
    pub affected_bounds: Vec<RectU32>,
    pub changed_source_indices: Vec<u16>,
    pub skipped_pixel_count: u64,
    pub blend_policy_hash: String,
    pub content_hash: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FocusRetouchSession {
    pub revision: Option<FocusRetouchRevision>,
    pub source_statuses: Vec<String>,
    pub can_undo: bool,
    pub can_redo: bool,
    pub render_status: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct BaseManifest {
    width: u32,
    height: u32,
    source_immutability_hashes: Vec<String>,
}

#[derive(Deserialize)]
struct FocusManifest {
    inventory: Inventory,
    #[serde(rename = "acceptedPlan")]
    accepted_plan: AcceptedPlan,
}
#[derive(Deserialize)]
struct Inventory {
    tiles: Vec<Tile>,
}
#[derive(Deserialize)]
struct AcceptedPlan {
    #[serde(rename = "policyHash")]
    policy_hash: String,
}
#[derive(Clone, Deserialize)]
struct Tile {
    index: u64,
    x: u32,
    y: u32,
    width: u32,
    height: u32,
}

#[tauri::command]
pub fn apply_focus_stack_retouch(
    request: FocusRetouchRequest,
) -> Result<FocusRetouchSession, String> {
    let root = package_root(&request.package_path)?;
    let base = read_base(&root)?;
    validate_stroke(&request.stroke, &base)?;
    let current = read_latest(&root)?;
    if request.expected_revision_id.as_deref() != current.as_ref().map(|r| r.revision_id.as_str()) {
        return Err("stale_focus_retouch_revision".into());
    }
    let statuses = source_statuses(&root, &base)?;
    if let Some(source) = request.stroke.source_index
        && statuses.get(source as usize).map(String::as_str) != Some("current")
    {
        return Err(format!("focus_retouch_source_unavailable:{source}"));
    }
    let revision = publish_stroke(&root, &base, current.as_ref(), &request.stroke)?;
    session(&root, Some(revision), statuses)
}

#[tauri::command]
pub fn open_focus_stack_retouch(
    request: FocusRetouchOpenRequest,
) -> Result<FocusRetouchSession, String> {
    let root = package_root(&request.package_path)?;
    let base = read_base(&root)?;
    let latest = read_latest(&root)?;
    session(&root, latest, source_statuses(&root, &base)?)
}

#[tauri::command]
pub fn navigate_focus_stack_retouch(
    request: FocusRetouchHistoryRequest,
) -> Result<FocusRetouchSession, String> {
    let root = package_root(&request.package_path)?;
    let base = read_base(&root)?;
    let current = read_latest(&root)?;
    let target = match request.direction.as_str() {
        "undo" => current
            .as_ref()
            .ok_or("focus_retouch_history_empty")?
            .parent_revision_id
            .clone(),
        "redo" => find_child(&root, current.as_ref().map(|r| r.revision_id.as_str()))?,
        "reset" => None,
        _ => return Err("invalid_focus_retouch_history_direction".into()),
    };
    write_latest(&root, target.as_deref())?;
    let revision = target
        .as_deref()
        .map(|id| read_revision(&root, id))
        .transpose()?;
    session(&root, revision, source_statuses(&root, &base)?)
}

fn package_root(path: &str) -> Result<PathBuf, String> {
    let path = PathBuf::from(path);
    let root = if path.is_dir() {
        path
    } else {
        path.parent()
            .ok_or("invalid_focus_package_path")?
            .to_path_buf()
    };
    if !root.join("focus-manifest.json").is_file() || !root.join("manifest.json").is_file() {
        return Err("invalid_focus_package_path".into());
    }
    Ok(root)
}

fn read_base(root: &Path) -> Result<BaseManifest, String> {
    serde_json::from_slice(
        &fs::read(root.join("manifest.json")).map_err(io("focus_retouch_base_missing"))?,
    )
    .map_err(|e| format!("focus_retouch_base_invalid:{e}"))
}

fn validate_stroke(stroke: &FocusOverrideStroke, base: &BaseManifest) -> Result<(), String> {
    if stroke.stroke_id.trim().is_empty()
        || stroke.points_fixed_1_256_px.is_empty()
        || stroke.points_fixed_1_256_px.len() > 100_000
        || stroke.radius_fixed_1_256_px == 0
        || stroke.radius_fixed_1_256_px > 4096 * 256
    {
        return Err("invalid_focus_retouch_stroke".into());
    }
    if stroke
        .source_index
        .is_some_and(|v| v as usize >= base.source_immutability_hashes.len())
    {
        return Err("invalid_focus_retouch_source_index".into());
    }
    let margin = i64::from(stroke.radius_fixed_1_256_px);
    let max_x = i64::from(base.width) * FIXED_SCALE + margin;
    let max_y = i64::from(base.height) * FIXED_SCALE + margin;
    if stroke.points_fixed_1_256_px.iter().any(|p| {
        i64::from(p.x) < -margin
            || i64::from(p.y) < -margin
            || i64::from(p.x) > max_x
            || i64::from(p.y) > max_y
    }) {
        return Err("invalid_focus_retouch_coordinates".into());
    }
    Ok(())
}

fn source_statuses(root: &Path, base: &BaseManifest) -> Result<Vec<String>, String> {
    let sidecar: Value = serde_json::from_slice(
        &fs::read(root.join("payload.tiff.rrdata"))
            .map_err(io("focus_retouch_provenance_missing"))?,
    )
    .map_err(|e| format!("focus_retouch_provenance_invalid:{e}"))?;
    let sources = sidecar["sourceState"]
        .as_array()
        .ok_or("focus_retouch_provenance_sources_missing")?;
    Ok(base
        .source_immutability_hashes
        .iter()
        .enumerate()
        .map(|(i, expected)| {
            let Some(path) = sources.get(i).and_then(|s| s["path"].as_str()) else {
                return "missing".into();
            };
            match fs::read(path) {
                Ok(bytes) if hash(&bytes) == *expected => match image::image_dimensions(path) {
                    Ok(dim) if dim == (base.width, base.height) => "current".into(),
                    Ok(_) => "changed".into(),
                    Err(_) => "undecodable".into(),
                },
                Ok(_) => "changed".into(),
                Err(_) => "missing".into(),
            }
        })
        .collect())
}

fn publish_stroke(
    root: &Path,
    base: &BaseManifest,
    parent: Option<&FocusRetouchRevision>,
    stroke: &FocusOverrideStroke,
) -> Result<FocusRetouchRevision, String> {
    let focus: FocusManifest = serde_json::from_slice(
        &fs::read(root.join("focus-manifest.json"))
            .map_err(io("focus_retouch_manifest_missing"))?,
    )
    .map_err(|e| format!("focus_retouch_manifest_invalid:{e}"))?;
    let count = base.width as usize * base.height as usize;
    let mut map = parent
        .map(|r| fs::read(revision_dir(root, &r.revision_id).join("override-map.bin")))
        .transpose()
        .map_err(io("focus_retouch_override_read_failed"))?
        .unwrap_or_else(|| vec![0; count * 4]);
    if map.len() != count * 4 {
        return Err("focus_retouch_override_length_invalid".into());
    }
    let touched = rasterize(stroke, base.width, base.height, &mut map);
    let touched_bounds = bounds(&touched, base.width).into_iter().collect::<Vec<_>>();
    let mut affected_tiles = focus
        .inventory
        .tiles
        .iter()
        .filter(|tile| {
            touched.iter().any(|index| {
                let x = *index as u32 % base.width;
                let y = *index as u32 / base.width;
                x >= tile.x && x < tile.x + tile.width && y >= tile.y && y < tile.y + tile.height
            })
        })
        .cloned()
        .collect::<Vec<_>>();
    affected_tiles.sort_by_key(|t| t.index);
    let sources = load_sources(root, base)?;
    let staging = root
        .join("retouch")
        .join(format!(".staging-{}", Uuid::new_v4()));
    fs::create_dir_all(staging.join("tiles/rgb")).map_err(io("focus_retouch_staging_failed"))?;
    fs::create_dir_all(staging.join("maps")).map_err(io("focus_retouch_staging_failed"))?;
    fs::write(staging.join("override-map.bin"), &map)
        .map_err(io("focus_retouch_override_write_failed"))?;
    let mut skipped = 0u64;
    for tile in &affected_tiles {
        skipped += render_tile(root, &staging, tile, base.width, &map, &sources)?;
    }
    let tile_index = affected_tiles.iter().map(|t| t.index).collect::<Vec<_>>();
    fs::write(
        staging.join("changed-tiles.json"),
        serde_json::to_vec(&tile_index).unwrap(),
    )
    .map_err(io("focus_retouch_index_write_failed"))?;
    let base_hash =
        hash(&fs::read(root.join("payload.tiff")).map_err(io("focus_retouch_payload_missing"))?);
    let map_hash = hash(&map);
    let tile_hash = hash(&serde_json::to_vec(&tile_index).unwrap());
    let content_hash = hash(
        &serde_json::to_vec(&(
            parent.map(|p| &p.revision_id),
            &map_hash,
            &tile_hash,
            &focus.accepted_plan.policy_hash,
        ))
        .unwrap(),
    );
    let revision_id = content_hash.trim_start_matches("blake3:").to_string();
    let revision = FocusRetouchRevision {
        schema_version: 1,
        revision_id: revision_id.clone(),
        parent_revision_id: parent.map(|p| p.revision_id.clone()),
        base_focus_artifact_hash: base_hash,
        ordered_source_hashes: base.source_immutability_hashes.clone(),
        override_map_hash: map_hash,
        changed_tile_index_hash: tile_hash,
        affected_bounds: touched_bounds,
        changed_source_indices: stroke.source_index.into_iter().collect(),
        skipped_pixel_count: skipped,
        blend_policy_hash: focus.accepted_plan.policy_hash,
        content_hash,
    };
    fs::write(
        staging.join("revision.json"),
        serde_json::to_vec_pretty(&revision).unwrap(),
    )
    .map_err(io("focus_retouch_revision_write_failed"))?;
    let final_dir = revision_dir(root, &revision_id);
    fs::create_dir_all(final_dir.parent().unwrap())
        .map_err(io("focus_retouch_revision_root_failed"))?;
    if final_dir.exists() {
        fs::remove_dir_all(&staging).map_err(io("focus_retouch_staging_cleanup_failed"))?;
    } else {
        fs::rename(&staging, &final_dir).map_err(io("focus_retouch_publish_failed"))?;
    }
    write_latest(root, Some(&revision_id))?;
    Ok(revision)
}

fn load_sources(root: &Path, base: &BaseManifest) -> Result<Vec<Rgb32FImage>, String> {
    let sidecar: Value = serde_json::from_slice(
        &fs::read(root.join("payload.tiff.rrdata"))
            .map_err(io("focus_retouch_provenance_missing"))?,
    )
    .map_err(|e| e.to_string())?;
    sidecar["sourceState"]
        .as_array()
        .ok_or("focus_retouch_provenance_sources_missing")?
        .iter()
        .zip(&base.source_immutability_hashes)
        .map(|(source, expected)| {
            let path = source["path"]
                .as_str()
                .ok_or("focus_retouch_source_path_missing")?;
            let bytes = fs::read(path).map_err(io("focus_retouch_source_missing"))?;
            if hash(&bytes) != *expected {
                return Err("focus_retouch_source_changed".into());
            }
            let image = image::load_from_memory(&bytes)
                .map_err(|e| format!("focus_retouch_source_undecodable:{e}"))?;
            if image.dimensions() != (base.width, base.height) {
                return Err("focus_retouch_source_dimensions_changed".into());
            }
            Ok(image.to_rgb32f())
        })
        .collect()
}

fn render_tile(
    root: &Path,
    staging: &Path,
    tile: &Tile,
    image_width: u32,
    overrides: &[u8],
    sources: &[Rgb32FImage],
) -> Result<u64, String> {
    let name = format!("{:08}.bin", tile.index);
    let base_rgb = fs::read(root.join("tiles/rgb").join(&name))
        .map_err(io("focus_retouch_base_tile_missing"))?;
    let base_map =
        fs::read(root.join("maps").join(&name)).map_err(io("focus_retouch_base_map_missing"))?;
    let pixels = tile.width as usize * tile.height as usize;
    if base_rgb.len() != pixels * 12 || base_map.len() != pixels * 16 {
        return Err("focus_retouch_base_tile_invalid".into());
    }
    let mut rgb = base_rgb;
    let mut map = base_map;
    let mut skipped = 0;
    for y in 0..tile.height {
        for x in 0..tile.width {
            let local = (y * tile.width + x) as usize;
            let global = ((tile.y + y) * image_width + tile.x + x) as usize;
            let source =
                u16::from_le_bytes(overrides[global * 4..global * 4 + 2].try_into().unwrap());
            let alpha = u16::from_le_bytes(
                overrides[global * 4 + 2..global * 4 + 4]
                    .try_into()
                    .unwrap(),
            );
            if alpha == 0 || source == AUTOMATIC_SOURCE {
                continue;
            }
            let Some(sample) = sources
                .get(source as usize)
                .map(|s| s.get_pixel(tile.x + x, tile.y + y).0)
            else {
                skipped += 1;
                continue;
            };
            let a = alpha as f32 / u16::MAX as f32;
            for (channel, sample_channel) in sample.iter().enumerate() {
                let off = local * 12 + channel * 4;
                let automatic = f32::from_le_bytes(rgb[off..off + 4].try_into().unwrap());
                rgb[off..off + 4]
                    .copy_from_slice(&(automatic * (1.0 - a) + sample_channel * a).to_le_bytes());
            }
            if alpha == u16::MAX {
                map[local * 16..local * 16 + 2].copy_from_slice(&source.to_le_bytes());
            }
        }
    }
    fs::write(staging.join("tiles/rgb").join(&name), rgb)
        .map_err(io("focus_retouch_tile_write_failed"))?;
    fs::write(staging.join("maps").join(&name), map)
        .map_err(io("focus_retouch_map_write_failed"))?;
    Ok(skipped)
}

fn rasterize(
    stroke: &FocusOverrideStroke,
    width: u32,
    height: u32,
    map: &mut [u8],
) -> BTreeSet<usize> {
    let radius = i64::from(stroke.radius_fixed_1_256_px);
    let mut touched = BTreeSet::new();
    let inner = radius * i64::from(stroke.hardness_u16) / i64::from(u16::MAX);
    let min_x = stroke
        .points_fixed_1_256_px
        .iter()
        .map(|p| i64::from(p.x))
        .min()
        .unwrap();
    let max_x = stroke
        .points_fixed_1_256_px
        .iter()
        .map(|p| i64::from(p.x))
        .max()
        .unwrap();
    let min_y = stroke
        .points_fixed_1_256_px
        .iter()
        .map(|p| i64::from(p.y))
        .min()
        .unwrap();
    let max_y = stroke
        .points_fixed_1_256_px
        .iter()
        .map(|p| i64::from(p.y))
        .max()
        .unwrap();
    let x0 = ((min_x - radius).div_euclid(FIXED_SCALE)).max(0) as u32;
    let y0 = ((min_y - radius).div_euclid(FIXED_SCALE)).max(0) as u32;
    let x1 = ((max_x + radius).div_euclid(FIXED_SCALE)).min(i64::from(width) - 1) as u32;
    let y1 = ((max_y + radius).div_euclid(FIXED_SCALE)).min(i64::from(height) - 1) as u32;
    for y in y0..=y1 {
        for x in x0..=x1 {
            let px = i64::from(x) * FIXED_SCALE + 128;
            let py = i64::from(y) * FIXED_SCALE + 128;
            let d = path_distance(px, py, &stroke.points_fixed_1_256_px);
            if d > radius {
                continue;
            }
            let alpha = if d <= inner || radius == inner {
                u16::MAX
            } else {
                (((radius - d) * i64::from(u16::MAX)) / (radius - inner)) as u16
            };
            let i = (y * width + x) as usize;
            let old = u16::from_le_bytes(map[i * 4 + 2..i * 4 + 4].try_into().unwrap());
            if alpha >= old {
                let source = stroke.source_index.unwrap_or(AUTOMATIC_SOURCE);
                map[i * 4..i * 4 + 2].copy_from_slice(&source.to_le_bytes());
                let stored_alpha = if stroke.source_index.is_some() {
                    alpha
                } else {
                    0
                };
                map[i * 4 + 2..i * 4 + 4].copy_from_slice(&stored_alpha.to_le_bytes());
                touched.insert(i);
            }
        }
    }
    touched
}

fn path_distance(px: i64, py: i64, points: &[FixedPoint]) -> i64 {
    if points.len() == 1 {
        let dx = px - i64::from(points[0].x);
        let dy = py - i64::from(points[0].y);
        return isqrt((dx * dx + dy * dy) as u64) as i64;
    }
    points
        .windows(2)
        .map(|pair| {
            let ax = i64::from(pair[0].x);
            let ay = i64::from(pair[0].y);
            let dx = i64::from(pair[1].x) - ax;
            let dy = i64::from(pair[1].y) - ay;
            let dot = (px - ax) * dx + (py - ay) * dy;
            let len = dx * dx + dy * dy;
            if len == 0 {
                return isqrt(((px - ax) * (px - ax) + (py - ay) * (py - ay)) as u64) as i64;
            }
            if dot <= 0 {
                return isqrt(((px - ax) * (px - ax) + (py - ay) * (py - ay)) as u64) as i64;
            }
            if dot >= len {
                let bx = ax + dx;
                let by = ay + dy;
                return isqrt(((px - bx) * (px - bx) + (py - by) * (py - by)) as u64) as i64;
            }
            let cross = i128::from(px - ax) * i128::from(dy) - i128::from(py - ay) * i128::from(dx);
            isqrt(((cross * cross) / i128::from(len)) as u64) as i64
        })
        .min()
        .unwrap()
}

fn bounds(indices: &BTreeSet<usize>, width: u32) -> Option<RectU32> {
    let min_x = indices.iter().map(|i| *i as u32 % width).min()?;
    let max_x = indices.iter().map(|i| *i as u32 % width).max()?;
    let min_y = indices.iter().map(|i| *i as u32 / width).min()?;
    let max_y = indices.iter().map(|i| *i as u32 / width).max()?;
    Some(RectU32 {
        x: min_x,
        y: min_y,
        width: max_x - min_x + 1,
        height: max_y - min_y + 1,
    })
}
fn isqrt(n: u64) -> u64 {
    if n < 2 {
        return n;
    }
    let mut x = n;
    let mut y = x.div_ceil(2);
    while y < x {
        x = y;
        y = (x + n / x) / 2
    }
    x
}
fn hash(bytes: &[u8]) -> String {
    format!("blake3:{}", blake3::hash(bytes).to_hex())
}
fn revision_dir(root: &Path, id: &str) -> PathBuf {
    root.join("retouch/revisions").join(id)
}
fn read_revision(root: &Path, id: &str) -> Result<FocusRetouchRevision, String> {
    serde_json::from_slice(
        &fs::read(revision_dir(root, id).join("revision.json"))
            .map_err(io("focus_retouch_revision_missing"))?,
    )
    .map_err(|e| format!("focus_retouch_revision_invalid:{e}"))
}
fn read_latest(root: &Path) -> Result<Option<FocusRetouchRevision>, String> {
    let path = root.join("retouch/latest.json");
    if !path.exists() {
        return Ok(None);
    }
    let v: Value =
        serde_json::from_slice(&fs::read(path).map_err(io("focus_retouch_latest_read_failed"))?)
            .map_err(|e| e.to_string())?;
    v["revisionId"]
        .as_str()
        .map(|id| read_revision(root, id))
        .transpose()
}
fn write_latest(root: &Path, id: Option<&str>) -> Result<(), String> {
    let dir = root.join("retouch");
    fs::create_dir_all(&dir).map_err(io("focus_retouch_root_failed"))?;
    let tmp = dir.join(format!(".latest-{}", Uuid::new_v4()));
    let bytes =
        serde_json::to_vec(&serde_json::json!({"schemaVersion":1,"revisionId":id})).unwrap();
    let mut f = fs::File::create(&tmp).map_err(io("focus_retouch_latest_create_failed"))?;
    f.write_all(&bytes)
        .map_err(io("focus_retouch_latest_write_failed"))?;
    f.sync_all()
        .map_err(io("focus_retouch_latest_sync_failed"))?;
    fs::rename(tmp, dir.join("latest.json")).map_err(io("focus_retouch_latest_publish_failed"))
}
fn find_child(root: &Path, parent: Option<&str>) -> Result<Option<String>, String> {
    let dir = root.join("retouch/revisions");
    let mut children = BTreeMap::new();
    for entry in fs::read_dir(dir)
        .map_err(io("focus_retouch_history_read_failed"))?
        .flatten()
    {
        if let Ok(r) = read_revision(root, &entry.file_name().to_string_lossy())
            && r.parent_revision_id.as_deref() == parent
        {
            children.insert(r.revision_id.clone(), r.revision_id);
        }
    }
    Ok(children.into_values().next())
}
fn session(
    root: &Path,
    revision: Option<FocusRetouchRevision>,
    statuses: Vec<String>,
) -> Result<FocusRetouchSession, String> {
    let can_undo = revision.is_some();
    let can_redo = find_child(root, revision.as_ref().map(|r| r.revision_id.as_str()))?.is_some();
    Ok(FocusRetouchSession {
        revision,
        source_statuses: statuses,
        can_undo,
        can_redo,
        render_status: "saved".into(),
    })
}
fn io(prefix: &'static str) -> impl FnOnce(std::io::Error) -> String {
    move |e| format!("{prefix}:{e}")
}

#[cfg(test)]
mod tests {
    use super::*;
    fn stroke(points: Vec<FixedPoint>) -> FocusOverrideStroke {
        FocusOverrideStroke {
            stroke_id: "s1".into(),
            source_index: Some(1),
            points_fixed_1_256_px: points,
            radius_fixed_1_256_px: 4 * 256,
            hardness_u16: 32768,
        }
    }
    #[test]
    fn focus_stack_retouch_rasterization_is_sampling_invariant() {
        let mut a = vec![0; 64 * 64 * 4];
        let mut b = a.clone();
        rasterize(
            &stroke(vec![
                FixedPoint {
                    x: 8 * 256,
                    y: 8 * 256,
                },
                FixedPoint {
                    x: 48 * 256,
                    y: 48 * 256,
                },
            ]),
            64,
            64,
            &mut a,
        );
        let points = (0..=40)
            .map(|i| FixedPoint {
                x: (8 + i) * 256,
                y: (8 + i) * 256,
            })
            .collect();
        rasterize(&stroke(points), 64, 64, &mut b);
        assert_eq!(a, b);
    }
    #[test]
    fn focus_stack_retouch_erase_restores_automatic_bytes() {
        let mut map = vec![0; 32 * 32 * 4];
        let paint = stroke(vec![FixedPoint {
            x: 16 * 256,
            y: 16 * 256,
        }]);
        rasterize(&paint, 32, 32, &mut map);
        let mut erase = paint;
        erase.source_index = None;
        rasterize(&erase, 32, 32, &mut map);
        assert!(
            map.chunks_exact(4)
                .all(|p| u16::from_le_bytes([p[2], p[3]]) == 0)
        );
    }
}
