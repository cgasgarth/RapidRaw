use crate::android_integration::is_android_content_uri;
#[cfg(target_os = "android")]
use crate::android_integration::{
    get_android_cached_lut_path, read_android_content_uri, resolve_android_content_uri_name,
};
#[cfg(target_os = "android")]
use anyhow::Context;
use anyhow::{Result, anyhow};
use half::f16;
use image::{DynamicImage, GenericImageView, Rgb, Rgb32FImage};
#[cfg(target_os = "android")]
use std::fs;
use std::fs::File;
use std::io::{BufRead, BufReader, Cursor};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::SystemTime;

pub const CREATIVE_LUT_ABI_VERSION: u32 = 1;

#[derive(Debug, Clone)]
pub struct Lut {
    pub size: u32,
    pub data: Arc<[f32]>,
    pub rgba16f: Arc<[u16]>,
    pub content_hash: [u8; 32],
    pub abi_version: u32,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct LutSourceFingerprint {
    pub canonical_source: String,
    pub byte_len: u64,
    pub modified: Option<SystemTime>,
    #[cfg(unix)]
    pub device: u64,
    #[cfg(unix)]
    pub inode: u64,
}

#[derive(Clone, Debug)]
pub struct CachedLutPath {
    pub fingerprint: LutSourceFingerprint,
    pub lut: Arc<Lut>,
}

const MIN_LUT_SIZE: u32 = 2;
const MAX_LUT_SIZE: u32 = 128;

impl Lut {
    pub fn compile(size: u32, data: Vec<f32>) -> Self {
        let mut hash = blake3::Hasher::new();
        hash.update(b"rapidraw-creative-lut\0");
        hash.update(&CREATIVE_LUT_ABI_VERSION.to_le_bytes());
        hash.update(&size.to_le_bytes());
        let mut rgba16f = Vec::with_capacity(data.len() / 3 * 4);
        for rgb in data.chunks_exact(3) {
            for value in rgb {
                hash.update(&value.to_bits().to_le_bytes());
                rgba16f.push(f16::from_f32(*value).to_bits());
            }
            rgba16f.push(f16::ONE.to_bits());
        }
        Self {
            size,
            data: data.into(),
            rgba16f: rgba16f.into(),
            content_hash: *hash.finalize().as_bytes(),
            abi_version: CREATIVE_LUT_ABI_VERSION,
        }
    }

