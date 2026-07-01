#[cfg(all(test, feature = "tauri-test"))]
pub(crate) mod deblur_real_raw_proof;
#[cfg(all(test, feature = "tauri-test"))]
pub(crate) mod denoise_real_raw_proof;
#[cfg(all(test, feature = "tauri-test"))]
pub(crate) mod focus_real_raw_proof;
#[cfg(all(test, feature = "tauri-test"))]
pub(crate) mod hdr_real_raw_proof;
#[cfg(all(test, feature = "tauri-test"))]
pub(crate) mod layer_mask_real_raw_proof;
#[cfg(feature = "validation-harness")]
pub(crate) mod linear_gradient_mask_real_raw_proof;
#[cfg(all(test, feature = "tauri-test"))]
pub(crate) mod mask_refinement_full_image_output_proof;
#[cfg(all(test, feature = "tauri-test"))]
pub(crate) mod panorama_real_raw_proof;
#[cfg(all(test, feature = "tauri-test"))]
pub(crate) mod retouch_clone_real_raw_proof;
#[cfg(all(test, feature = "tauri-test"))]
pub(crate) mod sr_real_raw_proof;
