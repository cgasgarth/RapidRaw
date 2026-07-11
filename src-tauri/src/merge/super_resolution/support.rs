use serde::Serialize;

#[derive(Clone, Copy, Debug, Default)]
pub struct SampleEstimate {
    pub effective_samples: f32,
    pub estimate: f32,
    pub outlier_ratio: f32,
    pub residual: f32,
    pub source_mask: u8,
    pub variance: f32,
    pub weight_sum: f32,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum SupportClass {
    Unsupported,
    Weak,
    Supported,
}

impl SampleEstimate {
    pub fn support_class(self) -> SupportClass {
        if self.effective_samples >= 2.0
            && self.source_mask.count_ones() >= 2
            && self.weight_sum > 0.0
        {
            SupportClass::Supported
        } else if self.weight_sum > 0.0 {
            SupportClass::Weak
        } else {
            SupportClass::Unsupported
        }
    }
}
