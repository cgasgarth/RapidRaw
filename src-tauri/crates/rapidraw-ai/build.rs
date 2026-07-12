use std::env;
use std::fs;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};

use sha2::{Digest, Sha256};

fn sha256(path: &Path) -> Result<String, Box<dyn std::error::Error>> {
    let mut file = fs::File::open(path)?;
    let mut hasher = Sha256::new();
    let mut buffer = [0_u8; 64 * 1024];
    loop {
        let read = file.read(&mut buffer)?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
    }
    Ok(hex::encode(hasher.finalize()))
}

fn runtime_manifest(
    target_os: &str,
    target_arch: &str,
) -> (&'static str, &'static str, &'static str) {
    match (target_os, target_arch) {
        ("windows", "x86_64") => (
            "onnxruntime-windows-x86_64.dll",
            "onnxruntime.dll",
            "579b636403983254346a5c1d80bd28f1519cd1e284cd204f8d4ff41f8d711559",
        ),
        ("windows", "aarch64") => (
            "onnxruntime-windows-aarch64.dll",
            "onnxruntime.dll",
            "79281671a386ed1baab9dbdbb09fe55f99577011472e9526cf9d0b468bb6bcc7",
        ),
        ("linux", "x86_64") => (
            "libonnxruntime-linux-x86_64.so",
            "libonnxruntime.so",
            "3da6146e14e7b8aaec625dde11d6114c7457c87a5f93d744897da8781e35c673",
        ),
        ("linux", "aarch64") => (
            "libonnxruntime-linux-aarch64.so",
            "libonnxruntime.so",
            "0afd69a0ae38c5099fd0e8604dda398ac43dee67cd9c6394b5142b19e82528de",
        ),
        ("macos", "x86_64") => (
            "libonnxruntime-macos-x86_64.dylib",
            "libonnxruntime.dylib",
            "283e595e61cf65df7a6b1d59a1616cbd35c8b6399dd90d799d99b71a3ff83160",
        ),
        ("macos", "aarch64") => (
            "libonnxruntime-macos-aarch64.dylib",
            "libonnxruntime.dylib",
            "2b885992d3d6fa4130d39ec84a80d7504ff52750027c547bb22c86165f19406a",
        ),
        ("android", "aarch64") => (
            "libonnxruntime-android-arm64-v8a.so",
            "libonnxruntime.so",
            "999ecfdb5b5a13e4097487773b6d71ce8a075408a237daab072e8f5e817bd78e",
        ),
        _ => panic!("unsupported AI runtime target: {target_os}-{target_arch}"),
    }
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    println!("cargo:rerun-if-changed=build.rs");
    if env::var_os("CARGO_FEATURE_COMPILE_ONLY").is_some() {
        println!("cargo:warning=rapidraw-ai compile-only build; no ONNX Runtime artifact work");
        return Ok(());
    }

    let target_os = env::var("CARGO_CFG_TARGET_OS")?;
    let target_arch = env::var("CARGO_CFG_TARGET_ARCH")?;
    let (download_name, library_name, expected) = runtime_manifest(&target_os, &target_arch);
    let crate_dir = PathBuf::from(env::var("CARGO_MANIFEST_DIR")?);
    let app_dir = crate_dir.join("../..");
    let destination_dir = if target_os == "android" {
        app_dir.join("libs/arm64-v8a")
    } else {
        app_dir.join("resources")
    };
    fs::create_dir_all(&destination_dir)?;
    let destination = destination_dir.join(library_name);
    if destination.exists() && sha256(&destination)? == expected {
        return Ok(());
    }

    let url = format!(
        "https://huggingface.co/CyberTimon/RapidRAW-Models/resolve/main/onnxruntimes-v1.22.0/{download_name}?download=true"
    );
    let temporary = PathBuf::from(env::var("OUT_DIR")?).join(library_name);
    let mut response = reqwest::blocking::get(url)?.error_for_status()?;
    let mut file = fs::File::create(&temporary)?;
    std::io::copy(&mut response, &mut file)?;
    file.flush()?;
    file.sync_all()?;
    if sha256(&temporary)? != expected {
        let _ = fs::remove_file(&temporary);
        return Err("ONNX Runtime artifact digest mismatch".into());
    }
    fs::copy(&temporary, &destination)?;
    fs::remove_file(temporary)?;

    if target_os == "android" {
        let jni_dir = app_dir.join("gen/android/app/src/main/jniLibs/arm64-v8a");
        fs::create_dir_all(&jni_dir)?;
        fs::copy(&destination, jni_dir.join(library_name))?;
        println!(
            "cargo:rustc-env=ORT_LIB_LOCATION={}",
            destination_dir.display()
        );
        println!("cargo:rustc-env=ORT_STRATEGY=manual");
        println!(
            "cargo:rustc-link-search=native={}",
            destination_dir.display()
        );
    }
    Ok(())
}
