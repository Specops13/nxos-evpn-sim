#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    nxos_evpn_sim_lib::run();
}
