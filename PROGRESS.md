# Progress

Overall: **97%** (release assets built; publish step failed and is being fixed)

The lab runs in the browser, the three example fabrics converge, and Vitest is green locally. Release automation is on this branch: merges to `main` publish the next patch (first release `v0.1.0`), and `cursor/*` pull requests merge themselves after CI and call the release workflow directly so a `GITHUB_TOKEN` merge still produces the release.

## Milestones

- [x] **1. Packaging** — Vite static bundle. Tauri v2. Local `.deb` inspected previously. CI builds the web bundle and `.deb`. Releases: `.github/workflows/release.yml` (called), `.github/workflows/release-dispatch.yml` (push to `main` and `v*` tags), `.github/workflows/automerge.yml` (`cursor/*` merges after CI and calls Release). Windows NSIS is built only in the release workflow.
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
- 2026-10-29: Automatic patch releases on merge to main, and auto-merge for `cursor/*` once CI passes. The auto-merge workflow calls Release via `workflow_call` because a `GITHUB_TOKEN` merge does not emit `push`.