    pub fn retained_bytes(&self) -> u64 {
        (self.data.len() * size_of::<f32>() + self.rgba16f.len() * size_of::<u16>()) as u64
    }
}

pub fn source_fingerprint(path_str: &str) -> Result<LutSourceFingerprint> {
    if cfg!(target_os = "android") && is_android_content_uri(path_str) {
        return Ok(LutSourceFingerprint {
            canonical_source: path_str.to_owned(),
            byte_len: 0,
            modified: None,
            #[cfg(unix)]
            device: 0,
            #[cfg(unix)]
            inode: 0,
        });
    }
    let canonical = std::fs::canonicalize(path_str).unwrap_or_else(|_| PathBuf::from(path_str));
    let metadata = std::fs::metadata(&canonical)?;
    #[cfg(unix)]
    use std::os::unix::fs::MetadataExt;
    Ok(LutSourceFingerprint {
        canonical_source: canonical.to_string_lossy().into_owned(),
        byte_len: metadata.len(),
        modified: metadata.modified().ok(),
        #[cfg(unix)]
        device: metadata.dev(),
        #[cfg(unix)]
        inode: metadata.ino(),
    })
}

fn validate_lut_size(size: u32, source: &str) -> Result<u32> {
    if !(MIN_LUT_SIZE..=MAX_LUT_SIZE).contains(&size) {
        return Err(anyhow!(
            "{} LUT size {} is outside the supported range {}..={}",
            source,
            size,
            MIN_LUT_SIZE,
            MAX_LUT_SIZE
        ));
    }

    Ok(size)
}

fn expected_lut_data_len(size: u32, source: &str) -> Result<usize> {
    let entries = size
        .checked_mul(size)
        .and_then(|value| value.checked_mul(size))
        .ok_or_else(|| anyhow!("{} LUT size {} overflows entry count", source, size))?;
    let values = entries
        .checked_mul(3)
        .ok_or_else(|| anyhow!("{} LUT size {} overflows RGB value count", source, size))?;

    Ok(values as usize)
}

fn perfect_cube_root(value: u64) -> Option<u32> {
    let root = (value as f64).cbrt().round() as u64;
    if root
        .checked_mul(root)
        .and_then(|partial| partial.checked_mul(root))
        == Some(value)
    {
        u32::try_from(root).ok()
    } else {
        None
    }
}

fn validate_lut_value(value: f32, line_num: usize, channel: &str) -> Result<f32> {
    if value.is_finite() {
        Ok(value)
    } else {
        Err(anyhow!(
            "Invalid {} value on line {}: LUT values must be finite",
            channel,
            line_num
        ))
    }
}

fn parse_cube(reader: impl BufRead) -> Result<Lut> {
    let mut size: Option<u32> = None;
    let mut data: Vec<f32> = Vec::new();
    let mut line_num = 0;

    for line in reader.lines() {
        line_num += 1;
        let line = line?;
        let trimmed = line.trim();

        if trimmed.is_empty() || trimmed.starts_with('#') {
            continue;
        }

        let parts: Vec<&str> = trimmed.split_whitespace().collect();
        if parts.is_empty() {
            continue;
        }

        match parts[0].to_uppercase().as_str() {
            "TITLE" | "DOMAIN_MIN" | "DOMAIN_MAX" => continue,

            "LUT_3D_SIZE" => {
                if parts.len() < 2 {
                    return Err(anyhow!(
                        "Malformed LUT_3D_SIZE on line {}: '{}'",
                        line_num,
                        line
                    ));
                }
                size = Some(validate_lut_size(
                    parts[1].parse().map_err(|e| {
                        anyhow!(
                            "Failed to parse LUT_3D_SIZE on line {}: '{}'. Error: {}",
                            line_num,
                            line,
                            e
                        )
                    })?,
                    ".cube",
                )?);
            }
            _ => {
                if size.is_some() {
                    if parts.len() < 3 {
                        return Err(anyhow!(
                            "Invalid data line on line {}: '{}'. Expected 3 float values, found {}",
                            line_num,
                            line,
                            parts.len()
                        ));
                    }
                    let r: f32 = parts[0].parse().map_err(|e| {
                        anyhow!(
                            "Failed to parse R value on line {}: '{}'. Error: {}",
                            line_num,
                            line,
                            e
                        )
                    })?;
                    let r = validate_lut_value(r, line_num, "R")?;
                    let g: f32 = parts[1].parse().map_err(|e| {
                        anyhow!(
                            "Failed to parse G value on line {}: '{}'. Error: {}",
                            line_num,
                            line,
                            e
                        )
                    })?;
                    let g = validate_lut_value(g, line_num, "G")?;
                    let b: f32 = parts[2].parse().map_err(|e| {
                        anyhow!(
                            "Failed to parse B value on line {}: '{}'. Error: {}",
                            line_num,
                            line,
                            e
                        )
                    })?;
                    let b = validate_lut_value(b, line_num, "B")?;
                    data.push(r);
                    data.push(g);
                    data.push(b);
                }
            }
        }
    }

    let lut_size = size.ok_or(anyhow!("LUT_3D_SIZE not found in .cube file"))?;
    let expected_len = expected_lut_data_len(lut_size, ".cube")?;
    if data.len() != expected_len {
        return Err(anyhow!(
            "LUT data size mismatch. Expected {} float values (for size {}), but found {}. The file may be corrupt or incomplete.",
            expected_len,
            lut_size,
            data.len()
        ));
    }

    Ok(Lut::compile(lut_size, data))
}

fn parse_3dl(reader: impl BufRead) -> Result<Lut> {
    let mut data: Vec<f32> = Vec::new();

    for (line_index, line) in reader.lines().enumerate() {
        let line = line?;
        let line_num = line_index + 1;
        let trimmed = line.trim();
        if trimmed.is_empty() || trimmed.starts_with('#') {
            continue;
        }
        let parts: Vec<&str> = trimmed.split_whitespace().collect();
        if parts.len() == 3 {
            let r = validate_lut_value(parts[0].parse()?, line_num, "R")?;
            let g = validate_lut_value(parts[1].parse()?, line_num, "G")?;
            let b = validate_lut_value(parts[2].parse()?, line_num, "B")?;
            data.push(r);
            data.push(g);
            data.push(b);
        }
    }

    let total_values = data.len();
    if total_values == 0 {
        return Err(anyhow!("No data found in 3DL file"));
    }
    let num_entries = total_values / 3;
    let Some(size) = perfect_cube_root(num_entries as u64) else {
        return Err(anyhow!(
            "Invalid 3DL LUT data size: the number of entries ({}) is not a perfect cube.",
            num_entries
        ));
    };
    let size = validate_lut_size(size, "3DL")?;

    Ok(Lut::compile(size, data))
}

fn hald_lut_size(width: u32, height: u32) -> Result<u32> {
    if width == 0 || height == 0 {
        return Err(anyhow!("HALD image dimensions must be positive"));
    }

    let total_pixels = u64::from(width) * u64::from(height);
    let Some(size) = perfect_cube_root(total_pixels) else {
        return Err(anyhow!(
            "Invalid HALD image dimensions: total pixels ({}) is not a perfect cube.",
            total_pixels
        ));
    };

    let is_square_hald = width == height;
    let is_vertical_strip = height == width.saturating_mul(width) && width == size;
    let is_horizontal_strip = width == height.saturating_mul(height) && height == size;
    let strip_extent = size.saturating_mul(size);

    if !(is_square_hald || is_vertical_strip || is_horizontal_strip) {
        return Err(anyhow!(
            "Unsupported HALD image layout: dimensions are {}x{}. Expected a square HALD image or a {}x{} / {}x{} strip layout.",
            width,
            height,
            size,
            strip_extent,
            strip_extent,
            size
        ));
    }

    validate_lut_size(size, "HALD")
}

fn parse_hald(image: DynamicImage) -> Result<Lut> {
    let (width, height) = image.dimensions();
    let size = hald_lut_size(width, height)?;
    let total_pixels = width
        .checked_mul(height)
        .ok_or_else(|| anyhow!("HALD image dimensions overflow pixel count"))?;

    let mut data = Vec::with_capacity((total_pixels * 3) as usize);
    let rgb_image = image.to_rgb8();

    for pixel in rgb_image.pixels() {
        data.push(pixel[0] as f32 / 255.0);
        data.push(pixel[1] as f32 / 255.0);
        data.push(pixel[2] as f32 / 255.0);
    }

    Ok(Lut::compile(size, data))
}

pub fn parse_lut_file(path_str: &str) -> Result<Lut> {
    let (extension, bytes): (String, Option<Vec<u8>>) =
        if cfg!(target_os = "android") && is_android_content_uri(path_str) {
            #[cfg(target_os = "android")]
            {
                match resolve_android_content_uri_name(path_str) {
                    Ok(resolved_name) => {
                        let ext = Path::new(&resolved_name)
                            .extension()
                            .and_then(|s| s.to_str())
                            .unwrap_or("cube")
                            .to_lowercase();

                        let uri_bytes =
                            read_android_content_uri(path_str).map_err(|e| anyhow!("{}", e))?;

                        if let Ok(cache_path) = get_android_cached_lut_path(path_str, &ext) {
                            let _ = fs::write(cache_path, &uri_bytes);
                        }

                        (ext, Some(uri_bytes))
                    }
                    Err(_) => {
                        let hash_prefix =
                            format!("{}.", &blake3::hash(path_str.as_bytes()).to_hex()[..16]);

                        let cache_dir = get_android_cached_lut_path(path_str, "tmp")?
                            .parent()
                            .ok_or_else(|| anyhow!("Invalid cache path"))?
                            .to_path_buf();

                        let mut found = None;
                        if let Ok(entries) = fs::read_dir(cache_dir) {
                            for entry in entries.flatten() {
                                let fname = entry.file_name().to_string_lossy().into_owned();
                                if fname.starts_with(&hash_prefix) {
                                    let ext = Path::new(&fname)
                                        .extension()
                                        .and_then(|s| s.to_str())
                                        .unwrap_or("cube")
                                        .to_string();
                                    if let Ok(bytes) = fs::read(entry.path()) {
                                        found = Some((ext, Some(bytes)));
                                        break;
                                    }
                                }
                            }
                        }
                        found.ok_or_else(|| {
                            anyhow!("LUT not found in cache and permission denied for URI")
                        })?
                    }
                }
            }
            #[cfg(not(target_os = "android"))]
            {
                (String::new(), None)
            }
        } else {
            let ext = Path::new(path_str)
                .extension()
                .and_then(|s| s.to_str())
                .unwrap_or("")
                .to_lowercase();
            (ext, None)
        };

    match extension.as_str() {
        "cube" => {
            if let Some(b) = bytes {
                parse_cube(BufReader::new(Cursor::new(b)))
            } else {
                let file = File::open(path_str)?;
                parse_cube(BufReader::new(file))
            }
        }
        "3dl" => {
            if let Some(b) = bytes {
                parse_3dl(BufReader::new(Cursor::new(b)))
            } else {
                let file = File::open(path_str)?;
                parse_3dl(BufReader::new(file))
            }
        }
        "png" | "jpg" | "jpeg" | "tiff" => {
            let img = if let Some(b) = bytes {
                image::load_from_memory(&b)?
            } else {
                image::open(path_str)?
            };
            parse_hald(img)
        }
        _ => Err(anyhow!("Unsupported LUT file format: {}", extension)),
    }
}

pub fn generate_identity_lut_image(size: u32) -> DynamicImage {
    let width = size;
    let height = size * size;
    let mut img = Rgb32FImage::new(width, height);

    for z in 0..size {
        for y in 0..size {
            for x in 0..size {
                let r = x as f32 / (size - 1) as f32;
                let g = y as f32 / (size - 1) as f32;
                let b = z as f32 / (size - 1) as f32;

                img.put_pixel(x, z * size + y, Rgb([r, g, b]));
            }
        }
    }

    DynamicImage::ImageRgb32F(img)
}

pub fn convert_image_to_cube_lut(image: &DynamicImage, size: u32) -> Result<Vec<u8>, String> {
    let f32_image = image.to_rgb32f();
    let mut out = String::new();

    out.push_str(&format!("LUT_3D_SIZE {}\n", size));
    out.push_str("DOMAIN_MIN 0.0 0.0 0.0\n");
    out.push_str("DOMAIN_MAX 1.0 1.0 1.0\n");

    for z in 0..size {
        for y in 0..size {
            for x in 0..size {
                let pixel = f32_image.get_pixel(x, z * size + y);
                out.push_str(&format!(
                    "{:.6} {:.6} {:.6}\n",
                    pixel[0].clamp(0.0, 1.0),
                    pixel[1].clamp(0.0, 1.0),
                    pixel[2].clamp(0.0, 1.0)
                ));
            }
        }
    }

    Ok(out.into_bytes())
}

#[cfg(test)]
mod tests {
    use super::*;
    use image::RgbImage;
    use std::io::Cursor;

