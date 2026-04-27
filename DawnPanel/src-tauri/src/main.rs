#![cfg_attr(all(not(debug_assertions), windows), windows_subsystem = "windows")]

fn main() {
  dawn_panel_lib::run();
}
