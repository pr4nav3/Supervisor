// Release builds get no console window on Windows; debug builds keep it for eprintln.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    supervisor_app_lib::run();
}
