use serde::Serialize;
#[cfg(not(any(target_os = "android", target_os = "linux")))]
use std::sync::{Mutex, OnceLock};

#[cfg(not(any(target_os = "android", target_os = "linux")))]
static DISPLAY_SELECTION: OnceLock<Mutex<(Option<String>, u64)>> = OnceLock::new();

#[cfg(not(any(target_os = "android", target_os = "linux")))]
pub const DISPLAY_TRANSFORM_IMPLEMENTATION_VERSION: &str = "rapidraw-display-preview-v2";

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ActiveDisplayProfile {
    pub cmm: String,
    pub display_id: Option<u32>,
    pub icc_sha256: Option<String>,
    pub profile_byte_count: Option<usize>,
    pub source: String,
    pub status: ActiveDisplayProfileStatus,
    pub fallback_reason: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DisplayPreviewLutStatus {
    pub profile: ActiveDisplayProfile,
    pub sample_count: usize,
    pub size: u32,
    pub status: DisplayPreviewLutTransformStatus,
}

#[derive(Clone, Copy, Debug, Serialize)]
#[serde(rename_all = "snake_case")]
#[allow(dead_code)]
pub enum ActiveDisplayProfileStatus {
    ActiveProfileLoaded,
    FallbackNoActiveProfile,
    UnsupportedPlatform,
}

#[derive(Clone, Copy, Debug, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum DisplayPreviewLutTransformStatus {
    #[cfg(not(any(target_os = "android", target_os = "linux")))]
    ActiveDisplayTransform,
    #[cfg(not(any(target_os = "android", target_os = "linux")))]
    SrgbFallbackTransform,
    UnsupportedPlatform,
}

#[tauri::command]
pub fn get_active_display_profile(app: tauri::AppHandle) -> Result<ActiveDisplayProfile, String> {
    active_display_profile_for_app(&app)
}

#[tauri::command]
pub fn get_display_preview_lut_status(
    app: tauri::AppHandle,
) -> Result<DisplayPreviewLutStatus, String> {
    display_preview_lut_status_for_app(&app)
}

#[cfg(target_os = "macos")]
#[allow(dead_code)]
pub fn active_display_profile() -> Result<ActiveDisplayProfile, String> {
    let display_id = macos::main_display_id();
    active_display_profile_for_id(display_id)
}

#[cfg(target_os = "macos")]
pub fn active_display_profile_for_app(
    app: &tauri::AppHandle,
) -> Result<ActiveDisplayProfile, String> {
    active_display_profile_for_id(
        macos::display_id_for_app(app).unwrap_or_else(macos::main_display_id),
    )
}

#[cfg(target_os = "macos")]
fn active_display_profile_for_id(display_id: u32) -> Result<ActiveDisplayProfile, String> {
    let icc_bytes = macos::copy_display_profile_data(display_id)?;
    Ok(active_display_profile_from_bytes(display_id, &icc_bytes))
}

#[cfg(target_os = "macos")]
fn active_display_profile_from_bytes(display_id: u32, icc_bytes: &[u8]) -> ActiveDisplayProfile {
    ActiveDisplayProfile {
        cmm: "colorsync+lcms2".to_string(),
        display_id: Some(display_id),
        icc_sha256: Some(sha256_hex(icc_bytes)),
        profile_byte_count: Some(icc_bytes.len()),
        source: "ColorSyncProfileCreateWithDisplayID(active_window_display)".to_string(),
        status: ActiveDisplayProfileStatus::ActiveProfileLoaded,
        fallback_reason: None,
    }
}

#[cfg(not(target_os = "macos"))]
pub fn active_display_profile() -> Result<ActiveDisplayProfile, String> {
    Ok(ActiveDisplayProfile {
        cmm: "none".to_string(),
        display_id: None,
        icc_sha256: None,
        profile_byte_count: None,
        source: "unsupported_platform".to_string(),
        status: ActiveDisplayProfileStatus::UnsupportedPlatform,
        fallback_reason: Some("native_display_profile_unavailable_on_platform".to_string()),
    })
}

#[cfg(not(target_os = "macos"))]
pub fn active_display_profile_for_app(
    _app: &tauri::AppHandle,
) -> Result<ActiveDisplayProfile, String> {
    active_display_profile()
}

