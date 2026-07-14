/// Stable ownership identity for intermediate render textures.
///
/// Keeping format and usage together prevents a call site from silently
/// allocating an output texture with a descriptor that does not match the
/// downstream compute/readback contract.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum GpuIntermediateTexture {
    Tile,
    Working,
    Full,
}

impl GpuIntermediateTexture {
    pub(crate) const fn label(self) -> &'static str {
        match self {
            Self::Tile => "Tile Output Texture",
            Self::Working => "Working Output Texture",
            Self::Full => "Full Output Texture",
        }
    }

    pub(crate) const fn format(self) -> wgpu::TextureFormat {
        wgpu::TextureFormat::Rgba16Float
    }

    pub(crate) fn usage(self) -> wgpu::TextureUsages {
        match self {
            Self::Tile => {
                wgpu::TextureUsages::TEXTURE_BINDING
                    | wgpu::TextureUsages::STORAGE_BINDING
                    | wgpu::TextureUsages::COPY_SRC
            }
            Self::Working | Self::Full => {
                wgpu::TextureUsages::TEXTURE_BINDING
                    | wgpu::TextureUsages::STORAGE_BINDING
                    | wgpu::TextureUsages::COPY_DST
                    | wgpu::TextureUsages::COPY_SRC
            }
        }
    }
}

pub(crate) fn validate_intermediate_texture_identity(
    role: GpuIntermediateTexture,
    format: wgpu::TextureFormat,
    usage: wgpu::TextureUsages,
) -> Result<(), &'static str> {
    (role.format() == format && role.usage() == usage)
        .then_some(())
        .ok_or("gpu.intermediate_texture_identity_mismatch")
}

pub(crate) fn create_owned_rgba16f_texture_with_view(
    device: &wgpu::Device,
    role: GpuIntermediateTexture,
    size: wgpu::Extent3d,
) -> Result<(wgpu::Texture, wgpu::TextureView), &'static str> {
    let format = role.format();
    let usage = role.usage();
    validate_intermediate_texture_identity(role, format, usage)?;
    Ok(create_texture_with_view(
        device,
        role.label(),
        size,
        format,
        usage,
    ))
}

pub(crate) fn create_rgba16f_texture_with_view(
    device: &wgpu::Device,
    label: &'static str,
    size: wgpu::Extent3d,
    usage: wgpu::TextureUsages,
) -> (wgpu::Texture, wgpu::TextureView) {
    create_texture_with_view(device, label, size, wgpu::TextureFormat::Rgba16Float, usage)
}

fn create_texture_with_view(
    device: &wgpu::Device,
    label: &'static str,
    size: wgpu::Extent3d,
    format: wgpu::TextureFormat,
    usage: wgpu::TextureUsages,
) -> (wgpu::Texture, wgpu::TextureView) {
    let texture = device.create_texture(&wgpu::TextureDescriptor {
        label: Some(label),
        size,
        mip_level_count: 1,
        sample_count: 1,
        dimension: wgpu::TextureDimension::D2,
        format,
        usage,
        view_formats: &[],
    });
    let view = texture.create_view(&Default::default());
    (texture, view)
}

pub(crate) fn create_dummy_rgba16f_texture_view(device: &wgpu::Device) -> wgpu::TextureView {
    let (_, view) = create_rgba16f_texture_with_view(
        device,
        "Dummy Texture",
        wgpu::Extent3d {
            width: 1,
            height: 1,
            depth_or_array_layers: 1,
        },
        wgpu::TextureUsages::TEXTURE_BINDING,
    );
    view
}

pub(crate) fn create_dummy_lut_texture_view(device: &wgpu::Device) -> wgpu::TextureView {
    let texture = device.create_texture(&wgpu::TextureDescriptor {
        label: Some("Dummy LUT Texture"),
        size: wgpu::Extent3d {
            width: 1,
            height: 1,
            depth_or_array_layers: 1,
        },
        mip_level_count: 1,
        sample_count: 1,
        dimension: wgpu::TextureDimension::D3,
        format: wgpu::TextureFormat::Rgba16Float,
        usage: wgpu::TextureUsages::TEXTURE_BINDING,
        view_formats: &[],
    });
    texture.create_view(&Default::default())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn intermediate_texture_registry_keeps_output_roles_distinct() {
        let tile_usage = wgpu::TextureUsages::TEXTURE_BINDING
            | wgpu::TextureUsages::STORAGE_BINDING
            | wgpu::TextureUsages::COPY_SRC;
        let display_usage = tile_usage | wgpu::TextureUsages::COPY_DST;
        assert_ne!(
            GpuIntermediateTexture::Tile.usage(),
            GpuIntermediateTexture::Working.usage()
        );
        assert_eq!(GpuIntermediateTexture::Tile.usage(), tile_usage);
        assert_eq!(GpuIntermediateTexture::Working.usage(), display_usage);
        assert_eq!(GpuIntermediateTexture::Full.usage(), display_usage);
        assert_eq!(
            GpuIntermediateTexture::Tile.format(),
            wgpu::TextureFormat::Rgba16Float
        );
    }

    #[test]
    fn intermediate_texture_identity_rejects_runtime_descriptor_drift() {
        let role = GpuIntermediateTexture::Working;
        assert_eq!(
            validate_intermediate_texture_identity(role, role.format(), role.usage()),
            Ok(())
        );
        assert_eq!(
            validate_intermediate_texture_identity(
                role,
                wgpu::TextureFormat::Rgba8Unorm,
                role.usage()
            ),
            Err("gpu.intermediate_texture_identity_mismatch")
        );
        assert_eq!(
            validate_intermediate_texture_identity(
                GpuIntermediateTexture::Tile,
                GpuIntermediateTexture::Tile.format(),
                GpuIntermediateTexture::Working.usage()
            ),
            Err("gpu.intermediate_texture_identity_mismatch")
        );
    }
}
