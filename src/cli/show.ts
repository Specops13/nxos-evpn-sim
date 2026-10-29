import { formatUptime, ipToInt } from '../sim/ip';
import type { Lab } from '../sim/lab';
import { pingHost, pingSwitch } from '../sim/forward';
import { bgpRouterId, shortIntf, vrfIdOf } from '../sim/model';
import type { BgpIpRoute, Device, EvpnRoute } from '../sim/types';

function pad(s: string, n: number): string {
  return s.length >= n ? s : s + ' '.repeat(n - s.length);
}

export function showIpInterfaceBrief(dev: Device, vrf = 'default'): string {
  const vrfs = vrf === 'all' ? ['default', ...dev.config.vrfs.map((v) => v.name)] : [vrf];
  const blocks: string[] = [];
  for (const name of vrfs) {
    const id = vrfIdOf(dev.config, name) || 1;
    const lines = [`IP Interface Status for VRF "${name}"(${id})`, 'Interface            IP Address      Interface Status'];
    for (const intf of dev.config.interfaces) {
      if ((intf.vrf || 'default') !== name) continue;
      if (intf.name === 'nve1') continue;
      const addr = intf.ips.find((a) => !a.secondary)?.ip ?? '';
      const up = !!dev.op.ifOper[intf.name];
      const admin = intf.adminDown ? 'admin-down' : 'admin-up';
      const proto = up ? 'protocol-up/link-up' : 'protocol-down/link-down';
      lines.push(`${pad(shortIntf(intf.name), 21)}${pad(addr, 16)}${proto}/${admin}`);
    }
    blocks.push(lines.join('\n'));
  }
  return blocks.join('\n\n');
}

export function showInterface(dev: Device, name?: string): string {
  const list = name ? dev.config.interfaces.filter((i) => i.name === name || shortIntf(i.name).toLowerCase() === name.toLowerCase()) : dev.config.interfaces.filter((i) => i.name.startsWith('Ethernet') || i.name.startsWith('port-channel') || i.name.startsWith('loopback') || i.name.startsWith('Vlan'));
  if (name && !list.length) return `% Invalid interface format at '^' marker.`;
  return list
    .map((intf) => {
      const up = !!dev.op.ifOper[intf.name];
      const admin = intf.adminDown ? 'down' : 'up';
      const ip = intf.ips.find((a) => !a.secondary);
      const kind = intf.name.startsWith('loopback')
        ? 'Loopback'
        : intf.name.startsWith('Vlan')
          ? 'EtherSVI'
          : intf.name.startsWith('port-channel')
            ? 'Port-Channel'
            : '100/1000/10000/25000/40000/100000 Ethernet';
      const lines = [
        `${intf.name} is ${up ? 'up' : 'down'}`,
        `admin state is ${admin}${intf.name.startsWith('Ethernet') ? ', Dedicated Interface' : ''}`,
        `  Hardware: ${kind}, address: ${dev.systemMac} (bia ${dev.systemMac})`,
      ];
      if (intf.description) lines.push(`  Description: ${intf.description}`);
      if (ip) lines.push(`  Internet Address is ${ip.ip}/${ip.prefix}`);
      for (const sec of intf.ips.filter((a) => a.secondary)) lines.push(`  Secondary Internet Address is ${sec.ip}/${sec.prefix}`);
      lines.push('  MTU 1500 bytes, BW 10000000 Kbit, DLY 10 usec');
      if (intf.switchport) lines.push(`  Port mode is ${intf.mode}`);
      else if (!intf.name.startsWith('loopback')) lines.push('  Port mode is routed');
      lines.push('  full-duplex, 10 Gb/s');
      return lines.join('\n');
    })
    .join('\n\n');
}

