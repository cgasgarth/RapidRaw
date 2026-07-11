use std::path::Path;

use image::{Rgb, Rgb32FImage};
use ndarray::{Array4, Ix4};
use ort::session::Session;
use ort::value::Tensor;

use crate::merge::computational_job::ComputationalMergeCancellationToken;
use crate::merge::tile_runtime::{TileHalo, TilePlanRequest, plan_tiles};

const SCALE: u32 = 2;
const CORE: u32 = 256;
const OVERLAP: u32 = 64;

pub trait SwinIrRunner {
    fn run(&mut self, input: &Rgb32FImage) -> Result<Rgb32FImage, String>;
}

pub struct OrtSwinIrRunner {
    session: Session,
}

impl OrtSwinIrRunner {
    pub fn open(path: &Path) -> Result<Self, String> {
        let _ = ort::init().with_name("SwinIR-x2-CPU").commit();
        let session = Session::builder()
            .map_err(|error| format!("swinir_x2_session_builder_failed:{error}"))?
            .with_intra_threads(1)
            .map_err(|error| format!("swinir_x2_session_threads_failed:{error}"))?
            .commit_from_file(path)
            .map_err(|error| format!("swinir_x2_session_load_failed:{error}"))?;
        validate_io_contract(&session)?;
        Ok(Self { session })
    }
}

impl SwinIrRunner for OrtSwinIrRunner {
    fn run(&mut self, input: &Rgb32FImage) -> Result<Rgb32FImage, String> {
        let width = input.width() as usize;
        let height = input.height() as usize;
        let mut array = Array4::zeros((1, 3, height, width));
        for (x, y, pixel) in input.enumerate_pixels() {
            for channel in 0..3 {
                array[[0, channel, y as usize, x as usize]] = pixel[channel];
            }
        }
        let tensor = Tensor::from_array(array)
            .map_err(|error| format!("swinir_x2_input_tensor_failed:{error}"))?;
        let outputs = self
            .session
            .run(ort::inputs!["input" => tensor])
            .map_err(|error| format!("swinir_x2_inference_failed:{error}"))?;
        let output = outputs["output"]
            .try_extract_array::<f32>()
            .map_err(|error| format!("swinir_x2_output_tensor_failed:{error}"))?
            .to_owned()
            .into_dimensionality::<Ix4>()
            .map_err(|error| format!("swinir_x2_output_shape_failed:{error}"))?;
        let expected = [1, 3, height * 2, width * 2];
        if output.shape() != expected {
            return Err(format!(
                "swinir_x2_output_shape_mismatch:{:?}",
                output.shape()
            ));
        }
        let mut image = Rgb32FImage::new(input.width() * 2, input.height() * 2);
        for (x, y, pixel) in image.enumerate_pixels_mut() {
            *pixel = Rgb([
                output[[0, 0, y as usize, x as usize]],
                output[[0, 1, y as usize, x as usize]],
                output[[0, 2, y as usize, x as usize]],
            ]);
            if pixel.0.iter().any(|value| !value.is_finite()) {
                return Err("swinir_x2_nonfinite_output".to_string());
            }
        }
        Ok(image)
    }
}

fn validate_io_contract(session: &Session) -> Result<(), String> {
    if session.inputs().len() != 1 || session.inputs()[0].name() != "input" {
        return Err("swinir_x2_input_contract_mismatch".to_string());
    }
    if session.outputs().len() != 1 || session.outputs()[0].name() != "output" {
        return Err("swinir_x2_output_contract_mismatch".to_string());
    }
    Ok(())
}

pub fn tile_count(
    width: u32,
    height: u32,
    memory_budget_bytes: Option<u64>,
) -> Result<u64, String> {
    Ok(tile_plan(width, height, memory_budget_bytes)?.tile_count)
}

