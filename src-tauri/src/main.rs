#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    #[cfg(target_os = "linux")]
    std::env::set_var("GTK_USE_PORTAL", "1");

    personal_os_lib::run()
}