#[cfg(target_os = "macos")]
#[allow(dead_code)]
pub fn active_display_profile_bytes() -> Result<Vec<u8>, String> {
    macos::copy_display_profile_data(macos::main_display_id())
}

#[cfg(target_os = "macos")]
fn active_display_profile_bytes_for_id(display_id: u32) -> Result<Vec<u8>, String> {
    macos::copy_display_profile_data(display_id)
}

#[cfg(not(any(target_os = "android", target_os = "linux")))]
pub const DISPLAY_LUT_SIZE: u32 = 32;

#[cfg(not(any(target_os = "android", target_os = "linux")))]
#[derive(Clone)]
pub struct DisplayLut {
    pub profile: ActiveDisplayProfile,
    pub rgba16f: Vec<half::f16>,
    pub size: u32,
}

/// Everything needed to create one color-consistent preview artifact. Pixel conversion and
/// tagging must consume this same value; resolving either independently can mis-tag a frame.
#[cfg(not(any(target_os = "android", target_os = "linux")))]
#[derive(Clone)]
pub struct DisplayPreviewTransformSnapshot {
    pub selection_generation: u64,
    pub profile: ActiveDisplayProfile,
    pub icc_bytes: Vec<u8>,
    pub icc_sha256: String,
    pub lut: DisplayLut,
    pub intent: &'static str,
    pub black_point_compensation: bool,
    pub interpolation: &'static str,
    pub implementation_version: &'static str,
    pub encoding_contract: &'static str,
}

#[cfg(not(any(target_os = "android", target_os = "linux")))]
pub fn display_preview_transform_snapshot_for_app(
    app: &tauri::AppHandle,
) -> DisplayPreviewTransformSnapshot {
    let captured = (|| -> Result<(Option<u32>, Vec<u8>), String> {
        #[cfg(target_os = "macos")]
        {
            let display_id = macos::display_id_for_app(app).unwrap_or_else(macos::main_display_id);
            let bytes = active_display_profile_bytes_for_id(display_id)?;
            Ok((Some(display_id), bytes))
        }
        #[cfg(not(target_os = "macos"))]
        {
            Err("native_display_profile_unavailable".to_string())
        }
    })();
    display_preview_transform_snapshot_from_capture(captured)
}

#[cfg(not(any(target_os = "android", target_os = "linux")))]
fn display_preview_transform_snapshot_from_capture(
    captured: Result<(Option<u32>, Vec<u8>), String>,
) -> DisplayPreviewTransformSnapshot {
    let size = DISPLAY_LUT_SIZE;
    let resolved = captured.and_then(|(display_id, bytes)| {
        let profile = match display_id {
            #[cfg(target_os = "macos")]
            Some(id) => active_display_profile_from_bytes(id, &bytes),
            _ => ActiveDisplayProfile {
                cmm: "lcms2".to_string(),
                display_id,
                icc_sha256: Some(sha256_hex(&bytes)),
                profile_byte_count: Some(bytes.len()),
                source: "captured_display_profile".to_string(),
                status: ActiveDisplayProfileStatus::ActiveProfileLoaded,
                fallback_reason: None,
            },
        };
        let lut = build_srgb_to_display_profile_lut_with_size(&bytes, profile, size)?;
        validate_display_lut(&lut)?;
        Ok((lut, bytes))
    });
    let (lut, icc_bytes) = resolved.unwrap_or_else(|reason| {
        let bytes = moxcms::ColorProfile::new_srgb()
            .encode()
            .expect("built-in sRGB profile must encode");
        (fallback_display_lut(size, reason), bytes)
    });
    let icc_sha256 = sha256_hex(&icc_bytes);
    debug_assert_eq!(
        lut.profile.icc_sha256.as_deref().unwrap_or(&icc_sha256),
        icc_sha256
    );
    let selection_generation = display_selection_generation(&lut.profile, &icc_sha256);
    DisplayPreviewTransformSnapshot {
        selection_generation,
        profile: lut.profile.clone(),
        icc_bytes,
        icc_sha256,
        lut,
        intent: "relative_colorimetric",
        black_point_compensation: true,
        interpolation: "trilinear_rgba16f",
        implementation_version: DISPLAY_TRANSFORM_IMPLEMENTATION_VERSION,
        encoding_contract: "pixels_and_jpeg_icc_from_same_snapshot",
    }
}

