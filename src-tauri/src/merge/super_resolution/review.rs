use super::motion::RegionClass;

pub fn class_overlay(classes: &[RegionClass]) -> Vec<u8> {
    classes
        .iter()
        .map(|class| match class {
            RegionClass::SupportedStatic => 32,
            RegionClass::WeakSupport => 96,
            RegionClass::MotionRejected => 255,
            RegionClass::OcclusionOrParallax => 224,
            RegionClass::EdgeRisk => 160,
            RegionClass::NoiseLimited => 128,
            RegionClass::ClippedOrDefective => 208,
            RegionClass::ReferenceFallback => 192,
        })
        .collect()
}

pub fn strength_overlay(strengths: &[f32]) -> Vec<u8> {
    strengths
        .iter()
        .map(|value| (value.clamp(0.0, 1.0) * 255.0).round() as u8)
        .collect()
}
