# Progress

Overall: **100%**

The lab runs in the browser, the three example fabrics converge, Vitest is green locally (12 tests), and a Debian package was built and inspected on this machine. Windows NSIS is defined in the release workflow and was not built here (this environment is Linux).

## Milestones

- [x] **1. Packaging** — Vite static bundle (`npm run build`). Tauri v2 app. Local `.deb` verified: `nxos-evpn-lab_0.1.0_amd64.deb` (Package `nxos-evpn-lab`, Depends `libwebkit2gtk-4.1-0`, `libgtk-3-0`, binary `usr/bin/nxos-evpn-sim`). GitHub Actions: `.github/workflows/ci.yml` (tests, web bundle, `.deb`) and `.github/workflows/release.yml` (tag `v*` attaches web zip, NSIS `.exe`, and `.deb`). Windows installer was not built in this Linux environment.
- [x] **2. Topology UI** — drag-and-drop canvas, named interfaces, JSON export/import, `localStorage`, and the three example fabrics (clos iBGP, 5-stage eBGP, Multi-Site with vPC and ESI).
- [x] **3. NX-OS CLI** — modes and prompts, `?`, Tab, abbreviations, `no` forms, feature gating, `show running-config`, `copy run start`, and pipes (`include`, `exclude`, `begin`, `section`, `count`).
- [x] **4. Control plane** — interface/link state, OSPF, iBGP route reflection and eBGP (allowas-in, disable-peer-as-check, next-hop unchanged, retain route-target all), EVPN types 1–5 with `rd auto` / `route-target auto`, VXLAN NVE, anycast gateway, vPC, ESI modulus DF, Multi-Site re-origination, host ping/ARP.
- [x] **5. Tests** — `npm test`: OSPF adjacency and shutdown, BGP establishment and AS mismatch, EVPN type 2/3/5 through RRs and eBGP super-spines, NVE peers, anycast-gateway MAC, vPC, ESI DF, multisite re-origination, CLI show parsing. CI runs the same suite.
- [x] **6. Docs** — README (run, install, command list, limitations, screenshots) and `docs/REFERENCES.md`.

## Verification

- Push to `origin` confirmed with `git ls-remote` (branch `cursor/nxos-evpn-sim-fc9f`).
- Browser: clos fabric shows **BGP 16/16 Established**. On leaf1, `show bgp l2vpn evpn` lists Route Distinguishers and `show nve peers` lists peers **Up**.
- `dpkg-deb -I` / `-c` succeeded for `nxos-evpn-lab_0.1.0_amd64.deb`.
- Not verified here: the Windows NSIS `.exe` (workflow only) and a full `dpkg -i` install on a desktop session (the package control and payload were inspected).

## Log

- 2026-10-28: NX-OS 10.x research. Control plane, CLI, and example fabrics.
- 2026-10-29: Topology UI, Tauri `.deb` (Rust 1.99; 1.83 cannot build Tauri 2.7), screenshots, README.