export function showIpRoute(dev: Device, vrf = 'default', prefix?: string): string {
  const name = vrf;
  const id = vrfIdOf(dev.config, name);
  const header = [
    `IP Route Table for VRF "${name}"`,
    "'*' denotes best ucast next-hop",
    "'**' denotes best mcast next-hop",
    "'[x/y]' denotes [preference/metric]",
    "'%<string>' in via output denotes VRF <string>",
    '',
  ];
  let routes = dev.op.vrfRib[name] ?? [];
  if (prefix) routes = routes.filter((r) => r.prefix === prefix);
  if (!routes.length && prefix) return header.join('\n') + 'Route not found\n';
  const body: string[] = [];
  const sorted = [...routes].sort((a, b) => ipToInt(a.prefix.split('/')[0]) - ipToInt(b.prefix.split('/')[0]) || a.prefix.length - b.prefix.length);
  for (const r of sorted) {
    const best = r.paths.filter((p) => p.best);
    const attached = best.some((p) => p.attached) ? ', attached' : '';
    body.push(`${r.prefix}, ubest/mbest: ${best.length}/0${attached}`);
    for (const p of r.paths) {
      const star = p.best ? '*' : ' ';
      const via = p.nhVrf ? `${p.nextHop}%${p.nhVrf}` : p.nextHop;
      const age = '00:00:01';
      let proto = p.protocol;
      if (proto.startsWith('ospf-')) proto += ', intra';
      else if (proto.startsWith('bgp-')) proto += p.internal ? ', internal' : ', external';
      const intf = p.intf && p.intf !== 'local' && !p.nhVrf ? `, ${shortIntf(p.intf)}` : '';
      body.push(`    ${star}via ${via}${intf}, [${p.pref}/${p.metric}], ${age}, ${proto}`);
    }
  }
  void id;
  return header.join('\n') + body.join('\n');
}

export function showIpOspfNeighbors(dev: Device): string {
  if (!dev.config.features.includes('ospf')) return 'OSPF feature is not enabled';
  const tags = [...new Set(dev.op.ospfNbrs.map((n) => n.tag))];
  if (!tags.length && !dev.config.ospf.length) return '';
  const blocks: string[] = [];
  const procs = tags.length ? tags : dev.config.ospf.map((p) => p.tag);
  for (const tag of procs) {
    const rows = dev.op.ospfNbrs.filter((n) => n.tag === tag);
    const lines = [
      ` OSPF Process ID ${tag} VRF default`,
      ` Total number of neighbors: ${rows.length}`,
      ' Neighbor ID     Pri State            Up Time  Address         Interface',
    ];
    for (const n of rows) {
      const st = n.role === '-' ? 'FULL/ -' : `FULL/${n.role}`;
      const state = n.state === 'Full' ? st : n.state;
      lines.push(
        ` ${pad(n.routerId, 16)}${pad(String(n.priority), 4)}${pad(state, 17)}${pad(formatUptime(devTick(dev) - n.since), 9)}${pad(n.address, 16)}${shortIntf(n.intf)}`,
      );
    }
    blocks.push(lines.join('\n'));
  }
  return blocks.join('\n');
}

function devTick(dev: Device): number {
  // Uptime is derived by the caller via since stored as absolute lab tick.
  // Devices do not store the lab tick; since is already an absolute tick and
  // format uses a small relative value if the caller passes lab. We encode
  // since as the tick value and compute against a field stashed on op by the CLI.
  return (dev as Device & { __tick?: number }).__tick ?? dev.op.bgpPeers[0]?.since ?? 0;
}

export function attachTick(dev: Device, tick: number): void {
  (dev as Device & { __tick?: number }).__tick = tick;
}