pub fn run_tiled_x2(
    input: &Rgb32FImage,
    memory_budget_bytes: Option<u64>,
    cancellation: &ComputationalMergeCancellationToken,
    runner: &mut dyn SwinIrRunner,
) -> Result<Rgb32FImage, String> {
    if input.width() == 0 || input.height() == 0 {
        return Err("swinir_x2_empty_input".to_string());
    }
    let plan = tile_plan(input.width(), input.height(), memory_budget_bytes)?;
    let output_width = input.width() as usize * SCALE as usize;
    let output_height = input.height() as usize * SCALE as usize;
    let mut sums = vec![[0.0_f64; 3]; output_width * output_height];
    let mut weights = vec![0.0_f64; output_width * output_height];

    for tile in &plan.tiles {
        cancellation.checkpoint()?;
        let tile_input = extract_reflect(
            input,
            tile.input_x,
            tile.input_y,
            tile.input_width,
            tile.input_height,
        );
        let tile_output = runner.run(&tile_input)?;
        let true_left = tile.input_x.max(0) as u32;
        let true_top = tile.input_y.max(0) as u32;
        let true_right =
            (tile.input_x + i64::from(tile.input_width)).min(i64::from(input.width())) as u32;
        let true_bottom =
            (tile.input_y + i64::from(tile.input_height)).min(i64::from(input.height())) as u32;
        let source_left = (i64::from(true_left) - tile.input_x) as u32 * SCALE;
        let source_top = (i64::from(true_top) - tile.input_y) as u32 * SCALE;
        let blend_width = (true_right - true_left) * SCALE;
        let blend_height = (true_bottom - true_top) * SCALE;
        for y in 0..blend_height {
            for x in 0..blend_width {
                let target_x = true_left * SCALE + x;
                let target_y = true_top * SCALE + y;
                let pixel = tile_output.get_pixel(source_left + x, source_top + y);
                let weight = raised_cosine_weight(x, blend_width, y, blend_height);
                let index = target_y as usize * output_width + target_x as usize;
                for channel in 0..3 {
                    sums[index][channel] += f64::from(pixel[channel]) * weight;
                }
                weights[index] += weight;
            }
        }
    }
    cancellation.checkpoint()?;
    Ok(Rgb32FImage::from_fn(
        input.width() * SCALE,
        input.height() * SCALE,
        |x, y| {
            let index = y as usize * output_width + x as usize;
            let weight = weights[index].max(f64::EPSILON);
            Rgb([
                (sums[index][0] / weight) as f32,
                (sums[index][1] / weight) as f32,
                (sums[index][2] / weight) as f32,
            ])
        },
    ))
}

fn tile_plan(
    width: u32,
    height: u32,
    memory_budget_bytes: Option<u64>,
) -> Result<crate::merge::tile_runtime::AcceptedTilePlan, String> {
    plan_tiles(TilePlanRequest {
        schema_version: 1,
        output_width: u64::from(width),
        output_height: u64::from(height),
        bytes_per_working_pixel: 48,
        source_count: 1,
        requested_core_width: CORE,
        requested_core_height: CORE,
        halo: TileHalo {
            top: OVERLAP,
            right: OVERLAP,
            bottom: OVERLAP,
            left: OVERLAP,
        },
        memory_budget_bytes,
    })
}

fn extract_reflect(input: &Rgb32FImage, x0: i64, y0: i64, width: u32, height: u32) -> Rgb32FImage {
    Rgb32FImage::from_fn(width, height, |x, y| {
        *input.get_pixel(
            reflect(x0 + i64::from(x), input.width()),
            reflect(y0 + i64::from(y), input.height()),
        )
    })
}

fn reflect(value: i64, length: u32) -> u32 {
    if length <= 1 {
        return 0;
    }
    let period = i64::from(length - 1) * 2;
    let folded = value.rem_euclid(period);
    folded.min(period - folded) as u32
}

fn raised_cosine_weight(x: u32, width: u32, y: u32, height: u32) -> f64 {
    fn axis(position: u32, length: u32) -> f64 {
        if length <= 1 {
            return 1.0;
        }
        let t = f64::from(position) / f64::from(length - 1);
        0.5 - 0.5 * (std::f64::consts::TAU * t).cos()
    }
    (axis(x, width) * axis(y, height)).max(1e-6)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Arc;
    use std::sync::atomic::AtomicBool;

    struct NearestX2;
    impl SwinIrRunner for NearestX2 {
        fn run(&mut self, input: &Rgb32FImage) -> Result<Rgb32FImage, String> {
            Ok(image::imageops::resize(
                input,
                input.width() * 2,
                input.height() * 2,
                image::imageops::FilterType::Nearest,
            ))
        }
    }

    #[test]
    fn odd_multitile_output_is_exactly_x2_and_deterministic() {
        let input = Rgb32FImage::from_fn(333, 271, |x, y| {
            Rgb([x as f32 / 332.0, y as f32 / 270.0, (x + y) as f32 / 602.0])
        });
        let token = ComputationalMergeCancellationToken(Arc::new(AtomicBool::new(false)));
        let first = run_tiled_x2(&input, None, &token, &mut NearestX2).unwrap();
        let second = run_tiled_x2(&input, None, &token, &mut NearestX2).unwrap();
        assert_eq!(first.dimensions(), (666, 542));
        assert_eq!(first.as_raw(), second.as_raw());
    }
}
