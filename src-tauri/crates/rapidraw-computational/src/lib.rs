use serde::{Deserialize, Serialize};
use serde_json::json;

fn stable_hash(value: &serde_json::Value) -> String {
    fn stable_json(value: &serde_json::Value) -> String {
        match value {
            serde_json::Value::Array(items) => format!(
                "[{}]",
                items.iter().map(stable_json).collect::<Vec<_>>().join(",")
            ),
            serde_json::Value::Object(map) => {
                let mut entries = map.iter().collect::<Vec<_>>();
                entries.sort_by_key(|(key, _)| *key);
                format!(
                    "{{{}}}",
                    entries
                        .into_iter()
                        .map(|(key, item)| format!(
                            "{}:{}",
                            serde_json::to_string(key).expect("JSON object keys serialize"),
                            stable_json(item)
                        ))
                        .collect::<Vec<_>>()
                        .join(",")
                )
            }
            _ => serde_json::to_string(value).expect("tile plan identity serializes"),
        }
    }

    format!(
        "blake3:{}",
        blake3::hash(stable_json(value).as_bytes()).to_hex()
    )
}

pub const DEFAULT_MEMORY_BUDGET_BYTES: u64 = 512 * 1024 * 1024;
pub const MIN_MEMORY_BUDGET_BYTES: u64 = 256 * 1024 * 1024;
pub const MAX_MEMORY_BUDGET_BYTES: u64 = 2 * 1024 * 1024 * 1024;
const ALIGNMENT: u32 = 32;
const MIN_CORE: u32 = 32;

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TilePlanRequest {
    pub schema_version: u32,
    pub output_width: u64,
    pub output_height: u64,
    pub bytes_per_working_pixel: u64,
    pub source_count: u64,
    pub requested_core_width: u32,
    pub requested_core_height: u32,
    pub halo: TileHalo,
    pub memory_budget_bytes: Option<u64>,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TileHalo {
    pub top: u32,
    pub right: u32,
    pub bottom: u32,
    pub left: u32,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TileRect {
    pub index: u64,
    pub row: u64,
    pub column: u64,
    pub core_x: u64,
    pub core_y: u64,
    pub core_width: u32,
    pub core_height: u32,
    pub input_x: i64,
    pub input_y: i64,
    pub input_width: u32,
    pub input_height: u32,
    pub halo: TileHalo,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TileMemoryEstimate {
    pub resident_input_bytes: u64,
    pub transformed_scratch_bytes: u64,
    pub maps_accumulators_bytes: u64,
    pub output_tile_bytes: u64,
    pub encoder_buffer_bytes: u64,
    pub subtotal_bytes: u64,
    pub safety_margin_bytes: u64,
    pub estimated_peak_bytes: u64,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AcceptedTilePlan {
    pub schema_version: u32,
    pub plan_hash: String,
    pub memory_budget_bytes: u64,
    pub core_width: u32,
    pub core_height: u32,
    pub halo: TileHalo,
    pub columns: u64,
    pub rows: u64,
    pub tile_count: u64,
    pub overlap_ownership: String,
    pub reduction_order: String,
    pub memory: TileMemoryEstimate,
    pub stage_work_units: Vec<StageWorkUnits>,
    pub tiles: Vec<TileRect>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct StageWorkUnits {
    pub stage: String,
    pub units: u64,
    pub weight: u64,
}

fn checked_mul(a: u64, b: u64) -> Result<u64, String> {
    a.checked_mul(b)
        .ok_or_else(|| "tile_plan_dimension_overflow".to_string())
}
fn checked_add(a: u64, b: u64) -> Result<u64, String> {
    a.checked_add(b)
        .ok_or_else(|| "tile_plan_dimension_overflow".to_string())
}

fn estimate(
    core_width: u32,
    core_height: u32,
    halo: TileHalo,
    bpp: u64,
    sources: u64,
) -> Result<TileMemoryEstimate, String> {
    let input_width = u64::from(core_width) + u64::from(halo.left) + u64::from(halo.right);
    let input_height = u64::from(core_height) + u64::from(halo.top) + u64::from(halo.bottom);
    let input_pixels = checked_mul(input_width, input_height)?;
    let core_pixels = checked_mul(u64::from(core_width), u64::from(core_height))?;
    let one_input = checked_mul(input_pixels, bpp)?;
    let resident_input_bytes = checked_mul(one_input, sources)?;
    let transformed_scratch_bytes = checked_mul(one_input, sources)?;
    let maps_accumulators_bytes = checked_mul(input_pixels, 16)?;
    let output_tile_bytes = checked_mul(core_pixels, bpp)?;
    let encoder_buffer_bytes = output_tile_bytes;
    let subtotal_bytes = [
        resident_input_bytes,
        transformed_scratch_bytes,
        maps_accumulators_bytes,
        output_tile_bytes,
        encoder_buffer_bytes,
    ]
    .into_iter()
    .try_fold(0, checked_add)?;
    let safety_margin_bytes = checked_add(
        checked_mul(subtotal_bytes, 15)? / 100,
        u64::from(checked_mul(subtotal_bytes, 15)? % 100 != 0),
    )?;
    let estimated_peak_bytes = checked_add(subtotal_bytes, safety_margin_bytes)?;
    Ok(TileMemoryEstimate {
        resident_input_bytes,
        transformed_scratch_bytes,
        maps_accumulators_bytes,
        output_tile_bytes,
        encoder_buffer_bytes,
        subtotal_bytes,
        safety_margin_bytes,
        estimated_peak_bytes,
    })
}

pub fn plan_tiles(request: TilePlanRequest) -> Result<AcceptedTilePlan, String> {
    if request.schema_version != 1
        || request.output_width == 0
        || request.output_height == 0
        || request.bytes_per_working_pixel == 0
        || request.source_count == 0
        || request.output_width > i64::MAX as u64
        || request.output_height > i64::MAX as u64
    {
        return Err("invalid_tile_plan_request".to_string());
    }
    let budget = request
        .memory_budget_bytes
        .unwrap_or(DEFAULT_MEMORY_BUDGET_BYTES)
        .clamp(MIN_MEMORY_BUDGET_BYTES, MAX_MEMORY_BUDGET_BYTES);
    let aligned = |value: u32| -> u32 {
        if value < ALIGNMENT {
            value.max(1)
        } else {
            (value / ALIGNMENT) * ALIGNMENT
        }
    };
    let mut core_width = aligned(
        request
            .requested_core_width
            .min(u32::try_from(request.output_width).unwrap_or(u32::MAX)),
    );
    let mut core_height = aligned(
        request
            .requested_core_height
            .min(u32::try_from(request.output_height).unwrap_or(u32::MAX)),
    );
    core_width = core_width.max(request.output_width.min(u64::from(MIN_CORE)) as u32);
    core_height = core_height.max(request.output_height.min(u64::from(MIN_CORE)) as u32);
    while estimate(
        core_width,
        core_height,
        request.halo,
        request.bytes_per_working_pixel,
        request.source_count,
    )?
    .estimated_peak_bytes
        > budget
    {
        if core_width <= MIN_CORE && core_height <= MIN_CORE {
            return Err("memory_budget_too_small".to_string());
        }
        if core_width >= core_height && core_width > MIN_CORE {
            core_width = (core_width - ALIGNMENT).max(MIN_CORE);
        } else {
            core_height = (core_height - ALIGNMENT).max(MIN_CORE);
        }
    }
    let memory = estimate(
        core_width,
        core_height,
        request.halo,
        request.bytes_per_working_pixel,
        request.source_count,
    )?;
    let columns = request.output_width.div_ceil(u64::from(core_width));
    let rows = request.output_height.div_ceil(u64::from(core_height));
    let tile_count = checked_mul(columns, rows)?;
    let capacity =
        usize::try_from(tile_count).map_err(|_| "tile_plan_too_many_tiles".to_string())?;
    let mut tiles = Vec::with_capacity(capacity);
    for row in 0..rows {
        for column in 0..columns {
            let core_x = checked_mul(column, u64::from(core_width))?;
            let core_y = checked_mul(row, u64::from(core_height))?;
            let width = (request.output_width - core_x).min(u64::from(core_width)) as u32;
            let height = (request.output_height - core_y).min(u64::from(core_height)) as u32;
            let input_x = i64::try_from(core_x)
                .map_err(|_| "tile_plan_dimension_overflow".to_string())?
                - i64::from(request.halo.left);
            let input_y = i64::try_from(core_y)
                .map_err(|_| "tile_plan_dimension_overflow".to_string())?
                - i64::from(request.halo.top);
            tiles.push(TileRect {
                index: checked_add(checked_mul(row, columns)?, column)?,
                row,
                column,
                core_x,
                core_y,
                core_width: width,
                core_height: height,
                input_x,
                input_y,
                input_width: width
                    .checked_add(request.halo.left)
                    .and_then(|v| v.checked_add(request.halo.right))
                    .ok_or_else(|| "tile_plan_dimension_overflow".to_string())?,
                input_height: height
                    .checked_add(request.halo.top)
                    .and_then(|v| v.checked_add(request.halo.bottom))
                    .ok_or_else(|| "tile_plan_dimension_overflow".to_string())?,
                halo: request.halo,
            });
        }
    }
    let stage_work_units = vec![
        StageWorkUnits {
            stage: "tiles".to_string(),
            units: tile_count,
            weight: 90,
        },
        StageWorkUnits {
            stage: "commit".to_string(),
            units: 1,
            weight: 10,
        },
    ];
    let identity = json!({"request": request, "acceptedMemoryBudgetBytes": budget, "coreWidth": core_width, "coreHeight": core_height, "memory": memory, "tileCount": tile_count, "overlapOwnership":"core_only", "reductionOrder":"source_then_row_major_tile"});
    Ok(AcceptedTilePlan {
        schema_version: 1,
        plan_hash: stable_hash(&identity),
        memory_budget_bytes: budget,
        core_width,
        core_height,
        halo: request.halo,
        columns,
        rows,
        tile_count,
        overlap_ownership: "core_only".to_string(),
        reduction_order: "source_then_row_major_tile".to_string(),
        memory,
        stage_work_units,
        tiles,
    })
}

pub fn reflect_index(index: i64, length: usize) -> usize {
    if length <= 1 {
        return 0;
    }
    let period = (length * 2 - 2) as i64;
    let value = index.rem_euclid(period);
    if value < length as i64 {
        value as usize
    } else {
        (period - value) as usize
    }
}
pub fn clamp_index(index: i64, length: usize) -> usize {
    index.clamp(0, length.saturating_sub(1) as i64) as usize
}
pub fn valid_domain_mask(x: i64, y: i64, width: u64, height: u64) -> bool {
    x >= 0 && y >= 0 && (x as u64) < width && (y as u64) < height
}

pub fn read_reflected<T: Copy>(pixels: &[T], width: usize, x: i64, y: i64) -> Option<T> {
    let height = pixels.len().checked_div(width)?;
    if width == 0 || height == 0 || width.checked_mul(height)? != pixels.len() {
        return None;
    }
    pixels
        .get(reflect_index(y, height) * width + reflect_index(x, width))
        .copied()
}

pub fn read_clamped<T: Copy>(pixels: &[T], width: usize, x: i64, y: i64) -> Option<T> {
    let height = pixels.len().checked_div(width)?;
    if width == 0 || height == 0 || width.checked_mul(height)? != pixels.len() {
        return None;
    }
    pixels
        .get(clamp_index(y, height) * width + clamp_index(x, width))
        .copied()
}

pub fn write_core<T: Copy>(
    output: &mut [T],
    output_width: usize,
    tile: &TileRect,
    core: &[T],
) -> Result<(), String> {
    let core_width = tile.core_width as usize;
    let core_height = tile.core_height as usize;
    if output_width == 0
        || core.len() != core_width.saturating_mul(core_height)
        || !output.len().is_multiple_of(output_width)
    {
        return Err("tile_core_shape_mismatch".to_string());
    }
    let start_x = usize::try_from(tile.core_x).map_err(|_| "tile_core_out_of_bounds")?;
    let start_y = usize::try_from(tile.core_y).map_err(|_| "tile_core_out_of_bounds")?;
    let output_height = output.len() / output_width;
    if start_x
        .checked_add(core_width)
        .is_none_or(|x| x > output_width)
        || start_y
            .checked_add(core_height)
            .is_none_or(|y| y > output_height)
    {
        return Err("tile_core_out_of_bounds".to_string());
    }
    for row in 0..core_height {
        let destination = (start_y + row) * output_width + start_x;
        let source = row * core_width;
        output[destination..destination + core_width]
            .copy_from_slice(&core[source..source + core_width]);
    }
    Ok(())
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct PanoramaSourceDimensions {
    pub width: u32,
    pub height: u32,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PanoramaMemoryEstimate {
    pub source_decode_bytes: u64,
    pub low_detail_mask_bytes: u64,
    pub output_canvas_bytes: u64,
    pub output_mask_bytes: u64,
    pub seam_workspace_bytes: u64,
    pub preview_bytes: u64,
    pub overhead_bytes: u64,
    pub total_estimated_peak_bytes: u64,
}

pub fn estimate_panorama_memory(
    sources: &[PanoramaSourceDimensions],
    output_width: u32,
    output_height: u32,
    max_preview_dimension_px: u32,
) -> Result<PanoramaMemoryEstimate, String> {
    if sources.is_empty()
        || output_width == 0
        || output_height == 0
        || max_preview_dimension_px == 0
    {
        return Err("invalid_panorama_memory_request".to_string());
    }
    const RGB32F_BYTES_PER_PIXEL: u64 = 12;
    const MASK_BYTES_PER_PIXEL: u64 = 1;
    const RGB8_BYTES_PER_PIXEL: u64 = 3;
    let pixels = |width: u32, height: u32| checked_mul(u64::from(width), u64::from(height));
    let source_pixels = sources.iter().try_fold(0_u64, |total, source| {
        checked_add(total, pixels(source.width, source.height)?)
    })?;
    let source_decode_bytes = checked_mul(source_pixels, RGB32F_BYTES_PER_PIXEL)?;
    let low_detail_mask_bytes = checked_mul(source_pixels, MASK_BYTES_PER_PIXEL)?;
    let output_pixels = pixels(output_width, output_height)?;
    let output_canvas_bytes = checked_mul(output_pixels, RGB32F_BYTES_PER_PIXEL)?;
    let output_mask_bytes = checked_mul(output_pixels, MASK_BYTES_PER_PIXEL)?;
    let seam_workspace_bytes = checked_mul(output_pixels, 4)?;
    let largest_dimension = output_width.max(output_height);
    let preview_pixels = if largest_dimension <= max_preview_dimension_px {
        output_pixels
    } else {
        let scale = f64::from(max_preview_dimension_px) / f64::from(largest_dimension);
        let width = (f64::from(output_width) * scale).round().max(1.0) as u64;
        let height = (f64::from(output_height) * scale).round().max(1.0) as u64;
        checked_mul(width, height)?
    };
    let preview_bytes = checked_mul(preview_pixels, RGB8_BYTES_PER_PIXEL)?;
    let overhead_bytes = checked_add(source_decode_bytes, output_canvas_bytes)? / 10;
    let total_estimated_peak_bytes = [
        source_decode_bytes,
        low_detail_mask_bytes,
        output_canvas_bytes,
        output_mask_bytes,
        seam_workspace_bytes,
        preview_bytes,
        overhead_bytes,
    ]
    .into_iter()
    .try_fold(0, checked_add)?;
    Ok(PanoramaMemoryEstimate {
        source_decode_bytes,
        low_detail_mask_bytes,
        output_canvas_bytes,
        output_mask_bytes,
        seam_workspace_bytes,
        preview_bytes,
        overhead_bytes,
        total_estimated_peak_bytes,
    })
}

pub fn require_opencv_panorama_backend() -> Result<(), rapidraw_types::CapabilityUnavailable> {
    if cfg!(feature = "opencv-panorama") {
        Ok(())
    } else {
        Err(rapidraw_types::CapabilityUnavailable::new(
            rapidraw_types::NativeCapability::Computational,
        ))
    }
}

#[cfg(feature = "opencv-panorama")]
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct OpenCvPanoramaSpikeReport {
    pub backend_id: &'static str,
    pub crate_version: &'static str,
    pub feature_enabled: bool,
}

#[cfg(feature = "opencv-panorama")]
pub fn build_opencv_panorama_spike_report(
    crate_version: &'static str,
) -> OpenCvPanoramaSpikeReport {
    let _mat_size_probe = std::mem::size_of::<opencv::core::Mat>();
    OpenCvPanoramaSpikeReport {
        backend_id: "opencv-panorama-spike",
        crate_version,
        feature_enabled: true,
    }
}

#[cfg(test)]
mod tile_runtime_tests {
    use super::*;
    fn request(w: u64, h: u64) -> TilePlanRequest {
        TilePlanRequest {
            schema_version: 1,
            output_width: w,
            output_height: h,
            bytes_per_working_pixel: 16,
            source_count: 4,
            requested_core_width: 512,
            requested_core_height: 512,
            halo: TileHalo {
                top: 24,
                right: 24,
                bottom: 24,
                left: 24,
            },
            memory_budget_bytes: None,
        }
    }
    #[test]
    fn tiny_and_odd_grids_are_row_major() {
        let p = plan_tiles(request(777, 513)).unwrap();
        assert_eq!(p.tile_count, 4);
        assert_eq!(
            (
                p.tiles[3].row,
                p.tiles[3].column,
                p.tiles[3].core_width,
                p.tiles[3].core_height
            ),
            (1, 1, 265, 1)
        );
    }
    #[test]
    fn multi_gigapixel_grid_does_not_allocate_pixels() {
        let p = plan_tiles(request(100_000, 50_000)).unwrap();
        assert!(p.tile_count > 1);
        assert_eq!(p.tiles.last().unwrap().index, p.tile_count - 1);
    }
    #[test]
    fn estimate_is_exact_and_margin_rounds_up() {
        let e = estimate(
            32,
            32,
            TileHalo {
                top: 1,
                right: 1,
                bottom: 1,
                left: 1,
            },
            4,
            2,
        )
        .unwrap();
        assert_eq!(
            e.estimated_peak_bytes,
            e.subtotal_bytes + e.safety_margin_bytes
        );
        assert_eq!(e.safety_margin_bytes, (e.subtotal_bytes * 15).div_ceil(100));
    }
    #[test]
    fn halo_is_not_truncated_at_edges() {
        let p = plan_tiles(request(40, 40)).unwrap();
        assert_eq!(p.tiles[0].input_width, 80);
        assert_eq!(p.tiles[0].input_x, -24);
        assert_eq!(p.tiles[0].halo.left, 24);
    }
    #[test]
    fn impossible_minimum_is_rejected() {
        let mut r = request(100, 100);
        r.bytes_per_working_pixel = 1_000_000;
        r.memory_budget_bytes = Some(MIN_MEMORY_BUDGET_BYTES);
        assert_eq!(plan_tiles(r).unwrap_err(), "memory_budget_too_small");
    }
    #[test]
    fn plan_hash_and_order_are_stable() {
        let a = plan_tiles(request(999, 777)).unwrap();
        let b = plan_tiles(request(999, 777)).unwrap();
        assert_eq!(a, b);
    }
    #[test]
    fn boundary_reads_and_core_only_writes_are_explicit() {
        let pixels = [0, 1, 2, 3, 4, 5];
        assert_eq!(read_reflected(&pixels, 3, -1, 0), Some(1));
        assert_eq!(read_clamped(&pixels, 3, -1, 9), Some(3));
        assert!(!valid_domain_mask(-1, 0, 3, 2));
        let tile = plan_tiles(request(40, 40)).unwrap().tiles.remove(0);
        let mut output = vec![0u8; 40 * 40];
        let core = vec![7u8; tile.core_width as usize * tile.core_height as usize];
        write_core(&mut output, 40, &tile, &core).unwrap();
        assert_eq!(output[0], 7);
        assert_eq!(output[31 * 40 + 31], 7);
        assert_eq!(output[32], 0);
        assert_eq!(output[32 * 40], 0);
    }

    #[test]
    fn panorama_memory_workload_is_bounded_and_deterministic() {
        let sources = [
            PanoramaSourceDimensions {
                width: 6_048,
                height: 4_024,
            },
            PanoramaSourceDimensions {
                width: 6_048,
                height: 4_024,
            },
            PanoramaSourceDimensions {
                width: 6_048,
                height: 4_024,
            },
        ];
        let first = estimate_panorama_memory(&sources, 16_000, 5_000, 2_048).unwrap();
        let second = estimate_panorama_memory(&sources, 16_000, 5_000, 2_048).unwrap();
        assert_eq!(first, second);
        assert!(first.total_estimated_peak_bytes > first.output_canvas_bytes);
        assert!(first.preview_bytes < first.output_canvas_bytes);
    }

    #[cfg(not(feature = "opencv-panorama"))]
    #[test]
    fn disabled_optional_panorama_backend_has_stable_capability_error() {
        assert_eq!(
            serde_json::to_value(require_opencv_panorama_backend().unwrap_err()).unwrap(),
            serde_json::json!({
                "code": "capability_unavailable",
                "capability": "computational"
            })
        );
    }
}
