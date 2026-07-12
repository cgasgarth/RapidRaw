use rapidraw_types::{NativeBuildProfile, NativeCapabilityManifest};

#[tauri::command]
pub fn get_native_capabilities() -> NativeCapabilityManifest {
    build_native_capabilities(
        cfg!(feature = "full"),
        cfg!(feature = "ai"),
        cfg!(feature = "advanced-codecs"),
    )
}

fn build_native_capabilities(
    full: bool,
    ai: bool,
    advanced_codecs: bool,
) -> NativeCapabilityManifest {
    NativeCapabilityManifest {
        schema_version: 1,
        build_profile: if full {
            NativeBuildProfile::Full
        } else {
            NativeBuildProfile::FastDev
        },
        ai,
        advanced_codecs,
        computational: true,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn required_ci_reports_full_product_capabilities() {
        let manifest = get_native_capabilities();
        assert_eq!(manifest.schema_version, 1);
        assert_eq!(manifest.build_profile, NativeBuildProfile::Full);
        assert!(manifest.ai);
        assert!(manifest.advanced_codecs);
        assert!(manifest.computational);
    }

    #[test]
    fn fast_dev_reports_only_always_available_capabilities() {
        assert_eq!(
            build_native_capabilities(false, false, false),
            NativeCapabilityManifest {
                schema_version: 1,
                build_profile: NativeBuildProfile::FastDev,
                ai: false,
                advanced_codecs: false,
                computational: true,
            }
        );
    }
}