#[cfg(not(any(target_os = "android", target_os = "linux")))]
fn display_selection_generation(profile: &ActiveDisplayProfile, hash: &str) -> u64 {
    let key = format!("{:?}:{hash}", profile.display_id);
    let mut selection = DISPLAY_SELECTION
        .get_or_init(|| Mutex::new((None, 0)))
        .lock()
        .unwrap();
    if selection.0.as_deref() != Some(&key) {
        selection.0 = Some(key);
        selection.1 += 1;
    }
    selection.1
}

#[cfg(not(any(target_os = "android", target_os = "linux")))]
fn validate_display_lut(lut: &DisplayLut) -> Result<(), String> {
    for &gray in &[0.0, 0.18, 0.5, 0.75, 1.0] {
        let rgb = lut.sample_rgb([gray; 3]);
        if !rgb.iter().all(|value| value.is_finite()) {
            return Err("display_transform_non_finite_sample".to_string());
        }
        let chroma = rgb.iter().copied().fold(f32::NEG_INFINITY, f32::max)
            - rgb.iter().copied().fold(f32::INFINITY, f32::min);
        if chroma > 0.12 {
            return Err("display_transform_neutral_axis_chroma_guard".to_string());
        }
    }
    let black = lut.sample_rgb([0.0; 3]);
    let white = lut.sample_rgb([1.0; 3]);
    if black
        .iter()
        .zip(white)
        .any(|(low, high)| *low > high + 0.01)
    {
        return Err("display_transform_non_monotonic_endpoints".to_string());
    }
    Ok(())
}

#[cfg(not(any(target_os = "android", target_os = "linux")))]
impl DisplayLut {
    pub fn sample_rgb(&self, rgb: [f32; 3]) -> [f32; 3] {
        let max = (self.size - 1) as f32;
        let scaled = rgb.map(|channel| channel.clamp(0.0, 1.0) * max);
        let lo = scaled.map(|channel| channel.floor() as u32);
        let hi = lo.map(|index| (index + 1).min(self.size - 1));
        let mix = [
            scaled[0] - lo[0] as f32,
            scaled[1] - lo[1] as f32,
            scaled[2] - lo[2] as f32,
        ];
        let fetch = |r: u32, g: u32, b: u32, channel: usize| {
            let index = (((b * self.size + g) * self.size + r) * 4) as usize + channel;
            self.rgba16f[index].to_f32()
        };
        let mut out = [0.0; 3];
        for (channel, value) in out.iter_mut().enumerate() {
            let x00 = fetch(lo[0], lo[1], lo[2], channel) * (1.0 - mix[0])
                + fetch(hi[0], lo[1], lo[2], channel) * mix[0];
            let x10 = fetch(lo[0], hi[1], lo[2], channel) * (1.0 - mix[0])
                + fetch(hi[0], hi[1], lo[2], channel) * mix[0];
            let x01 = fetch(lo[0], lo[1], hi[2], channel) * (1.0 - mix[0])
                + fetch(hi[0], lo[1], hi[2], channel) * mix[0];
            let x11 = fetch(lo[0], hi[1], hi[2], channel) * (1.0 - mix[0])
                + fetch(hi[0], hi[1], hi[2], channel) * mix[0];
            let y0 = x00 * (1.0 - mix[1]) + x10 * mix[1];
            let y1 = x01 * (1.0 - mix[1]) + x11 * mix[1];
            *value = y0 * (1.0 - mix[2]) + y1 * mix[2];
        }
        out
    }
}

#[cfg(not(any(target_os = "android", target_os = "linux")))]
#[allow(dead_code)]
pub fn build_srgb_to_active_display_lut() -> DisplayLut {
    build_srgb_to_active_display_lut_with_size(DISPLAY_LUT_SIZE)
}

#[cfg(not(any(target_os = "android", target_os = "linux")))]
pub fn build_srgb_to_active_display_lut_for_app(app: &tauri::AppHandle) -> DisplayLut {
    let size = DISPLAY_LUT_SIZE;
    #[cfg(target_os = "macos")]
    if let Some(display_id) = macos::display_id_for_app(app) {
        return try_build_srgb_to_display_id_lut(size, display_id)
            .unwrap_or_else(|error| fallback_display_lut(size, error));
    }
    build_srgb_to_active_display_lut_with_size(size)
}