export function showBgpSummary(dev: Device, af: 'ipv4' | 'l2vpn'): string {
  if (!dev.config.features.includes('bgp') || !dev.config.bgp) return 'BGP feature is not enabled';
  const bgp = dev.config.bgp;
  const title = af === 'ipv4' ? 'IPv4 Unicast' : 'L2VPN EVPN';
  const peers = dev.op.bgpPeers.filter((p) => {
    const n = bgp.neighbors.find((x) => x.address === p.address);
    return af === 'ipv4' ? !!n?.afs.ipv4 : !!n?.afs.l2vpn;
  });
  const established = peers.filter((p) => p.state === 'Established').length;
  const routes = af === 'ipv4' ? dev.op.bgpIpv4 : dev.op.evpn;
  const best = routes.filter((r) => r.best).length;
  const lines = [
    `BGP summary information for VRF default, address family ${title}`,
    `BGP router identifier ${bgpRouterId(dev)}, local AS number ${bgp.asn}`,
    `BGP table version is ${dev.op.bgpTableVersion}, ${title} config peers ${peers.length}, capable peers ${established}`,
    `${best} network entries and ${routes.length} paths using ${routes.length * 96} bytes of memory`,
    `BGP attribute entries [0/0], BGP AS path entries [0/0]`,
    `BGP community entries [0/0], BGP clusterlist entries [0/0]`,
    '',
    'Neighbor        V    AS MsgRcvd MsgSent   TblVer  InQ OutQ Up/Down  State/PfxRcd',
  ];
  for (const p of peers) {
    const remote = bgp.neighbors.find((n) => n.address === p.address)?.remoteAs ?? 0;
    const pfx = p.state === 'Established' ? String(af === 'ipv4' ? p.ipv4Pfx : p.evpnPfx) : p.state;
    const up = formatUptime(devTick(dev) - p.since);
    lines.push(
      `${pad(p.address, 16)}${pad('4', 5)}${pad(String(remote), 8)}${pad(String(p.msgIn), 8)}${pad(String(p.msgOut), 10)}${pad(String(dev.op.bgpTableVersion), 8)}${pad('0', 4)}${pad('0', 5)}${pad(up, 10)}${pfx}`,
    );
  }
  return lines.join('\n');
}

export function evpnNlri(r: EvpnRoute): string {
  if (r.type === 2) {
    const ipLen = r.macIp ? 32 : 0;
    const ip = r.macIp ?? '0.0.0.0';
    const plen = r.macIp ? 272 : 216;
    return `[2]:[${r.esi || '0'}]:[${r.ethTag}]:[48]:[${r.mac}]:[${ipLen}]:[${ip}]/${plen}`;
  }
  if (r.type === 3) return `[3]:[0]:[32]:[${r.nextHop}]/88`;
  if (r.type === 4) return `[4]:[${r.esi}]:[32]:[${r.nextHop}]/136`;
  if (r.type === 5) {
    const [ip, len] = (r.prefix ?? '0.0.0.0/0').split('/');
    return `[5]:[0]:[0]:[${len}]:[${ip}]:[0.0.0.0]/224`;
  }
  if (r.ethTag === 4294967295) return `[1]:[${r.esi}]:[4294967295]/152`;
  return `[1]:[${r.esi}]:[${r.ethTag}]:[32]:[0x0]/184`;
}

function pathChar(source: string): string {
  if (source === 'local') return 'l';
  if (source === 'ibgp') return 'i';
  if (source === 'ebgp') return 'e';
  return '?';
}

export function showBgpEvpn(dev: Device, routeType?: number): string {
  if (!dev.config.features.includes('bgp') || !dev.config.bgp) return 'BGP feature is not enabled';
  let routes = dev.op.evpn;
  if (routeType) routes = routes.filter((r) => r.type === routeType);
  const lines = [
    'BGP routing table information for VRF default, address family L2VPN EVPN',
    `BGP table version is ${dev.op.bgpTableVersion}, local router ID is ${bgpRouterId(dev)}`,
    'Status: s-suppressed, x-deleted, S-stale, d-dampened, h-history, *-valid, >-best',
    'Path type: i-internal, e-external, c-confed, l-local, a-aggregate, r-redist, I-injected',
    'Origin codes: i - IGP, e - EGP, ? - incomplete, | - multipath, & - backup',
    '',
    '   Network            Next Hop            Metric     LocPrf     Weight Path',
  ];
  const byRd = new Map<string, EvpnRoute[]>();
  for (const r of routes) {
    const g = byRd.get(r.rd) ?? [];
    g.push(r);
    byRd.set(r.rd, g);
  }
  for (const [rd, group] of byRd) {
    lines.push(`Route Distinguisher: ${rd}`);
    for (const r of group) {
      const flags = `${r.valid ? '*' : ' '}${r.best && !r.multipath ? '>' : r.multipath && r.best ? '|' : ' '}${pathChar(r.source)}`;
      // multipath best that is not the first still shows *> if best and not the tie display.
      const flag = r.best ? (r.multipath ? `*|${pathChar(r.source)}` : `*>${pathChar(r.source)}`) : `* ${pathChar(r.source)}`;
      void flags;
      lines.push(`${flag}${evpnNlri(r)}`);
      const lp = r.localPref != null ? String(r.localPref) : '';
      const path = r.asPath.length ? r.asPath.join(' ') + ' ' : '';
      lines.push(`                      ${pad(r.nextHop, 16)}               ${pad(lp, 11)}${pad(String(r.weight), 7)}${path}${r.origin}`);
    }
  }
  return lines.join('\n');
}

