use half::f16;
use image::{DynamicImage, ImageBuffer, Rgba};

pub(crate) const RGBA16_FLOAT_BYTES_PER_PIXEL: u32 = 8;

pub(crate) fn read_texture_data_roi_with_bytes_per_pixel(
    device: &wgpu::Device,
    queue: &wgpu::Queue,
    texture: &wgpu::Texture,
    origin: wgpu::Origin3d,
    size: wgpu::Extent3d,
    bytes_per_pixel: u32,
) -> Result<Vec<u8>, String> {
    let unpadded_bytes_per_row = bytes_per_pixel * size.width;
    let align = wgpu::COPY_BYTES_PER_ROW_ALIGNMENT;
    let padded_bytes_per_row = (unpadded_bytes_per_row + align - 1) & !(align - 1);
    let output_buffer_size = (padded_bytes_per_row * size.height) as u64;

    let output_buffer = device.create_buffer(&wgpu::BufferDescriptor {
        label: Some("Readback Buffer"),
        size: output_buffer_size,
        usage: wgpu::BufferUsages::COPY_DST | wgpu::BufferUsages::MAP_READ,
        mapped_at_creation: false,
    });

    let mut encoder =
        device.create_command_encoder(&wgpu::CommandEncoderDescriptor { label: None });
    encoder.copy_texture_to_buffer(
        wgpu::TexelCopyTextureInfo {
            texture,
            mip_level: 0,
            origin,
            aspect: wgpu::TextureAspect::All,
        },
        wgpu::TexelCopyBufferInfo {
            buffer: &output_buffer,
            layout: wgpu::TexelCopyBufferLayout {
                offset: 0,
                bytes_per_row: Some(padded_bytes_per_row),
                rows_per_image: Some(size.height),
            },
        },
        size,
    );

    queue.submit(Some(encoder.finish()));
    let buffer_slice = output_buffer.slice(..);
    let (tx, rx) = std::sync::mpsc::channel();
    buffer_slice.map_async(wgpu::MapMode::Read, move |result| {
        let _ = tx.send(result);
    });
    device
        .poll(wgpu::PollType::Wait {
            submission_index: None,
            timeout: Some(std::time::Duration::from_secs(60)),
        })
        .map_err(|e| format!("Failed while polling mapped GPU buffer: {}", e))?;
    let map_result = rx
        .recv()
        .map_err(|e| format!("Failed receiving GPU map result: {}", e))?;
    map_result.map_err(|e| e.to_string())?;

    let padded_data = buffer_slice.get_mapped_range().to_vec();
    output_buffer.unmap();

    if padded_bytes_per_row == unpadded_bytes_per_row {
        Ok(padded_data)
    } else {
        let mut unpadded_data = Vec::with_capacity((unpadded_bytes_per_row * size.height) as usize);
        for chunk in padded_data.chunks(padded_bytes_per_row as usize) {
            unpadded_data.extend_from_slice(&chunk[..unpadded_bytes_per_row as usize]);
        }
        Ok(unpadded_data)
    }
}

pub(crate) fn rgba16float_readback_to_dynamic_image(
    width: u32,
    height: u32,
    pixels: Vec<u8>,
) -> Result<DynamicImage, String> {
    if pixels.len() != (width * height * RGBA16_FLOAT_BYTES_PER_PIXEL) as usize {
        return Err(format!(
            "Expected {} RGBA16F readback byte(s), got {}.",
            width * height * RGBA16_FLOAT_BYTES_PER_PIXEL,
            pixels.len()
        ));
    }

    let rgba16 = pixels
        .chunks_exact(2)
        .map(|bytes| {
            let channel = f16::from_bits(u16::from_le_bytes([bytes[0], bytes[1]])).to_f32();
            (channel.clamp(0.0, 1.0) * u16::MAX as f32).round() as u16
        })
        .collect::<Vec<_>>();
    let image =
        ImageBuffer::<Rgba<u16>, Vec<u16>>::from_raw(width, height, rgba16).ok_or_else(|| {
            "Failed to create RGBA16 image buffer from GPU readback data.".to_string()
        })?;
    Ok(DynamicImage::ImageRgba16(image))
}

pub(crate) fn rgba16float_readback_to_unclamped_dynamic_image(
    width: u32,
    height: u32,
    pixels: Vec<u8>,
) -> Result<DynamicImage, String> {
    if pixels.len() != (width * height * RGBA16_FLOAT_BYTES_PER_PIXEL) as usize {
        return Err(format!(
            "Expected {} RGBA16F readback byte(s), got {}.",
            width * height * RGBA16_FLOAT_BYTES_PER_PIXEL,
            pixels.len()
        ));
    }

    let rgba32f = pixels
        .chunks_exact(2)
        .map(|bytes| f16::from_bits(u16::from_le_bytes([bytes[0], bytes[1]])).to_f32())
        .collect::<Vec<_>>();
    let image =
        ImageBuffer::<Rgba<f32>, Vec<f32>>::from_raw(width, height, rgba32f).ok_or_else(|| {
            "Failed to create RGBA32F image buffer from GPU readback data.".to_string()
        })?;
    Ok(DynamicImage::ImageRgba32F(image))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn unclamped_rgba16float_readback_preserves_out_of_gamut_values() {
        let values = [-0.25_f32, 0.5, 1.35, 1.0];
        let pixels = values
            .into_iter()
            .flat_map(|value| f16::from_f32(value).to_bits().to_le_bytes())
            .collect::<Vec<_>>();

        let image = rgba16float_readback_to_unclamped_dynamic_image(1, 1, pixels)
            .expect("RGBA16F readback should convert to RGBA32F");
        let DynamicImage::ImageRgba32F(image) = image else {
            panic!("unclamped readback should return RGBA32F");
        };
        let pixel = image.get_pixel(0, 0).0;

        assert!(pixel[0] < 0.0);
        assert_eq!(pixel[1], 0.5);
        assert!(pixel[2] > 1.0);
        assert_eq!(pixel[3], 1.0);
    }
}
