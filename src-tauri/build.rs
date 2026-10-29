fn main() {
    println!("cargo:rerun-if-env-changed=ZENCODE_UPDATER_PUBLIC_KEY");
    #[cfg(feature = "desktop")]
    tauri_build::build()
}