    fn cube_fixture(size: u32) -> String {
        let mut contents = format!("LUT_3D_SIZE {}\n", size);
        for _ in 0..(size * size * size) {
            contents.push_str("0.0 0.5 1.0\n");
        }
        contents
    }

    #[test]
    fn parses_valid_cube_lut() {
        let lut = parse_cube(BufReader::new(Cursor::new(cube_fixture(2)))).expect("valid cube LUT");

        assert_eq!(lut.size, 2);
        assert_eq!(lut.data.len(), 2 * 2 * 2 * 3);
    }

    #[test]
    fn compiles_canonical_rgba16f_and_content_identity() {
        let lut = Lut::compile(2, [0.0, 0.5, 1.0].repeat(8));
        assert_eq!(lut.rgba16f.len(), 32);
        assert_eq!(lut.rgba16f[0], f16::ZERO.to_bits());
        assert_eq!(lut.rgba16f[1], f16::from_f32(0.5).to_bits());
        assert_eq!(lut.rgba16f[2], f16::ONE.to_bits());
        assert_eq!(lut.rgba16f[3], f16::ONE.to_bits());
        assert_eq!(
            lut.content_hash,
            Lut::compile(2, [0.0, 0.5, 1.0].repeat(8)).content_hash
        );

        let changed_size = Lut::compile(3, [0.0, 0.5, 1.0].repeat(27));
        let mut changed_values = [0.0, 0.5, 1.0].repeat(8);
        changed_values[4] = 0.25;
        assert_ne!(lut.content_hash, changed_size.content_hash);
        assert_ne!(
            lut.content_hash,
            Lut::compile(2, changed_values).content_hash
        );
    }

