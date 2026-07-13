use lcms2::{CIExyY, CIExyYTRIPLE, Profile, ToneCurve};

use rapidraw_color_reference::output::NARROW_D65_PRIMARIES;

use crate::export::export_color_policy::{ExportColorProfile, output_color_profile};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum ControlledProfileKind {
    Srgb,
    DisplayP3,
    ProPhoto,
    NarrowD65,
}

#[derive(Debug)]
pub(crate) struct ControlledProfile {
    pub(crate) kind: ControlledProfileKind,
    pub(crate) bytes: Vec<u8>,
}

pub(crate) fn controlled_profiles() -> Vec<ControlledProfile> {
    vec![
        ControlledProfile {
            kind: ControlledProfileKind::Srgb,
            bytes: output_color_profile(&ExportColorProfile::Srgb)
                .unwrap()
                .encode()
                .unwrap(),
        },
        ControlledProfile {
            kind: ControlledProfileKind::DisplayP3,
            bytes: output_color_profile(&ExportColorProfile::DisplayP3)
                .unwrap()
                .encode()
                .unwrap(),
        },
        ControlledProfile {
            kind: ControlledProfileKind::ProPhoto,
            bytes: output_color_profile(&ExportColorProfile::ProPhotoRgb)
                .unwrap()
                .encode()
                .unwrap(),
        },
        ControlledProfile {
            kind: ControlledProfileKind::NarrowD65,
            bytes: narrow_d65_profile(),
        },
    ]
}

pub(crate) fn malformed_profiles(seed: &[u8]) -> Vec<Vec<u8>> {
    vec![
        vec![],
        seed[..16].to_vec(),
        seed[..64].to_vec(),
        seed[..131].to_vec(),
    ]
}

fn narrow_d65_profile() -> Vec<u8> {
    let white = CIExyY {
        x: 0.3127,
        y: 0.3290,
        Y: 1.0,
    };
    let primary = |xy: [f64; 2]| CIExyY {
        x: xy[0],
        y: xy[1],
        Y: 1.0,
    };
    let primaries = CIExyYTRIPLE {
        Red: primary(NARROW_D65_PRIMARIES[0]),
        Green: primary(NARROW_D65_PRIMARIES[1]),
        Blue: primary(NARROW_D65_PRIMARIES[2]),
    };
    let curve = ToneCurve::new(2.2);
    Profile::new_rgb(&white, &primaries, &[&curve, &curve, &curve])
        .unwrap()
        .icc()
        .unwrap()
}