#[cfg(not(any(target_os = "android", target_os = "linux")))]
#[allow(dead_code)]
pub fn display_preview_lut_status() -> Result<DisplayPreviewLutStatus, String> {
    let lut = build_srgb_to_active_display_lut();
    Ok(DisplayPreviewLutStatus {
        sample_count: lut.rgba16f.len() / 4,
        size: lut.size,
        status: display_lut_transform_status(&lut.profile),
        profile: lut.profile,
    })
}

#[cfg(not(any(target_os = "android", target_os = "linux")))]
pub fn display_preview_lut_status_for_app(
    app: &tauri::AppHandle,
) -> Result<DisplayPreviewLutStatus, String> {
    let lut = build_srgb_to_active_display_lut_for_app(app);
    Ok(DisplayPreviewLutStatus {
        sample_count: lut.rgba16f.len() / 4,
        size: lut.size,
        status: display_lut_transform_status(&lut.profile),
        profile: lut.profile,
    })
}

#[cfg(any(target_os = "android", target_os = "linux"))]
pub fn display_preview_lut_status() -> Result<DisplayPreviewLutStatus, String> {
    Ok(DisplayPreviewLutStatus {
        profile: active_display_profile()?,
        sample_count: 0,
        size: 0,
        status: DisplayPreviewLutTransformStatus::UnsupportedPlatform,
    })
}

#[cfg(any(target_os = "android", target_os = "linux"))]
pub fn display_preview_lut_status_for_app(
    _app: &tauri::AppHandle,
) -> Result<DisplayPreviewLutStatus, String> {
    display_preview_lut_status()
}

#[cfg(not(any(target_os = "android", target_os = "linux")))]
fn display_lut_transform_status(
    profile: &ActiveDisplayProfile,
) -> DisplayPreviewLutTransformStatus {
    match profile.status {
        ActiveDisplayProfileStatus::ActiveProfileLoaded => {
            DisplayPreviewLutTransformStatus::ActiveDisplayTransform
        }
        ActiveDisplayProfileStatus::FallbackNoActiveProfile => {
            DisplayPreviewLutTransformStatus::SrgbFallbackTransform
        }
        ActiveDisplayProfileStatus::UnsupportedPlatform => {
            DisplayPreviewLutTransformStatus::UnsupportedPlatform
        }
    }
}

#[cfg(not(any(target_os = "android", target_os = "linux")))]
pub fn build_srgb_to_active_display_lut_with_size(size: u32) -> DisplayLut {
    let size = size.max(2);

    match try_build_srgb_to_active_display_lut(size) {
        Ok(lut) => lut,
        Err(error) => fallback_display_lut(size, error),
    }
}

#[cfg(all(
    target_os = "macos",
    not(any(target_os = "android", target_os = "linux"))
))]
fn try_build_srgb_to_active_display_lut(size: u32) -> Result<DisplayLut, String> {
    try_build_srgb_to_display_id_lut(size, macos::main_display_id())
}

#[cfg(target_os = "macos")]
fn try_build_srgb_to_display_id_lut(size: u32, display_id: u32) -> Result<DisplayLut, String> {
    let display_profile_bytes = active_display_profile_bytes_for_id(display_id)?;
    build_srgb_to_display_profile_lut_with_size(
        &display_profile_bytes,
        active_display_profile_for_id(display_id)?,
        size,
    )
}

#[cfg(all(
    not(target_os = "macos"),
    not(any(target_os = "android", target_os = "linux"))
))]
fn try_build_srgb_to_active_display_lut(size: u32) -> Result<DisplayLut, String> {
    Ok(DisplayLut {
        profile: fallback_display_profile("native_colorsync_profile_unavailable".to_string()),
        rgba16f: build_identity_display_lut(size),
        size,
    })
}

#[cfg(not(any(target_os = "android", target_os = "linux")))]
fn fallback_display_profile(reason: String) -> ActiveDisplayProfile {
    ActiveDisplayProfile {
        cmm: "identity".to_string(),
        display_id: None,
        icc_sha256: None,
        profile_byte_count: None,
        source: "identity_srgb_display_lut".to_string(),
        status: ActiveDisplayProfileStatus::FallbackNoActiveProfile,
        fallback_reason: Some(reason),
    }
}

