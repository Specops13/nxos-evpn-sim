# NX-OS references

Command syntax, mode prompts, and show-command fields in this simulator are taken from Cisco's published Nexus 9000 NX-OS 10.x documentation. Behavior that the guides leave ambiguous is called out in the README limitations rather than invented.

## VXLAN BGP EVPN

- Cisco Nexus 9000 Series NX-OS VXLAN Configuration Guide, Release 10.6(x) — Configure VXLAN BGP EVPN  
  https://www.cisco.com/c/en/us/td/docs/dcn/nx-os/nexus9000/106x/configuration/vxlan/cisco-nexus-9000-series-nx-os-vxlan-configuration-guide-release-106x/m_configuring_vxlan_bgp_evpn.html  
  Used for VTEP BGP configuration, `rd auto` / `route-target auto` derivation, iBGP spine route-reflector steps, eBGP spine `retain route-target all`, `disable-peer-as-check`, `set ip next-hop unchanged`, NVE member VNI / ingress replication / associate-vrf, `fabric forwarding anycast-gateway-mac`, `fabric forwarding mode anycast-gateway`, and the sample output for:
  - `show nve peers`
  - `show nve vni`
  - `show bgp l2vpn evpn summary`
  - `show bgp l2vpn evpn` (including `[2]:[ESI]:[VNI]:[48]:[MAC]:[IP-len]:[IP]/len`)
  - `show l2route evpn mac all`
  - `show l2route evpn mac-ip all`
  - `show l2route evpn ethernet-segment all`

- Cisco Nexus 9000 Series NX-OS VXLAN Configuration Guide, Release 10.5(x) — Configure VXLAN BGP EVPN  
  https://www.cisco.com/c/en/us/td/docs/dcn/nx-os/nexus9000/105x/configuration/vxlan/cisco-nexus-9000-series-nx-os-vxlan-configuration-guide-release-105x/m_configuring_vxlan_bgp_evpn.html  
  Same RD/RT auto rules (IP-VRF uses VRF ID starting at 3; MAC-VRF uses VLAN ID + 32767; 4-byte ASN route-targets use AS_TRANS 23456).

## EVPN Multi-Site

- Cisco Nexus 9000 Series NX-OS VXLAN Configuration Guide, Release 10.5(x) — Configuring VXLAN EVPN Multi-Site  
  https://www.cisco.com/c/en/us/td/docs/dcn/nx-os/nexus9000/105x/configuration/vxlan/cisco-nexus-9000-series-nx-os-vxlan-configuration-guide-release-105x/m_configuring_multisite_93x.html  
  Used for `evpn multisite border-gateway`, `multisite border-gateway interface loopback`, `evpn multisite dci-tracking`, `evpn multisite fabric-tracking`, `peer-type fabric-external`, `rewrite-evpn-rt-asn`, dual-RD re-origination (`site-id:VNI` secondary RD), and `ingress-replication protocol bgp`.

`rewrite-evpn-rt-asn` is implemented as a rewrite of the incoming route-target ASN to the **local** BGP ASN. That is the behavior required for `route-target import auto` to match across sites with different ASNs, and it matches the command's stated purpose ("simplify the MAC-VRF and IP-VRF configuration"). The 10.5 guide text also says the ASN is changed "to match the BGP-configured neighbor's remote AS number," which would be a no-op when the received auto-RT already carries the peer ASN. The local-ASN rewrite is what makes the published auto-RT design work; see README limitations.

## BGP, OSPF, VRF, CLI

- Cisco Nexus 9000 Series NX-OS Unicast Routing Configuration Guide, Release 10.6(x) — BGP  
  https://www.cisco.com/c/en/us/td/docs/dcn/nx-os/nexus9000/106x/configuration/unicast-routing-configuration/cisco-nexus-9000-series-nx-os-unicast-routing-configuration-guide/configuring-bgp.html  
  Address families, `show bgp` preference over `show ip bgp`, and IPv4 unicast route display (`ubest/mbest`, `[preference/metric]`).

- Cisco Nexus 9000 Series NX-OS Unicast Routing Configuration Guide, Release 10.6(x) — Configure Layer 3 virtualization  
  https://www.cisco.com/c/en/us/td/docs/dcn/nx-os/nexus9000/106x/configuration/unicast-routing-configuration/cisco-nexus-9000-series-nx-os-unicast-routing-configuration-guide/m_configuring_layer_3_virtualization.html  
  `vrf context`, `show vrf`.

- Cisco Nexus 9000 Series NX-OS Fundamentals Configuration Guide, Release 10.3(x) — Understanding the Command-Line Interface  
  https://www.cisco.com/c/en/us/td/docs/dcn/nx-os/nexus9000/103x/configuration/fundamentals/cisco-nexus-9000-nx-os-fundamentals-configuration-guide-103x/m-understanding-the-cli.html  
  Pipes (`include`, `exclude`, `begin`, `count`, `section`), `% Invalid command at '^' marker.`

- Cisco Nexus 9000 Series NX-OS Command Reference (Show Commands), Release 10.5(x)  
  https://www.cisco.com/c/en/us/td/docs/dcn/nx-os/nexus9000/105x/command-reference/show/b_n9k_show_commands_1051.html  
  Command existence and syntax for `show l2route evpn mac`, `show l2route evpn mac-ip`, `show bgp summary`, `show lldp neighbors`, `show vlan`, `show vrf`, `show ip interface`, `show ip route`.

- Cisco NX-OS/IOS OSPF Comparison  
  https://www.cisco.com/c/en/us/td/docs/switches/datacenter/sw/nx-os/tech_note/cisco_nxos_ios_ospf_comparison.pdf  
  `show ip ospf neighbors` (plural) on NX-OS.

- Nexus 6000 NX-OS unicast routing command reference — `show ip ospf neighbors`  
  https://www.cisco.com/en/US/docs/switches/datacenter/nexus6000/sw/command/reference/unicast/7x/n6k-ospf_cmds_show.pdf  
  Neighbor table columns: Neighbor ID, Pri, State, Up Time, Address, Interface. Point-to-point state is displayed as `FULL/ -`.

## Standards used where NX-OS points at them

- RFC 7432 — BGP MPLS-Based Ethernet VPN (route types 1–4, modulus DF election). NX-OS `show l2route evpn ethernet-segment` reports DF election as `Modulus`.
- RFC 9136 — IP Prefix Advertisement in EVPN (route type 5).
- RFC 4364 — BGP/MPLS IP VPNs (RD/RT encoding cited by the VXLAN guide for `rd auto` and `route-target auto`).
- RFC 6793 — AS_TRANS 23456 for 4-byte ASNs in 2-byte RT fields (cited by the VXLAN guide).

## vPC

vPC CLI (`vpc domain`, `peer-keepalive`, `vpc peer-link`, `vpc <id>`, `show vpc`, `show vpc brief`) follows the Nexus 9000 vPC configuration model and the show-command columns documented for `show vpc brief` (domain id, peer status, keep-alive status, consistency, role, peer-link table, vPC status table). Timer features (delay-restore, auto-recovery) are reported at their documented defaults and are not simulated; see README.
