use serde::Serialize;

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ActiveDisplayProfile {
    pub cmm: String,
    pub display_id: Option<u32>,
    pub icc_sha256: Option<String>,
    pub profile_byte_count: Option<usize>,
    pub source: String,
    pub status: ActiveDisplayProfileStatus,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "snake_case")]
#[allow(dead_code)]
pub enum ActiveDisplayProfileStatus {
    ActiveProfileLoaded,
    FallbackNoActiveProfile,
    UnsupportedPlatform,
}

#[tauri::command]
pub fn get_active_display_profile() -> Result<ActiveDisplayProfile, String> {
    active_display_profile()
}

#[cfg(target_os = "macos")]
pub fn active_display_profile() -> Result<ActiveDisplayProfile, String> {
    let display_id = macos::main_display_id();
    let icc_bytes = macos::copy_display_profile_data(display_id)?;

    Ok(ActiveDisplayProfile {
        cmm: "colorsync+moxcms".to_string(),
        display_id: Some(display_id),
        icc_sha256: Some(sha256_hex(&icc_bytes)),
        profile_byte_count: Some(icc_bytes.len()),
        source: "ColorSyncProfileCreateWithDisplayID(CGMainDisplayID())".to_string(),
        status: ActiveDisplayProfileStatus::ActiveProfileLoaded,
    })
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
    })
}

#[cfg(target_os = "macos")]
pub fn active_display_profile_bytes() -> Result<Vec<u8>, String> {
    macos::copy_display_profile_data(macos::main_display_id())
}

#[cfg(not(any(target_os = "android", target_os = "linux")))]
pub const DISPLAY_LUT_SIZE: u32 = 32;

#[cfg(not(any(target_os = "android", target_os = "linux")))]
pub struct DisplayLut {
    pub profile: ActiveDisplayProfile,
    pub rgba16f: Vec<half::f16>,
    pub size: u32,
}

#[cfg(not(any(target_os = "android", target_os = "linux")))]
pub fn build_srgb_to_active_display_lut() -> DisplayLut {
    build_srgb_to_active_display_lut_with_size(DISPLAY_LUT_SIZE)
}

#[cfg(not(any(target_os = "android", target_os = "linux")))]
pub fn build_srgb_to_active_display_lut_with_size(size: u32) -> DisplayLut {
    let size = size.max(2);

    match try_build_srgb_to_active_display_lut(size) {
        Ok(lut) => lut,
        Err(_) => DisplayLut {
            profile: fallback_display_profile(),
            rgba16f: build_identity_display_lut(size),
            size,
        },
    }
}

#[cfg(all(
    target_os = "macos",
    not(any(target_os = "android", target_os = "linux"))
))]
fn try_build_srgb_to_active_display_lut(size: u32) -> Result<DisplayLut, String> {
    use moxcms::{ColorProfile, Layout, TransformOptions};

    let display_profile_bytes = active_display_profile_bytes()?;
    let display_profile = ColorProfile::new_from_slice(&display_profile_bytes)
        .map_err(|error| format!("Failed to parse active display ICC profile: {error}"))?;
    let transform = ColorProfile::new_srgb()
        .create_transform_f32(
            Layout::Rgb,
            &display_profile,
            Layout::Rgb,
            TransformOptions::default(),
        )
        .map_err(|error| format!("Failed to create active display transform: {error}"))?;

    let source = build_lut_source_rgb(size);
    let mut transformed = vec![0.0_f32; source.len()];
    transform
        .transform(&source, &mut transformed)
        .map_err(|error| format!("Failed to transform active display LUT: {error}"))?;

    Ok(DisplayLut {
        profile: active_display_profile()?,
        rgba16f: rgb_to_rgba16f(&transformed),
        size,
    })
}

#[cfg(all(
    not(target_os = "macos"),
    not(any(target_os = "android", target_os = "linux"))
))]
fn try_build_srgb_to_active_display_lut(size: u32) -> Result<DisplayLut, String> {
    Ok(DisplayLut {
        profile: fallback_display_profile(),
        rgba16f: build_identity_display_lut(size),
        size,
    })
}

#[cfg(not(any(target_os = "android", target_os = "linux")))]
fn fallback_display_profile() -> ActiveDisplayProfile {
    ActiveDisplayProfile {
        cmm: "identity".to_string(),
        display_id: None,
        icc_sha256: None,
        profile_byte_count: None,
        source: "identity_srgb_display_lut".to_string(),
        status: ActiveDisplayProfileStatus::FallbackNoActiveProfile,
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

#[cfg(target_os = "macos")]
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

    type CFDataRef = *const c_void;
    type CFErrorRef = *const c_void;
    type CFIndex = isize;
    type ColorSyncProfileRef = *const c_void;

    #[link(name = "CoreFoundation", kind = "framework")]
    unsafe extern "C" {
        fn CFDataGetBytePtr(the_data: CFDataRef) -> *const u8;
        fn CFDataGetLength(the_data: CFDataRef) -> CFIndex;
        fn CFRelease(cf: *const c_void);
    }

    #[link(name = "CoreGraphics", kind = "framework")]
    unsafe extern "C" {
        fn CGMainDisplayID() -> u32;
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
}
