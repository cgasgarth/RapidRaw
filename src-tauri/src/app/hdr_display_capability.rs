use serde::Serialize;

pub const HDR_DISPLAY_CAPABILITY_VERSION: u32 = 1;
const SDR_REFERENCE_WHITE_NITS: f64 = 203.0;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum HdrTransferFunction {
    DisplayEncodedSrgb,
    PlatformExtendedLinear,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum HdrPresentationAuthority {
    NativeHdr,
    SdrNative,
    ToneMappedSdrFallback,
}

#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct EdrHeadroomSample {
    pub current: Option<f64>,
    pub potential: Option<f64>,
    pub reference: Option<f64>,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HdrDisplayCapabilityV1 {
    pub implementation_version: u32,
    pub display_profile_sha256: String,
    pub transfer: HdrTransferFunction,
    pub presentation_authority: HdrPresentationAuthority,
    pub sdr_reference_white_nits: f64,
    pub presentation_peak_nits: f64,
    pub display_potential_peak_nits: f64,
    pub current_headroom: f64,
    pub potential_headroom: f64,
    pub reference_headroom: f64,
    pub headroom_stops: f64,
    pub hdr_editing_supported: bool,
    pub authoritative_hdr_preview: bool,
    pub fallback_reason: Option<String>,
    pub fingerprint: u64,
}

fn valid_headroom(value: Option<f64>) -> Option<f64> {
    value.filter(|value| value.is_finite() && *value >= 1.0)
}

pub fn compile_hdr_display_capability(
    display_profile_sha256: String,
    sample: EdrHeadroomSample,
    hdr_surface_accepted: bool,
) -> HdrDisplayCapabilityV1 {
    let current = valid_headroom(sample.current).unwrap_or(1.0);
    let potential = valid_headroom(sample.potential)
        .unwrap_or(current)
        .max(current);
    let reference = valid_headroom(sample.reference).unwrap_or(1.0);
    let edr_available = potential > 1.0;
    let native_hdr = hdr_surface_accepted && current > 1.0;
    let presentation_authority = if native_hdr {
        HdrPresentationAuthority::NativeHdr
    } else if edr_available {
        HdrPresentationAuthority::ToneMappedSdrFallback
    } else {
        HdrPresentationAuthority::SdrNative
    };
    let transfer = if native_hdr {
        HdrTransferFunction::PlatformExtendedLinear
    } else {
        HdrTransferFunction::DisplayEncodedSrgb
    };
    let presentation_peak_nits = SDR_REFERENCE_WHITE_NITS * if native_hdr { current } else { 1.0 };
    let fallback_reason = match presentation_authority {
        HdrPresentationAuthority::NativeHdr | HdrPresentationAuthority::SdrNative => None,
        HdrPresentationAuthority::ToneMappedSdrFallback => {
            Some("hdr_surface_contract_not_accepted".to_string())
        }
    };
    let mut capability = HdrDisplayCapabilityV1 {
        implementation_version: HDR_DISPLAY_CAPABILITY_VERSION,
        display_profile_sha256,
        transfer,
        presentation_authority,
        sdr_reference_white_nits: SDR_REFERENCE_WHITE_NITS,
        presentation_peak_nits,
        display_potential_peak_nits: SDR_REFERENCE_WHITE_NITS * potential,
        current_headroom: current,
        potential_headroom: potential,
        reference_headroom: reference,
        headroom_stops: potential.log2(),
        hdr_editing_supported: true,
        authoritative_hdr_preview: native_hdr,
        fallback_reason,
        fingerprint: 0,
    };
    capability.fingerprint = capability_fingerprint(&capability);
    capability
}

fn capability_fingerprint(capability: &HdrDisplayCapabilityV1) -> u64 {
    let mut hash = 0xcbf2_9ce4_8422_2325_u64;
    let mut update = |bytes: &[u8]| {
        for byte in bytes {
            hash ^= u64::from(*byte);
            hash = hash.wrapping_mul(0x0000_0100_0000_01b3);
        }
    };
    update(capability.display_profile_sha256.as_bytes());
    update(&capability.implementation_version.to_le_bytes());
    update(&capability.current_headroom.to_bits().to_le_bytes());
    update(&capability.potential_headroom.to_bits().to_le_bytes());
    update(&capability.reference_headroom.to_bits().to_le_bytes());
    update(&[capability.authoritative_hdr_preview.into()]);
    hash
}

#[cfg(target_os = "macos")]
pub fn query_edr_headroom(display_id: Option<u32>) -> EdrHeadroomSample {
    use objc::runtime::Object;
    use objc::{class, msg_send, sel, sel_impl};

    unsafe {
        let screens: *mut Object = msg_send![class!(NSScreen), screens];
        let count: usize = msg_send![screens, count];
        let key: *mut Object = msg_send![
            class!(NSString),
            stringWithUTF8String: c"NSScreenNumber".as_ptr()
        ];
        let mut selected: *mut Object = std::ptr::null_mut();
        for index in 0..count {
            let screen: *mut Object = msg_send![screens, objectAtIndex: index];
            let description: *mut Object = msg_send![screen, deviceDescription];
            let number: *mut Object = msg_send![description, objectForKey: key];
            let number_value: u32 = if number.is_null() {
                0
            } else {
                msg_send![number, unsignedIntValue]
            };
            if display_id.is_none() && selected.is_null() {
                selected = screen;
            }
            if display_id == Some(number_value) {
                selected = screen;
                break;
            }
        }
        if selected.is_null() {
            return EdrHeadroomSample::default();
        }
        let responds_current: bool = msg_send![
            selected,
            respondsToSelector: sel!(maximumExtendedDynamicRangeColorComponentValue)
        ];
        let responds_potential: bool = msg_send![
            selected,
            respondsToSelector: sel!(maximumPotentialExtendedDynamicRangeColorComponentValue)
        ];
        let responds_reference: bool = msg_send![
            selected,
            respondsToSelector: sel!(maximumReferenceExtendedDynamicRangeColorComponentValue)
        ];
        EdrHeadroomSample {
            current: responds_current.then(|| {
                let value: f64 =
                    msg_send![selected, maximumExtendedDynamicRangeColorComponentValue];
                value
            }),
            potential: responds_potential.then(|| {
                let value: f64 = msg_send![
                    selected,
                    maximumPotentialExtendedDynamicRangeColorComponentValue
                ];
                value
            }),
            reference: responds_reference.then(|| {
                let value: f64 = msg_send![
                    selected,
                    maximumReferenceExtendedDynamicRangeColorComponentValue
                ];
                value
            }),
        }
    }
}

#[cfg(not(target_os = "macos"))]
pub fn query_edr_headroom(_display_id: Option<u32>) -> EdrHeadroomSample {
    EdrHeadroomSample::default()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hdr_capability_is_numeric_target_bound_and_fail_closed() {
        let fallback = compile_hdr_display_capability(
            "profile-a".to_string(),
            EdrHeadroomSample {
                current: Some(1.6),
                potential: Some(4.0),
                reference: Some(1.0),
            },
            false,
        );
        assert_eq!(
            fallback.presentation_authority,
            HdrPresentationAuthority::ToneMappedSdrFallback
        );
        assert_eq!(fallback.transfer, HdrTransferFunction::DisplayEncodedSrgb);
        assert_eq!(fallback.presentation_peak_nits, 203.0);
        assert_eq!(fallback.display_potential_peak_nits, 812.0);
        assert_eq!(fallback.headroom_stops, 2.0);
        assert!(!fallback.authoritative_hdr_preview);
        assert_eq!(
            fallback.fallback_reason.as_deref(),
            Some("hdr_surface_contract_not_accepted")
        );
        assert_ne!(fallback.fingerprint, 0);

        let native = compile_hdr_display_capability(
            "profile-a".to_string(),
            EdrHeadroomSample {
                current: Some(2.0),
                potential: Some(4.0),
                reference: Some(1.0),
            },
            true,
        );
        assert_eq!(
            native.presentation_authority,
            HdrPresentationAuthority::NativeHdr
        );
        assert_eq!(native.presentation_peak_nits, 406.0);
        assert!(native.authoritative_hdr_preview);
        assert_ne!(native.fingerprint, fallback.fingerprint);

        let malformed = compile_hdr_display_capability(
            "profile-b".to_string(),
            EdrHeadroomSample {
                current: Some(f64::NAN),
                potential: Some(-2.0),
                reference: None,
            },
            true,
        );
        assert_eq!(
            malformed.presentation_authority,
            HdrPresentationAuthority::SdrNative
        );
        assert!(malformed.fallback_reason.is_none());
        assert!(
            serde_json::to_value(malformed)
                .expect("capability serializes")
                .is_object()
        );
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn live_macos_edr_query_produces_a_truthful_serializable_runtime_target() {
        let profile =
            crate::display_profile::active_display_profile().expect("active display profile");
        let capability = compile_hdr_display_capability(
            profile.icc_sha256.expect("macOS profile has identity"),
            query_edr_headroom(profile.display_id),
            false,
        );
        assert!(capability.current_headroom.is_finite() && capability.current_headroom >= 1.0);
        assert!(capability.potential_headroom.is_finite() && capability.potential_headroom >= 1.0);
        assert!(!capability.authoritative_hdr_preview);
        assert!(
            serde_json::to_string(&capability)
                .unwrap()
                .contains("presentationAuthority")
        );
        assert_eq!(
            query_edr_headroom(Some(u32::MAX)),
            EdrHeadroomSample::default(),
            "an unknown display must not inherit another screen's EDR capability"
        );
    }
}