#[cfg(not(any(target_os = "android", target_os = "linux")))]
fn fallback_display_lut(size: u32, reason: String) -> DisplayLut {
    DisplayLut {
        profile: fallback_display_profile(reason),
        rgba16f: build_identity_display_lut(size),
        size,
    }
}

#[cfg(not(any(target_os = "android", target_os = "linux")))]
fn build_lut_source_rgb(size: u32) -> Vec<f32> {
    let max_index = (size - 1) as f32;
    let mut source = Vec::with_capacity((size as usize).pow(3) * 3);

    for blue_index in 0..size {
        for green_index in 0..size {
            for red_index in 0..size {
                source.push(red_index as f32 / max_index);
                source.push(green_index as f32 / max_index);
                source.push(blue_index as f32 / max_index);
            }
        }
    }

    source
}

#[cfg(not(any(target_os = "android", target_os = "linux")))]
fn build_srgb_to_display_profile_lut_with_size(
    display_profile_bytes: &[u8],
    profile: ActiveDisplayProfile,
    size: u32,
) -> Result<DisplayLut, String> {
    use lcms2::{Flags, Intent, PixelFormat, Profile, Transform};
    let source_profile = Profile::new_srgb();
    let display_profile = Profile::new_icc(display_profile_bytes)
        .map_err(|error| format!("Failed to open active display ICC with LittleCMS: {error}"))?;
    let transform = Transform::<[u16; 3], [u16; 3], _, _>::new_flags(
        &source_profile,
        PixelFormat::RGB_16,
        &display_profile,
        PixelFormat::RGB_16,
        Intent::RelativeColorimetric,
        Flags::BLACKPOINT_COMPENSATION | Flags::NO_CACHE,
    )
    .map_err(|error| format!("Failed to create display transform: {error}"))?;

    let size = size.max(2);
    let source: Vec<[u16; 3]> = build_lut_source_rgb(size)
        .chunks_exact(3)
        .map(|rgb| {
            [rgb[0], rgb[1], rgb[2]].map(|channel| (channel * u16::MAX as f32).round() as u16)
        })
        .collect();
    let mut transformed = vec![[0_u16; 3]; source.len()];
    transform.transform_pixels(&source, &mut transformed);
    let transformed: Vec<f32> = transformed
        .into_iter()
        .flatten()
        .map(|channel| channel as f32 / u16::MAX as f32)
        .collect();

    Ok(DisplayLut {
        profile,
        rgba16f: rgb_to_rgba16f(&transformed),
        size,
    })
}

#[cfg(not(any(target_os = "android", target_os = "linux")))]
fn rgb_to_rgba16f(rgb: &[f32]) -> Vec<half::f16> {
    rgb.chunks_exact(3)
        .flat_map(|pixel| {
            [
                half::f16::from_f32(pixel[0].clamp(0.0, 1.0)),
                half::f16::from_f32(pixel[1].clamp(0.0, 1.0)),
                half::f16::from_f32(pixel[2].clamp(0.0, 1.0)),
                half::f16::from_f32(1.0),
            ]
        })
        .collect()
}

#[cfg(not(any(target_os = "android", target_os = "linux")))]
fn build_identity_display_lut(size: u32) -> Vec<half::f16> {
    rgb_to_rgba16f(&build_lut_source_rgb(size))
}

fn sha256_hex(bytes: &[u8]) -> String {
    use sha2::{Digest, Sha256};

    let digest = Sha256::digest(bytes);
    let hex = digest
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect::<String>();
    format!("sha256:{hex}")
}

#[cfg(target_os = "macos")]
mod macos {
    use std::ffi::c_void;
    use tauri::Manager;

    type CFDataRef = *const c_void;
    type CFErrorRef = *const c_void;
    type CFIndex = isize;
    type ColorSyncProfileRef = *const c_void;

    #[repr(C)]
    #[derive(Clone, Copy)]
    struct CGPoint {
        x: f64,
        y: f64,
    }
    #[repr(C)]
    #[derive(Clone, Copy)]
    struct CGSize {
        width: f64,
        height: f64,
    }
    #[repr(C)]
    #[derive(Clone, Copy)]
    struct CGRect {
        origin: CGPoint,
        size: CGSize,
    }

    #[link(name = "CoreFoundation", kind = "framework")]
    unsafe extern "C" {
        fn CFDataGetBytePtr(the_data: CFDataRef) -> *const u8;
        fn CFDataGetLength(the_data: CFDataRef) -> CFIndex;
        fn CFRelease(cf: *const c_void);
    }