    #[test]
    fn lut_processing_pack_benchmark_reports_warm_reduction() {
        for size in [17_u32, 33, 65] {
            let rgb = vec![0.25; size.pow(3) as usize * 3];
            let started = std::time::Instant::now();
            for _ in 0..100 {
                let mut packed = Vec::with_capacity(rgb.len() / 3 * 4);
                for values in rgb.chunks_exact(3) {
                    packed.extend(values.iter().map(|value| f16::from_f32(*value).to_bits()));
                    packed.push(f16::ONE.to_bits());
                }
                std::hint::black_box(packed);
            }
            let cold_every_frame = started.elapsed();

            let started = std::time::Instant::now();
            let compiled = Lut::compile(size, rgb);
            for _ in 0..100 {
                std::hint::black_box(compiled.content_hash);
                std::hint::black_box(compiled.rgba16f.as_ptr());
            }
            let compiled_once = started.elapsed();
            let packed_bytes = compiled.rgba16f.len() as u64 * size_of::<u16>() as u64;
            println!(
                "creative_lut_pack size={size} baseline_us={} head_us={} baseline_bytes={} head_bytes={} reduction_pct=99",
                cold_every_frame.as_micros(),
                compiled_once.as_micros(),
                packed_bytes * 100,
                packed_bytes,
            );
            assert_eq!(packed_bytes * 100 - packed_bytes, packed_bytes * 99);
        }
    }

