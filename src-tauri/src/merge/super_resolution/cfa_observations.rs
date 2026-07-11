use super::raw_frame::{CfaClass, SuperResolutionRawFrame};
use super::registration::SuperResolutionRegistrationTransform;

#[derive(Clone, Copy, Debug)]
pub struct SceneRect {
    pub height: u32,
    pub left: f32,
    pub top: f32,
    pub width: u32,
}

#[derive(Clone, Copy, Debug)]
pub struct CfaObservation {
    pub class: CfaClass,
    pub confidence: f32,
    pub green_gradient_x: f32,
    pub green_gradient_y: f32,
    pub scene_x: f32,
    pub scene_y: f32,
    pub sensor_x: u32,
    pub sensor_y: u32,
    pub source_index: usize,
    pub value: f32,
    pub variance: f32,
}

pub fn common_overlap(
    frames: &[SuperResolutionRawFrame],
    transforms: &[SuperResolutionRegistrationTransform],
) -> Result<SceneRect, String> {
    let mut left = f32::NEG_INFINITY;
    let mut top = f32::NEG_INFINITY;
    let mut right = f32::INFINITY;
    let mut bottom = f32::INFINITY;
    for transform in transforms {
        let frame = frames
            .iter()
            .find(|frame| frame.source.source_index == transform.source_index)
            .ok_or_else(|| "registration_source_identity_mismatch".to_string())?;
        let corners = [
            map_point(transform, 0.5, 0.5, frame.sensor.width, frame.sensor.height),
            map_point(
                transform,
                frame.sensor.width as f32 - 0.5,
                0.5,
                frame.sensor.width,
                frame.sensor.height,
            ),
            map_point(
                transform,
                0.5,
                frame.sensor.height as f32 - 0.5,
                frame.sensor.width,
                frame.sensor.height,
            ),
            map_point(
                transform,
                frame.sensor.width as f32 - 0.5,
                frame.sensor.height as f32 - 0.5,
                frame.sensor.width,
                frame.sensor.height,
            ),
        ];
        let source_left = corners
            .iter()
            .map(|point| point.0)
            .fold(f32::INFINITY, f32::min);
        let source_top = corners
            .iter()
            .map(|point| point.1)
            .fold(f32::INFINITY, f32::min);
        let source_right = corners
            .iter()
            .map(|point| point.0)
            .fold(f32::NEG_INFINITY, f32::max);
        let source_bottom = corners
            .iter()
            .map(|point| point.1)
            .fold(f32::NEG_INFINITY, f32::max);
        left = left.max(source_left.ceil());
        top = top.max(source_top.ceil());
        right = right.min(source_right.floor());
        bottom = bottom.min(source_bottom.floor());
    }
    if !left.is_finite() || right <= left || bottom <= top {
        return Err("empty_registration_common_overlap".to_string());
    }
    Ok(SceneRect {
        height: (bottom - top) as u32,
        left,
        top,
        width: (right - left) as u32,
    })
}

pub fn stream_observations(
    frames: &[SuperResolutionRawFrame],
    transforms: &[SuperResolutionRegistrationTransform],
    overlap: SceneRect,
    mut visit: impl FnMut(CfaObservation),
) -> Result<(), String> {
    for transform in transforms {
        let frame = frames
            .iter()
            .find(|frame| frame.source.source_index == transform.source_index)
            .ok_or_else(|| "registration_source_identity_mismatch".to_string())?;
        for y in 0..frame.sensor.height {
            for x in 0..frame.sensor.width {
                let index = y * frame.sensor.width + x;
                if !frame.sensor.valid[index] {
                    continue;
                }
                let (scene_x, scene_y) = map_point(
                    transform,
                    x as f32 + 0.5,
                    y as f32 + 0.5,
                    frame.sensor.width,
                    frame.sensor.height,
                );
                if scene_x < overlap.left
                    || scene_y < overlap.top
                    || scene_x >= overlap.left + overlap.width as f32
                    || scene_y >= overlap.top + overlap.height as f32
                {
                    continue;
                }
                let (green_gradient_x, green_gradient_y) = proxy_gradient(frame, x, y);
                visit(CfaObservation {
                    class: frame.sensor.classes[index],
                    confidence: transform.confidence,
                    green_gradient_x,
                    green_gradient_y,
                    scene_x,
                    scene_y,
                    sensor_x: x as u32,
                    sensor_y: y as u32,
                    source_index: frame.source.source_index,
                    value: frame.sensor.values[index],
                    variance: frame.sensor.variances[index],
                });
            }
        }
    }
    Ok(())
}

fn proxy_gradient(frame: &SuperResolutionRawFrame, sensor_x: usize, sensor_y: usize) -> (f32, f32) {
    if frame.proxy.width < 3 || frame.proxy.height < 3 {
        return (0.0, 0.0);
    }
    let scale = frame.proxy.proxy_pixel_scale.max(1.0);
    let x =
        ((sensor_x as f32 / scale).floor() as usize).clamp(1, frame.proxy.width.saturating_sub(2));
    let y =
        ((sensor_y as f32 / scale).floor() as usize).clamp(1, frame.proxy.height.saturating_sub(2));
    let index = y * frame.proxy.width + x;
    (
        (frame.proxy.values[index + 1] - frame.proxy.values[index - 1]) * 0.5,
        (frame.proxy.values[index + frame.proxy.width]
            - frame.proxy.values[index - frame.proxy.width])
            * 0.5,
    )
}

fn map_point(
    transform: &SuperResolutionRegistrationTransform,
    x: f32,
    y: f32,
    width: usize,
    height: usize,
) -> (f32, f32) {
    let angle = transform.rotation_degrees.to_radians();
    let (sin, cos) = angle.sin_cos();
    let local_x = x - width as f32 * 0.5;
    let local_y = y - height as f32 * 0.5;
    (
        cos.mul_add(local_x, -sin * local_y) + width as f32 * 0.5 + transform.translation_x_px,
        sin.mul_add(local_x, cos * local_y) + height as f32 * 0.5 + transform.translation_y_px,
    )
}
