use std::path::Path;
use std::sync::OnceLock;

use anyhow::{Result, anyhow};

pub use ort;
pub use tokenizers;

pub mod model_download;
pub mod model_registry;

static ORT_RUNTIME_INIT: OnceLock<Result<(), String>> = OnceLock::new();

#[cfg(unix)]
fn preflight_ort_dylib(path: &Path) -> Result<()> {
    use std::ffi::{CStr, CString};
    use std::os::unix::ffi::OsStrExt;

    let path = CString::new(path.as_os_str().as_bytes())?;
    // ORT owns process-global state, so this handle intentionally remains loaded for process life.
    let handle = unsafe { libc::dlopen(path.as_ptr(), libc::RTLD_NOW | libc::RTLD_LOCAL) };
    if handle.is_null() {
        let message = unsafe {
            let error = libc::dlerror();
            if error.is_null() {
                "unknown dlopen error".to_string()
            } else {
                CStr::from_ptr(error).to_string_lossy().into_owned()
            }
        };
        return Err(anyhow!("onnx_runtime_dylib_load_failed:{message}"));
    }
    let symbol = CString::new("OrtGetApiBase")?;
    if unsafe { libc::dlsym(handle, symbol.as_ptr()) }.is_null() {
        return Err(anyhow!("onnx_runtime_api_symbol_missing"));
    }
    Ok(())
}

fn initialize_ort_runtime() -> Result<()> {
    ORT_RUNTIME_INIT
        .get_or_init(|| {
            let builder = match std::env::var_os("ORT_DYLIB_PATH") {
                Some(runtime_path) => {
                    #[cfg(unix)]
                    preflight_ort_dylib(Path::new(&runtime_path))
                        .map_err(|error| error.to_string())?;
                    ort::init_from(runtime_path).map_err(|error| error.to_string())?
                }
                None => ort::init(),
            };
            builder.with_name("RawEngine AI Registry").commit();
            ort::environment::Environment::current()
                .map(|_| ())
                .map_err(|error| error.to_string())
        })
        .as_ref()
        .map_err(|error| anyhow!("onnx_runtime_initialization_failed:{error}"))?;
    Ok(())
}

pub fn build_ort_session(path: &Path) -> Result<ort::session::Session> {
    initialize_ort_runtime()?;
    Ok(ort::session::Session::builder()?
        .with_execution_providers([ort::ep::CPU::default().build()])
        .map_err(|error| anyhow!(error.to_string()))?
        .with_intra_threads(2)
        .map_err(|error| anyhow!(error.to_string()))?
        .with_inter_threads(1)
        .map_err(|error| anyhow!(error.to_string()))?
        .with_optimization_level(ort::session::builder::GraphOptimizationLevel::All)
        .map_err(|error| anyhow!(error.to_string()))?
        .with_memory_pattern(true)
        .map_err(|error| anyhow!(error.to_string()))?
        .commit_from_file(path)?)
}