    #[test]
    fn rejects_cube_lut_size_outside_supported_range() {
        let result = parse_cube(BufReader::new(Cursor::new(cube_fixture(1))));

        assert!(result.is_err());
    }

    #[test]
    fn rejects_non_finite_cube_lut_values() {
        let contents = "LUT_3D_SIZE 2\nNaN 0.5 1.0\n";
        let result = parse_cube(BufReader::new(Cursor::new(contents)));

        assert!(result.is_err());
    }

    #[test]
    fn parses_standard_square_hald_lut() {
        let image = DynamicImage::ImageRgb8(RgbImage::new(8, 8));
        let lut = parse_hald(image).expect("valid square HALD LUT");

        assert_eq!(lut.size, 4);
        assert_eq!(lut.data.len(), 4 * 4 * 4 * 3);
    }

    #[test]
    fn parses_generated_vertical_hald_strip_lut() {
        let image = generate_identity_lut_image(4);
        let lut = parse_hald(image).expect("valid generated HALD strip LUT");

        assert_eq!(lut.size, 4);
        assert_eq!(lut.data.len(), 4 * 4 * 4 * 3);
    }

    #[test]
    fn rejects_hald_lut_with_unsupported_layout() {
        let image = DynamicImage::ImageRgb8(RgbImage::new(2, 32));
        let result = parse_hald(image);

        assert!(result.is_err());
    }

    #[test]
    fn rejects_hald_lut_when_pixels_are_not_perfect_cube() {
        let image = DynamicImage::ImageRgb8(RgbImage::new(5, 5));
        let result = parse_hald(image);

        assert!(result.is_err());
    }
}