export function showBgpIpv4(dev: Device): string {
  if (!dev.config.features.includes('bgp') || !dev.config.bgp) return 'BGP feature is not enabled';
  const lines = [
    'BGP routing table information for VRF default, address family IPv4 Unicast',
    `BGP table version is ${dev.op.bgpTableVersion}, local router ID is ${bgpRouterId(dev)}`,
    'Status: s-suppressed, x-deleted, S-stale, d-dampened, h-history, *-valid, >-best',
    'Path type: i-internal, e-external, c-confed, l-local, a-aggregate, r-redist, I-injected',
    'Origin codes: i - IGP, e - EGP, ? - incomplete, | - multipath, & - backup',
    '',
    '   Network            Next Hop            Metric     LocPrf     Weight Path',
  ];
  const routes = [...dev.op.bgpIpv4].sort((a, b) => a.prefix.localeCompare(b.prefix));
  for (const r of routes) lines.push(...formatIp(r));
  return lines.join('\n');
}

function formatIp(r: BgpIpRoute): string[] {
  const flag = r.best ? (r.multipath ? `*|${pathChar(r.source)}` : `*>${pathChar(r.source)}`) : `* ${pathChar(r.source)}`;
  const lp = r.localPref != null ? String(r.localPref) : '';
  const path = r.asPath.length ? r.asPath.join(' ') + ' ' : '';
  return [`${flag}${r.prefix}`, `                      ${pad(r.nextHop, 16)}               ${pad(lp, 11)}${pad(String(r.weight), 7)}${path}${r.origin}`];
}

export function showNvePeers(dev: Device): string {
  if (!dev.config.features.includes('nv overlay')) return 'NV overlay feature is not enabled';
  const lines = [
    'Interface Peer-IP          State LearnType Uptime   Router-Mac',
    '--------- ---------------  ----- --------- -------- -----------------',
  ];
  const tick = devTick(dev);
  for (const p of dev.op.nvePeers) {
    lines.push(
      `${pad('nve1', 10)}${pad(p.peerIp, 17)}${pad(p.state, 6)}${pad(p.learn, 10)}${pad(formatUptime(tick - p.since), 9)}${p.routerMac}`,
    );
  }
  return lines.join('\n');
}

export function showNveVni(dev: Device): string {
  if (!dev.config.features.includes('nv overlay')) return 'NV overlay feature is not enabled';
  const lines = [
    'Codes: CP - Control Plane        DP - Data Plane',
    '       UC - Unconfigured         SA - Suppress ARP',
    '',
    'Interface VNI      Multicast-group   State Mode Type [BD/VRF]      Flags',
    '--------- -------- ----------------- ----- ---- ------------------ -----',
  ];
  for (const v of dev.op.nveVnis) {
    const typ = `${v.kind} [${v.bd}]`;
    lines.push(
      `${pad('nve1', 10)}${pad(String(v.vni), 9)}${pad(v.mcast, 18)}${pad(v.up ? 'Up' : 'Down', 6)}${pad('CP', 5)}${pad(typ, 19)}${v.flags}`,
    );
  }
  return lines.join('\n');
}

export function showNveInterface(dev: Device): string {
  if (!dev.config.features.includes('nv overlay')) return 'NV overlay feature is not enabled';
  const nve = dev.config.interfaces.find((i) => i.name === 'nve1');
  if (!nve) return '% No nve interface';
  const up = !!dev.op.ifOper['nve1'];
  const src = dev.config.interfaces.find((i) => i.name === nve.nveSource);
  const primary = src?.ips.find((a) => !a.secondary)?.ip ?? '0.0.0.0';
  const secondary = src?.ips.find((a) => a.secondary)?.ip ?? '0.0.0.0';
  return [
    `Interface: nve1, State: ${up ? 'Up' : 'Down'}, encapsulation: VXLAN`,
    ` VPC Capability: ${secondary !== '0.0.0.0' ? 'VPC-VIP' : 'VPC-VIP-Only [not-notified]'}`,
    ` Local Router MAC: ${dev.systemMac}`,
    ` Host Learning Mode: ${nve.nveHostReachBgp ? 'Control-Plane' : 'Data-Plane'}`,
    ` Source-Interface: ${nve.nveSource ?? 'unconfigured'} (primary: ${primary}, secondary: ${secondary})`,
    ` Source Interface State: ${src && dev.op.ifOper[src.name] ? 'Up' : 'Down'}`,
  ].join('\n');
}