    #[link(name = "CoreGraphics", kind = "framework")]
    unsafe extern "C" {
        fn CGMainDisplayID() -> u32;
        fn CGGetActiveDisplayList(
            max_displays: u32,
            active_displays: *mut u32,
            display_count: *mut u32,
        ) -> i32;
        fn CGDisplayBounds(display: u32) -> CGRect;
    }

    #[link(name = "ColorSync", kind = "framework")]
    unsafe extern "C" {
        fn ColorSyncProfileCreateWithDisplayID(display_id: u32) -> ColorSyncProfileRef;
        fn ColorSyncProfileCopyData(
            profile: ColorSyncProfileRef,
            error: *mut CFErrorRef,
        ) -> CFDataRef;
    }

    pub fn main_display_id() -> u32 {
        unsafe { CGMainDisplayID() }
    }

    pub fn display_id_for_app(app: &tauri::AppHandle) -> Option<u32> {
        let window = app.get_webview_window("main")?;
        let position = window.outer_position().ok()?;
        let size = window.outer_size().ok()?;
        let scale = window.scale_factor().unwrap_or(1.0);
        let window_rect = CGRect {
            origin: CGPoint {
                x: position.x as f64 / scale,
                y: position.y as f64 / scale,
            },
            size: CGSize {
                width: size.width as f64 / scale,
                height: size.height as f64 / scale,
            },
        };
        let mut displays = [0_u32; 32];
        let mut count = 0_u32;
        if unsafe {
            CGGetActiveDisplayList(displays.len() as u32, displays.as_mut_ptr(), &mut count)
        } != 0
        {
            return None;
        }
        displays[..count as usize]
            .iter()
            .copied()
            .max_by(|left, right| {
                intersection_area(window_rect, unsafe { CGDisplayBounds(*left) }).total_cmp(
                    &intersection_area(window_rect, unsafe { CGDisplayBounds(*right) }),
                )
            })
    }

    fn intersection_area(left: CGRect, right: CGRect) -> f64 {
        let width = (left.origin.x + left.size.width).min(right.origin.x + right.size.width)
            - left.origin.x.max(right.origin.x);
        let height = (left.origin.y + left.size.height).min(right.origin.y + right.size.height)
            - left.origin.y.max(right.origin.y);
        width.max(0.0) * height.max(0.0)
    }

    pub fn copy_display_profile_data(display_id: u32) -> Result<Vec<u8>, String> {
        unsafe {
            let profile = ColorSyncProfileCreateWithDisplayID(display_id);
            if profile.is_null() {
                return Err(format!(
                    "ColorSync did not return an active profile for display {}.",
                    display_id
                ));
            }

            let mut error: CFErrorRef = std::ptr::null();
            let data = ColorSyncProfileCopyData(profile, &mut error);
            CFRelease(profile);

            if data.is_null() {
                return Err(format!(
                    "ColorSync could not copy ICC profile data for display {}.",
                    display_id
                ));
            }

            let len = CFDataGetLength(data);
            if len <= 0 {
                CFRelease(data);
                return Err(format!(
                    "ColorSync returned empty ICC profile data for display {}.",
                    display_id
                ));
            }

            let ptr = CFDataGetBytePtr(data);
            if ptr.is_null() {
                CFRelease(data);
                return Err(format!(
                    "ColorSync returned null ICC profile data for display {}.",
                    display_id
                ));
            }

            let bytes = std::slice::from_raw_parts(ptr, len as usize).to_vec();
            CFRelease(data);
            Ok(bytes)
        }
    }
}

#[cfg(all(test, target_os = "macos"))]
mod tests {
    use super::*;
    use moxcms::{ColorProfile, Layout, TransformOptions};

