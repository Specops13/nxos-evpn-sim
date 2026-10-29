# Progress

Overall: **45%**

The control-plane engine and NX-OS CLI parser are in the tree. The three example fabrics are built and covered by Vitest (OSPF adjacencies, BGP sessions, EVPN, NVE, L2/L3 host ping, vPC, ESI DF, Multi-Site). The browser UI, Tauri installers, and GitHub Actions are not in yet.

## Milestones

- [ ] **1. Packaging** — static browser app, Tauri v2 Windows NSIS `.exe` and Debian `.deb`, GitHub Actions (web bundle + installers on `v*` tags). Linux `.deb` build verified.
- [ ] **2. Topology UI** — drag-and-drop canvas, named interfaces, JSON save/load/export, localStorage. Example fabrics exist in `src/sim/examples.ts` but are not wired to a canvas yet.
- [ ] **3. NX-OS CLI** — modes, prompts, `?` / tab, abbreviations, `no` forms, feature gating, `show running-config`, `copy run start`, and pipes are implemented in `src/cli/`. Still tightening a few failure-case show results and cleaning the typecheck.
- [x] **4. Control plane** — interfaces and link state, OSPF (point-to-point and broadcast DR/BDR, LSDB/SPF, ECMP), iBGP route reflection and eBGP (allowas-in, disable-peer-as-check, next-hop unchanged, retain route-target all), EVPN types 1–5 with NX-OS `rd auto` / `route-target auto`, VXLAN NVE peers, anycast gateway, vPC, ESI modulus DF, Multi-Site re-origination, host ping/ARP. Three example fabrics converge in Vitest.
- [ ] **5. Tests** — `tests/fabric.test.ts` passes locally (clos, 5-stage, multisite). CLI tests are started. CI is not wired yet.
- [ ] **6. Docs** — `docs/REFERENCES.md` cites the NX-OS 10.x guides used. README, screenshots, and the limitation write-up are still outstanding.

## Log

- 2026-10-28: Researched NX-OS 10.4/10.5/10.6 VXLAN BGP EVPN, Multi-Site, BGP, and show-command references. Branch `cursor/nxos-evpn-sim-fc9f` opened.
- 2026-10-28: Control plane and example fabrics are in. Clos iBGP, 5-stage eBGP, and two-site Multi-Site (vPC + ESI) converge with host pings. CLI parser and show formatters are in progress and pushed with this snapshot.