export function showL2Mac(dev: Device): string {
  const lines = ['Topology    Mac Address    Prod   Next Hop (s)', '----------- -------------- ------ ---------------'];
  for (const m of dev.op.l2mac) {
    lines.push(`${pad(String(m.vlan), 12)}${pad(m.mac, 15)}${pad(m.prod, 7)}${m.nextHop}`);
  }
  return lines.join('\n');
}

export function showL2MacIp(dev: Device): string {
  const lines = [
    'Topology ID Mac Address    Prod Host IP                 Next Hop (s)',
    '----------- -------------- ---- ------------------------------------------------------',
  ];
  for (const m of dev.op.l2macip) {
    lines.push(`${pad(String(m.vlan), 12)}${pad(m.mac, 15)}${pad(m.prod, 5)}${pad(m.ip, 25)}${m.nextHop}`);
  }
  return lines.join('\n');
}

export function showMacTable(dev: Device): string {
  const lines = [
    'Legend:',
    '        * - primary entry, G - Gateway MAC, (R) - Routed MAC, O - Overlay MAC',
    '        age - seconds since last seen,+ - primary entry using vPC Peer-Link,',
    '        (T) - True, (F) - False, C - ControlPlane MAC',
    '   VLAN     MAC Address      Type      age     Secure NTFY Ports',
    '---------+-----------------+--------+---------+------+----+------------------',
  ];
  for (const m of dev.op.macTable) {
    const age = m.type === 'static' ? '-' : '0';
    lines.push(`${m.flag}   ${pad(String(m.vlan), 7)}${pad(m.mac, 17)}${pad(m.type, 9)}${pad(age, 9)}F      F    ${m.port}`);
  }
  return lines.join('\n');
}

export function showVpc(dev: Device): string {
  if (!dev.config.features.includes('vpc')) return 'vPC feature is not enabled';
  if (!dev.config.vpc || !dev.op.vpc) return 'No vPC domain configured';
  const v = dev.op.vpc;
  const c = dev.config.vpc;
  const lines = [
    'Legend:',
    '                (*) - local vPC is down, forwarding via vPC peer-link',
    '',
    `vPC domain id                     : ${c.domain}`,
    `Peer status                       : ${v.peerStatus}`,
    `vPC keep-alive status             : ${v.keepalive}`,
    `Configuration consistency status  : ${v.consistency}`,
    `Per-vlan consistency status       : ${v.consistency}`,
    `Type-2 consistency status         : ${v.consistency}`,
    `vPC role                          : ${v.role}`,
    `Number of vPCs configured         : ${v.members.length}`,
    `Peer Gateway                      : ${c.peerGateway ? 'Enabled' : 'Disabled'}`,
    'Dual-active excluded VLANs        : -',
    'Graceful Consistency Check        : Enabled',
    'Auto-recovery status              : Disabled',
    'Delay-restore status              : Timer is off.(timeout = 30s)',
    'Delay-restore SVI status          : Timer is off.(timeout = 10s)',
    'Operational Layer3 Peer-router    : Disabled',
    '',
    'vPC Peer-link status',
    '---------------------------------------------------------------------',
    'id    Port   Status Active vlans',
    '--    ----   ------ -------------------------------------------------',
  ];
  if (v.peerLinkIf) lines.push(`1     ${pad(v.peerLinkIf, 7)}${pad(v.peerLinkUp ? 'up' : 'down', 7)}${v.activeVlans}`);
  lines.push(
    '',
    'vPC status',
    '----------------------------------------------------------------------------',
    'Id    Port          Status Consistency Reason                Active vlans',
    '--    ------------  ------ ----------- ------                ---------------',
  );
  for (const m of v.members) {
    lines.push(`${pad(String(m.id), 6)}${pad(m.port, 14)}${pad(m.up ? 'up' : 'down', 7)}${pad(v.consistency, 12)}${pad(v.consistency, 22)}${m.vlans}`);
  }
  return lines.join('\n');
}