    #[test]
    fn active_macos_display_profile_loads_as_icc_and_builds_cmm_transform() {
        let profile = active_display_profile().expect("active display profile metadata");
        assert!(matches!(
            profile.status,
            ActiveDisplayProfileStatus::ActiveProfileLoaded
        ));
        assert!(profile.profile_byte_count.unwrap_or_default() > 128);
        assert!(
            profile
                .icc_sha256
                .as_deref()
                .unwrap_or_default()
                .starts_with("sha256:")
        );

        let display_profile_bytes =
            active_display_profile_bytes().expect("active display profile bytes");
        let display_profile = ColorProfile::new_from_slice(&display_profile_bytes)
            .expect("active display profile should parse as ICC");
        let transform = ColorProfile::new_srgb()
            .create_transform_f32(
                Layout::Rgb,
                &display_profile,
                Layout::Rgb,
                TransformOptions::default(),
            )
            .expect("sRGB to active display CMM transform should build");

        let source = [0.18_f32, 0.5, 0.9];
        let mut transformed = [0.0_f32; 3];
        transform
            .transform(&source, &mut transformed)
            .expect("sRGB sample should transform through active display profile");
        assert!(transformed.iter().all(|channel| channel.is_finite()));
    }

    #[test]
    fn active_display_lut_builds_color_managed_rgba16f_grid() {
        let lut = build_srgb_to_active_display_lut_with_size(4);

        assert_eq!(lut.size, 4);
        assert_eq!(lut.rgba16f.len(), 4 * 4 * 4 * 4);
        assert!(matches!(
            lut.profile.status,
            ActiveDisplayProfileStatus::ActiveProfileLoaded
                | ActiveDisplayProfileStatus::FallbackNoActiveProfile
        ));
    }
}

#[cfg(all(test, not(any(target_os = "android", target_os = "linux"))))]
mod cross_platform_tests {
    use super::*;

    #[test]
    fn identity_display_lut_maps_black_and_white_corners() {
        let lut = build_identity_display_lut(2);
        let black = &lut[0..4];
        let white = &lut[lut.len() - 4..];

        assert_eq!(black[0].to_f32(), 0.0);
        assert_eq!(black[1].to_f32(), 0.0);
        assert_eq!(black[2].to_f32(), 0.0);
        assert_eq!(black[3].to_f32(), 1.0);
        assert_eq!(white[0].to_f32(), 1.0);
        assert_eq!(white[1].to_f32(), 1.0);
        assert_eq!(white[2].to_f32(), 1.0);
        assert_eq!(white[3].to_f32(), 1.0);
    }

    #[test]
    fn neutral_axis_guard_rejects_severe_magenta_transform() {
        let mut lut = DisplayLut {
            profile: fallback_display_profile("test".to_string()),
            rgba16f: build_identity_display_lut(2),
            size: 2,
        };
        for pixel in lut.rgba16f.chunks_exact_mut(4) {
            pixel[0] = half::f16::from_f32(1.0);
            pixel[1] = half::f16::from_f32(0.0);
            pixel[2] = half::f16::from_f32(1.0);
        }
        assert_eq!(
            validate_display_lut(&lut).unwrap_err(),
            "display_transform_neutral_axis_chroma_guard"
        );
    }

    #[test]
    fn display_selection_generation_changes_only_with_identity_or_profile() {
        let profile = fallback_display_profile("test".to_string());
        let first = display_selection_generation(&profile, "sha256:stable-test");
        let second = display_selection_generation(&profile, "sha256:stable-test");
        let changed = display_selection_generation(&profile, "sha256:changed-test");
        assert_eq!(first, second);
        assert!(changed > second);
    }

    #[test]
    fn captured_profile_bytes_own_both_pixel_transform_and_artifact_tag() {
        let bytes = moxcms::ColorProfile::new_srgb().encode().unwrap();
        let snapshot =
            display_preview_transform_snapshot_from_capture(Ok((Some(77), bytes.clone())));
        assert_eq!(snapshot.icc_bytes, bytes);
        assert_eq!(snapshot.icc_sha256, sha256_hex(&snapshot.icc_bytes));
        assert_eq!(
            snapshot.profile.icc_sha256.as_deref(),
            Some(snapshot.icc_sha256.as_str())
        );
        assert_eq!(snapshot.lut.profile.icc_sha256, snapshot.profile.icc_sha256);
        let gray = snapshot.lut.sample_rgb([0.5; 3]);
        assert!(gray.iter().all(|channel| (*channel - 0.5).abs() < 0.002));
    }

