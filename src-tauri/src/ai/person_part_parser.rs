use std::sync::Mutex;

use anyhow::{Result, anyhow};
use image::imageops::{self, FilterType};
use image::{DynamicImage, GenericImageView, GrayImage, Luma};
use ndarray::{Array, Array4, ArrayViewD};
use rapidraw_ai::ort::session::Session;
use rapidraw_ai::ort::value::Tensor;
use serde::Serialize;

use crate::ai::ai_processing::{
    PERSON_PART_PARSER_INPUT_SIZE, PERSON_PART_PARSER_MODEL_ID, PERSON_PART_PARSER_SHA256,
};

const PERSON_PART_CLASS_COUNT: usize = 20;
const PERSON_PART_BACKGROUND_CLASS: usize = 0;
const PERSON_PART_HAIR_CLASS: usize = 2;
const PERSON_PART_TOP_CLOTHES_CLASS: usize = 5;
const PERSON_PART_BOTTOM_CLOTHES_CLASS: usize = 9;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum PersonPartMaskTarget {
    Clothing,
    Hair,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PersonPartParserProvenance {
    pub class_ids: Vec<u8>,
    pub model_id: &'static str,
    pub model_sha256: &'static str,
    pub target_part: &'static str,
}

pub fn run_person_part_parser_model(
    image: &DynamicImage,
    session: &Mutex<Session>,
    target: PersonPartMaskTarget,
) -> Result<GrayImage> {
    let input_tensor = build_person_part_input_tensor(image);
    let t_input = Tensor::from_array(input_tensor.into_dyn().as_standard_layout().into_owned())?;
    let mut session = session.lock().unwrap();
    let outputs = session.run(rapidraw_ai::ort::inputs![t_input])?;
    let output_tensor = outputs[0].try_extract_array::<f32>()?.to_owned();
    let classes = class_map_from_output(output_tensor.view())?;
    let mask = mask_from_class_map(&classes, target)?;
    let (orig_width, orig_height) = image.dimensions();
    Ok(imageops::resize(
        &mask,
        orig_width,
        orig_height,
        FilterType::Triangle,
    ))
}

pub fn person_part_parser_provenance(target: PersonPartMaskTarget) -> PersonPartParserProvenance {
    PersonPartParserProvenance {
        class_ids: target
            .class_ids()
            .iter()
            .map(|class_id| *class_id as u8)
            .collect(),
        model_id: PERSON_PART_PARSER_MODEL_ID,
        model_sha256: PERSON_PART_PARSER_SHA256,
        target_part: target.as_str(),
    }
}

fn build_person_part_input_tensor(image: &DynamicImage) -> Array4<f32> {
    let resized = image
        .resize_exact(
            PERSON_PART_PARSER_INPUT_SIZE,
            PERSON_PART_PARSER_INPUT_SIZE,
            FilterType::Triangle,
        )
        .into_rgb8();
    let raw = resized.as_raw();
    let size = PERSON_PART_PARSER_INPUT_SIZE as usize;
    let mut input = Array::zeros((1, size, size, 3));

    for y in 0..size {
        for x in 0..size {
            let source = (y * size + x) * 3;
            input[[0, y, x, 0]] = raw[source] as f32 / 127.5 - 1.0;
            input[[0, y, x, 1]] = raw[source + 1] as f32 / 127.5 - 1.0;
            input[[0, y, x, 2]] = raw[source + 2] as f32 / 127.5 - 1.0;
        }
    }

    input
}

fn class_map_from_output(output: ArrayViewD<'_, f32>) -> Result<Vec<usize>> {
    let shape = output.shape();
    if shape.len() != 5 || *shape.last().unwrap_or(&0) != PERSON_PART_CLASS_COUNT {
        return Err(anyhow!(
            "Unexpected person-part parser output shape {:?}; expected [1, 1, 512, 512, 20]",
            shape
        ));
    }

    let height = shape[2];
    let width = shape[3];
    if height != PERSON_PART_PARSER_INPUT_SIZE as usize
        || width != PERSON_PART_PARSER_INPUT_SIZE as usize
    {
        return Err(anyhow!(
            "Unexpected person-part parser output dimensions {width}x{height}"
        ));
    }

    let slice = output
        .as_slice()
        .ok_or_else(|| anyhow!("Person-part parser output was not contiguous"))?;
    let mut classes = Vec::with_capacity(width * height);

    for pixel in 0..width * height {
        let offset = pixel * PERSON_PART_CLASS_COUNT;
        let mut best_class = PERSON_PART_BACKGROUND_CLASS;
        let mut best_score = f32::NEG_INFINITY;
        for class_id in 0..PERSON_PART_CLASS_COUNT {
            let score = slice[offset + class_id];
            if score > best_score {
                best_score = score;
                best_class = class_id;
            }
        }
        classes.push(best_class);
    }

    Ok(classes)
}

fn mask_from_class_map(classes: &[usize], target: PersonPartMaskTarget) -> Result<GrayImage> {
    let size = PERSON_PART_PARSER_INPUT_SIZE;
    let expected_len = (size * size) as usize;
    if classes.len() != expected_len {
        return Err(anyhow!(
            "Person-part class map had {} pixels; expected {expected_len}",
            classes.len()
        ));
    }

    let target_classes = target.class_ids();
    let mut mask = GrayImage::new(size, size);
    for (index, class_id) in classes.iter().enumerate() {
        let x = (index % size as usize) as u32;
        let y = (index / size as usize) as u32;
        let alpha = if target_classes.contains(class_id) {
            255
        } else {
            0
        };
        mask.put_pixel(x, y, Luma([alpha]));
    }

    let coverage = mask.pixels().filter(|pixel| pixel[0] > 0).count() as f64 / expected_len as f64;
    if !(0.0001..=0.95).contains(&coverage) {
        return Err(anyhow!(
            "Person-part {} mask coverage {coverage:.6} outside plausible range",
            target.as_str()
        ));
    }

    Ok(mask)
}

impl PersonPartMaskTarget {
    fn as_str(self) -> &'static str {
        match self {
            Self::Clothing => "clothing",
            Self::Hair => "hair",
        }
    }

    fn class_ids(self) -> &'static [usize] {
        match self {
            Self::Clothing => &[
                PERSON_PART_TOP_CLOTHES_CLASS,
                PERSON_PART_BOTTOM_CLOTHES_CLASS,
            ],
            Self::Hair => &[PERSON_PART_HAIR_CLASS],
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{
        PERSON_PART_BACKGROUND_CLASS, PERSON_PART_BOTTOM_CLOTHES_CLASS, PERSON_PART_HAIR_CLASS,
        PERSON_PART_TOP_CLOTHES_CLASS, PersonPartMaskTarget, mask_from_class_map,
        person_part_parser_provenance,
    };
    use crate::ai::ai_processing::PERSON_PART_PARSER_MODEL_ID;

    #[test]
    fn clothing_mask_merges_top_and_bottom_clothes_only() {
        let size = crate::ai::ai_processing::PERSON_PART_PARSER_INPUT_SIZE as usize;
        let mut classes = vec![PERSON_PART_BACKGROUND_CLASS; size * size];
        for y in 20..40 {
            for x in 20..40 {
                classes[y * size + x] = PERSON_PART_TOP_CLOTHES_CLASS;
            }
        }
        for y in 40..60 {
            for x in 20..40 {
                classes[y * size + x] = PERSON_PART_BOTTOM_CLOTHES_CLASS;
            }
        }
        classes[60 * size + 20] = PERSON_PART_HAIR_CLASS;

        let mask = mask_from_class_map(&classes, PersonPartMaskTarget::Clothing).unwrap();

        assert_eq!(mask.get_pixel(20, 20)[0], 255);
        assert_eq!(mask.get_pixel(20, 40)[0], 255);
        assert_eq!(mask.get_pixel(20, 60)[0], 0);
    }

    #[test]
    fn empty_clothing_mask_fails_closed() {
        let size = crate::ai::ai_processing::PERSON_PART_PARSER_INPUT_SIZE as usize;
        let classes = vec![PERSON_PART_BACKGROUND_CLASS; size * size];

        assert!(mask_from_class_map(&classes, PersonPartMaskTarget::Clothing).is_err());
    }

    #[test]
    fn hair_mask_selects_hair_and_excludes_clothing() {
        let size = crate::ai::ai_processing::PERSON_PART_PARSER_INPUT_SIZE as usize;
        let mut classes = vec![PERSON_PART_BACKGROUND_CLASS; size * size];
        for y in 20..40 {
            for x in 20..40 {
                classes[y * size + x] = PERSON_PART_HAIR_CLASS;
            }
        }
        classes[40 * size + 20] = PERSON_PART_TOP_CLOTHES_CLASS;
        classes[41 * size + 20] = PERSON_PART_BOTTOM_CLOTHES_CLASS;

        let mask = mask_from_class_map(&classes, PersonPartMaskTarget::Hair).unwrap();

        assert_eq!(mask.get_pixel(20, 20)[0], 255);
        assert_eq!(mask.get_pixel(20, 40)[0], 0);
        assert_eq!(mask.get_pixel(20, 41)[0], 0);
    }

    #[test]
    fn clothing_provenance_names_model_and_classes() {
        let provenance = person_part_parser_provenance(PersonPartMaskTarget::Clothing);

        assert_eq!(provenance.target_part, "clothing");
        assert_eq!(provenance.model_id, PERSON_PART_PARSER_MODEL_ID);
        assert_eq!(provenance.class_ids, vec![5, 9]);
    }

    #[test]
    fn hair_provenance_names_model_and_class() {
        let provenance = person_part_parser_provenance(PersonPartMaskTarget::Hair);

        assert_eq!(provenance.target_part, "hair");
        assert_eq!(provenance.model_id, PERSON_PART_PARSER_MODEL_ID);
        assert_eq!(provenance.class_ids, vec![2]);
    }
}