export function showVlan(dev: Device): string {
  const lines = ['VLAN Name                             Status    Ports', '---- -------------------------------- --------- -------------------------------'];
  for (const v of dev.config.vlans) {
    const ports = dev.config.interfaces
      .filter((i) => (i.name.startsWith('Ethernet') || i.name.startsWith('port-channel')) && i.switchport && dev.op.ifOper[i.name])
      .filter((i) => (i.mode === 'access' ? i.accessVlan === v.id : i.trunkVlans === 'all' || i.trunkVlans.includes(v.id)))
      .map((i) => shortIntf(i.name));
    const name = v.name ?? (v.id === 1 ? 'default' : `VLAN${String(v.id).padStart(4, '0')}`);
    lines.push(`${pad(String(v.id), 5)}${pad(name, 33)}active    ${ports.join(', ')}`);
  }
  return lines.join('\n');
}

export function showVrf(dev: Device): string {
  const lines = ['VRF-Name                           VRF-ID State   Reason', 'default                                 1 Up      --', 'management                              2 Up      --'];
  dev.config.vrfs.forEach((v, i) => {
    lines.push(`${pad(v.name, 35)}${pad(String(i + 3), 7)}Up      --`);
  });
  return lines.join('\n');
}

export function showLldp(dev: Device, kind: 'lldp' | 'cdp'): string {
  const feature = kind === 'lldp' ? 'lldp' : 'cdp';
  if (!dev.config.features.includes(feature)) return kind === 'lldp' ? 'LLDP is not enabled' : 'CDP is not enabled';
  const rows = kind === 'lldp' ? dev.op.lldp : dev.op.cdp;
  const lines = [
    'Capability codes:',
    '  (R) Router, (B) Bridge, (T) Telephone, (C) DOCSIS Cable Device',
    '  (W) WLAN Access Point, (P) Repeater, (S) Station, (O) Other',
    'Device ID            Local Intf      Hold-time  Capability  Port ID',
  ];
  for (const r of rows) {
    lines.push(`${pad(r.deviceId, 21)}${pad(shortIntf(r.localIntf), 16)}${pad(String(r.hold), 11)}${pad(r.capability, 12)}${r.portId}`);
  }
  lines.push(`Total entries displayed: ${rows.length}`);
  return lines.join('\n');
}

export function showEs(dev: Device): string {
  const lines = [
    'ESI                  Orig Rtr. IP Addr   Prod    Ifindex  DF Election',
    '-------------------- ------------------- ------- -------- -----------',
  ];
  for (const e of dev.op.esi) {
    const local = dev.op.nvePeers.length >= 0;
    void local;
    lines.push(`${pad(e.esi, 21)}${pad(e.dfIp, 20)}VXLAN   nve      Modulus`);
    for (const v of e.vteps) {
      if (v.ip === e.dfIp) continue;
      lines.push(`${pad(e.esi, 21)}${pad(v.ip, 20)}BGP     N/A      Modulus`);
    }
  }
  if (!dev.op.esi.length) return lines.join('\n');
  const detail = dev.op.esi.map((e) => {
    const role = e.df ? 'DF' : 'Non-DF';
    return [`ESI: ${e.esi}`, `   Interface: ${e.intf}`, `   ES State: ${e.up ? 'Up' : 'Down'}`, `   NVE Interface: nve1`, `   DF Election Algo: Modulus`, `   Designated Forwarder: ${role} (${e.dfIp})`, `   VTEPs: ${e.vteps.map((v) => `${v.ip}${v.df ? ' DF' : ''}`).join(', ')}`].join('\n');
  });
  return lines.join('\n') + '\n\n' + detail.join('\n\n');
}

export function ping(lab: Lab, dev: Device, dst: string, vrf?: string, count = 5): string {
  attachTick(dev, lab.tick);
  if (dev.role === 'host') return pingHost(lab, dev, dst, count);
  return pingSwitch(lab, dev, dst, vrf ?? 'default', count);
}