    #[test]
    fn malformed_capture_falls_back_to_identity_pixels_and_srgb_tag() {
        let snapshot =
            display_preview_transform_snapshot_from_capture(Ok((Some(88), b"bad icc".to_vec())));
        assert!(matches!(
            snapshot.profile.status,
            ActiveDisplayProfileStatus::FallbackNoActiveProfile
        ));
        let gray = snapshot.lut.sample_rgb([0.5; 3]);
        assert!((gray[0] - gray[1]).abs() < 0.001 && (gray[1] - gray[2]).abs() < 0.001);
        assert!(moxcms::ColorProfile::new_from_slice(&snapshot.icc_bytes).is_ok());
        assert_ne!(snapshot.icc_bytes, b"bad icc");
    }

    #[test]
    fn controlled_display_p3_lut_builds_alternate_profile_transform() {
        let profile = ActiveDisplayProfile {
            cmm: "moxcms".to_string(),
            display_id: None,
            icc_sha256: None,
            profile_byte_count: None,
            source: "controlled_display_p3_test_profile".to_string(),
            status: ActiveDisplayProfileStatus::ActiveProfileLoaded,
            fallback_reason: None,
        };
        let lut = build_srgb_to_display_profile_lut_with_size(
            &moxcms::ColorProfile::new_display_p3().encode().unwrap(),
            profile,
            3,
        )
        .expect("controlled Display P3 profile should build a LUT");

        assert_eq!(lut.size, 3);
        assert_eq!(lut.profile.source, "controlled_display_p3_test_profile");

        let red_index = ((2 * 4) as usize)..((2 * 4 + 4) as usize);
        let red = &lut.rgba16f[red_index];
        assert!(
            (red[0].to_f32() - 1.0).abs() > 0.0001
                || red[1].to_f32() > 0.0001
                || red[2].to_f32() > 0.0001
        );
        assert_eq!(red[3].to_f32(), 1.0);
    }

    #[test]
    fn cpu_trilinear_sampling_tracks_display_cmm_reference() {
        use lcms2::{Flags, Intent, PixelFormat, Profile, Transform};
        let target_bytes = moxcms::ColorProfile::new_display_p3().encode().unwrap();
        let profile = ActiveDisplayProfile {
            cmm: "moxcms".to_string(),
            display_id: Some(42),
            icc_sha256: Some(format!("sha256:{}", "1".repeat(64))),
            profile_byte_count: Some(128),
            source: "controlled_display_p3_test_profile".to_string(),
            status: ActiveDisplayProfileStatus::ActiveProfileLoaded,
            fallback_reason: None,
        };
        let lut = build_srgb_to_display_profile_lut_with_size(&target_bytes, profile, 32).unwrap();
        let source = [0.13_f32, 0.47, 0.91];
        let source_profile = Profile::new_srgb();
        let target = Profile::new_icc(&target_bytes).unwrap();
        let transform = Transform::<[u16; 3], [u16; 3], _, _>::new_flags(
            &source_profile,
            PixelFormat::RGB_16,
            &target,
            PixelFormat::RGB_16,
            Intent::RelativeColorimetric,
            Flags::BLACKPOINT_COMPENSATION | Flags::NO_CACHE,
        )
        .unwrap();
        let source_u16 = [source.map(|channel| (channel * u16::MAX as f32).round() as u16)];
        let mut expected_u16 = [[0_u16; 3]];
        transform.transform_pixels(&source_u16, &mut expected_u16);
        let expected = expected_u16[0].map(|channel| channel as f32 / u16::MAX as f32);
        let sampled = lut.sample_rgb(source);
        let max_abs = sampled
            .iter()
            .zip(expected)
            .map(|(actual, expected)| (actual - expected).abs())
            .fold(0.0_f32, f32::max);
        assert!(max_abs < 0.003, "CPU/WGPU LUT contract max_abs={max_abs}");
    }

    #[test]
    fn fallback_is_explicitly_uncalibrated() {
        let lut = fallback_display_lut(4, "colorsync_profile_access_failed".to_string());
        assert!(matches!(
            lut.profile.status,
            ActiveDisplayProfileStatus::FallbackNoActiveProfile
        ));
        assert_eq!(
            lut.profile.fallback_reason.as_deref(),
            Some("colorsync_profile_access_failed")
        );
        let sampled = lut.sample_rgb([0.2, 0.4, 0.8]);
        assert!(
            sampled
                .iter()
                .zip([0.2, 0.4, 0.8])
                .all(|(actual, expected)| (actual - expected).abs() < 0.001)
        );
    }
}
