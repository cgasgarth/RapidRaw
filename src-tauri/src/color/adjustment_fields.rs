pub const AI_PATCHES: &str = "aiPatches";
pub const CROP: &str = "crop";
pub const FLIP_HORIZONTAL: &str = "flipHorizontal";
pub const FLIP_VERTICAL: &str = "flipVertical";
pub const MASKS: &str = "masks";
pub const ORIENTATION_STEPS: &str = "orientationSteps";
pub const ROTATION: &str = "rotation";

pub const ID: &str = "id";
pub const INVERT: &str = "invert";
pub const PATCH_DATA: &str = "patchData";
pub const PATCH_DATA_BASE64: &str = "patchDataBase64";
pub const PATCH_DATA_COLOR: &str = "color";
pub const PATCH_DATA_MASK: &str = "mask";
pub const SUB_MASKS: &str = "subMasks";
pub const VISIBLE: &str = "visible";

pub const MASK_DATA_BASE64_SNAKE: &str = "mask_data_base64";
pub const MASK_DATA_BASE64_CAMEL: &str = "maskDataBase64";

pub const TRANSFORM_DISTORTION: &str = "transformDistortion";
pub const TRANSFORM_VERTICAL: &str = "transformVertical";
pub const TRANSFORM_HORIZONTAL: &str = "transformHorizontal";
pub const TRANSFORM_ROTATE: &str = "transformRotate";
pub const TRANSFORM_ASPECT: &str = "transformAspect";
pub const TRANSFORM_SCALE: &str = "transformScale";
pub const TRANSFORM_X_OFFSET: &str = "transformXOffset";
pub const TRANSFORM_Y_OFFSET: &str = "transformYOffset";
pub const PERSPECTIVE_CORRECTION: &str = "perspectiveCorrection";

pub const LENS_DISTORTION_AMOUNT: &str = "lensDistortionAmount";
pub const LENS_VIGNETTE_AMOUNT: &str = "lensVignetteAmount";
pub const LENS_TCA_AMOUNT: &str = "lensTcaAmount";
pub const LENS_DISTORTION_PARAMS: &str = "lensDistortionParams";
pub const LENS_MAKER: &str = "lensMaker";
pub const LENS_MODEL: &str = "lensModel";
pub const LENS_DISTORTION_ENABLED: &str = "lensDistortionEnabled";
pub const LENS_TCA_ENABLED: &str = "lensTcaEnabled";
pub const LENS_VIGNETTE_ENABLED: &str = "lensVignetteEnabled";

pub const GEOMETRY_KEYS: &[&str] = &[
    TRANSFORM_DISTORTION,
    TRANSFORM_VERTICAL,
    TRANSFORM_HORIZONTAL,
    TRANSFORM_ROTATE,
    TRANSFORM_ASPECT,
    TRANSFORM_SCALE,
    TRANSFORM_X_OFFSET,
    TRANSFORM_Y_OFFSET,
    PERSPECTIVE_CORRECTION,
    LENS_DISTORTION_AMOUNT,
    LENS_VIGNETTE_AMOUNT,
    LENS_TCA_AMOUNT,
    LENS_DISTORTION_PARAMS,
    LENS_MAKER,
    LENS_MODEL,
    LENS_DISTORTION_ENABLED,
    LENS_TCA_ENABLED,
    LENS_VIGNETTE_ENABLED,
];

pub const TRANSFORM_HASH_KEYS: &[&str] = &[
    CROP,
    ROTATION,
    ORIENTATION_STEPS,
    FLIP_HORIZONTAL,
    FLIP_VERTICAL,
];

pub const CPU_COLOR_RENDER_HASH_KEYS: &[&str] =
    &["colorBalanceRgb", "channelMixer", "blackWhiteMixer"];
