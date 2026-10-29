import { cmpIp, ipToInt, isIp, networkOf, normalizeEsi, normalizeMac, sameSubnet } from './ip';
import type {
  BgpAfCfg,
  BgpCfg,
  Device,
  DeviceCfg,
  FsmMem,
  InterfaceCfg,
  Ipv4Addr,
  OpState,
  Role,
  RouteMapCfg,
  RouteMapEntry,
  VlanCfg,
} from './types';

export function emptyOp(): OpState {
  return {
    ifOper: {},
    lldp: [],
    cdp: [],
    ospfNbrs: [],
    rib: [],
    vrfRib: {},
    bgpPeers: [],
    bgpIpv4: [],
    evpn: [],
    bgpTableVersion: 0,
    l2mac: [],
    l2macip: [],
    macTable: [],
    nvePeers: [],
    nveVnis: [],
    esi: [],
  };
}

export function emptyMem(): FsmMem {
  return { ospf: {}, bgp: {}, nveSince: {}, ribInV4: {}, ribInEvpn: {} };
}

export function blankConfig(hostname: string): DeviceCfg {
  return {
    hostname,
    features: [],
    nvOverlayEvpn: false,
    vlans: [{ id: 1, name: 'default' }],
    vrfs: [],
    interfaces: [],
    ospf: [],
    evpnVnis: [],
    routeMaps: [],
  };
}

let macSeq = 1;
export function allocMac(): string {
  const n = macSeq++;
  const a = (n >> 8) & 0xff;
  const b = n & 0xff;
  return `5000.0000.${a.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
}

export function createDevice(opts: {
  id: string;
  role: Role;
  hostname?: string;
  x?: number;
  y?: number;
  systemMac?: string;
}): Device {
  const hostname = opts.hostname ?? opts.id;
  const dev: Device = {
    id: opts.id,
    role: opts.role,
    x: opts.x ?? 80,
    y: opts.y ?? 80,
    systemMac: opts.systemMac ?? allocMac(),
    config: blankConfig(hostname),
    startup: null,
    op: emptyOp(),
    mem: emptyMem(),
  };
  if (opts.role !== 'host') {
    ensureInterface(dev, 'loopback0');
    dev.config.interfaces.find((i) => i.name === 'loopback0')!.adminDown = false;
  }
  return dev;
}

export function hasFeature(dev: Device, feature: string): boolean {
  return dev.config.features.includes(feature);
}

export function canonicalIntf(input: string): string | null {
  const s = input.trim();
  let m: RegExpExecArray | null;
  if ((m = /^(?:ethernet|eth|e)(\d+)\/(\d+)$/i.exec(s))) return `Ethernet${m[1]}/${m[2]}`;
  if ((m = /^(?:loopback|lo)(\d+)$/i.exec(s))) return `loopback${m[1]}`;
  if ((m = /^(?:vlan|vl)(\d+)$/i.exec(s))) return `Vlan${m[1]}`;
  if ((m = /^(?:port-channel|po)(\d+)$/i.exec(s))) return `port-channel${m[1]}`;
  if ((m = /^nve(\d+)$/i.exec(s))) return `nve${m[1]}`;
  return null;
}

export function shortIntf(name: string): string {
  if (name.startsWith('Ethernet')) return 'Eth' + name.slice('Ethernet'.length);
  if (name.startsWith('loopback')) return 'Lo' + name.slice('loopback'.length);
  if (name.startsWith('port-channel')) return 'Po' + name.slice('port-channel'.length);
  return name;
}

export function intfKind(name: string): 'eth' | 'lo' | 'vlan' | 'po' | 'nve' | 'other' {
  if (name.startsWith('Ethernet')) return 'eth';
  if (name.startsWith('loopback')) return 'lo';
  if (name.startsWith('Vlan')) return 'vlan';
  if (name.startsWith('port-channel')) return 'po';
  if (name.startsWith('nve')) return 'nve';
  return 'other';
}

export function defaultInterface(name: string): InterfaceCfg {
  const kind = intfKind(name);
  const l2 = kind === 'eth' || kind === 'po';
  return {
    name,
    adminDown: kind === 'eth' || kind === 'po' || kind === 'vlan' || kind === 'nve',
    switchport: l2,
    mode: 'access',
    accessVlan: 1,
    trunkVlans: 'all',
    vrf: 'default',
    ips: [],
    nveMembers: [],
  };
}

export function ensureInterface(dev: Device, name: string): InterfaceCfg {
  const canon = canonicalIntf(name) ?? name;
  let intf = dev.config.interfaces.find((i) => i.name === canon);
  if (!intf) {
    intf = defaultInterface(canon);
    dev.config.interfaces.push(intf);
  }
  return intf;
}

export function getIntf(dev: Device, name: string): InterfaceCfg | undefined {
  const canon = canonicalIntf(name) ?? name;
  return dev.config.interfaces.find((i) => i.name === canon);
}

export function primaryIp(intf: InterfaceCfg | undefined): Ipv4Addr | undefined {
  return intf?.ips.find((a) => !a.secondary) ?? intf?.ips[0];
}

export function operUp(dev: Device, name: string): boolean {
  const canon = canonicalIntf(name) ?? name;
  return !!dev.op.ifOper[canon];
}

export function vrfIdOf(cfg: DeviceCfg, name: string): number {
  if (name === 'default') return 1;
  if (name === 'management') return 2;
  const idx = cfg.vrfs.findIndex((v) => v.name === name);
  return idx < 0 ? 0 : idx + 3;
}

export function bgpRouterId(dev: Device): string {
  const cfg = dev.config.bgp?.routerId;
  if (cfg && isIp(cfg)) return cfg;
  const los = dev.config.interfaces
    .filter((i) => i.name.startsWith('loopback'))
    .map((i) => primaryIp(i)?.ip)
    .filter((x): x is string => !!x)
    .sort(cmpIp);
  if (los.length) return los[los.length - 1];
  return '0.0.0.0';
}

export function ospfRouterId(dev: Device, tag: string): string {
  const proc = dev.config.ospf.find((p) => p.tag === tag);
  if (proc?.routerId && isIp(proc.routerId)) return proc.routerId;
  return bgpRouterId(dev);
}

/** Auto RT: 2-byte ASN:VNI, or 23456:VNI when the ASN is 4 bytes (RFC 6793 AS_TRANS). */
export function autoRt(asn: number, vni: number): string {
  const admin = asn > 65535 ? 23456 : asn;
  return `${admin}:${vni}`;
}

export function autoRdMac(routerId: string, vlanId: number): string {
  return `${routerId}:${vlanId + 32767}`;
}

export function autoRdIp(routerId: string, vrfId: number): string {
  return `${routerId}:${vrfId}`;
}

export function vlanById(dev: Device, id: number): VlanCfg | undefined {
  return dev.config.vlans.find((v) => v.id === id);
}

export function vlanForVni(dev: Device, vni: number): VlanCfg | undefined {
  return dev.config.vlans.find((v) => v.vnSegment === vni);
}

export function vrfForVni(dev: Device, vni: number): { name: string; vni: number } | undefined {
  const v = dev.config.vrfs.find((r) => r.vni === vni);
  return v?.vni ? { name: v.name, vni: v.vni } : undefined;
}

export function l2Rd(dev: Device, vni: number): string {
  const vlan = vlanForVni(dev, vni);
  const rid = bgpRouterId(dev);
  const explicit = dev.config.evpnVnis.find((e) => e.vni === vni);
  if (explicit?.rd && explicit.rd !== 'auto') return explicit.rd;
  return autoRdMac(rid, vlan?.id ?? 1);
}

export function l3Rd(dev: Device, vrfName: string): string {
  const vrf = dev.config.vrfs.find((v) => v.name === vrfName);
  const rid = bgpRouterId(dev);
  if (vrf?.rd && vrf.rd !== 'auto') return vrf.rd;
  return autoRdIp(rid, vrfIdOf(dev.config, vrfName));
}

function expandRt(asn: number, vni: number, value: 'auto' | string): string {
  return value === 'auto' ? autoRt(asn, vni) : value;
}

export function l2RouteTargets(dev: Device, vni: number, dir: 'import' | 'export'): string[] {
  const asn = dev.config.bgp?.asn ?? 0;
  const explicit = dev.config.evpnVnis.find((e) => e.vni === vni);
  const list = explicit ? (dir === 'import' ? explicit.importRt : explicit.exportRt) : ['auto' as const];
  const src = list.length ? list : (['auto'] as ('auto' | string)[]);
  return src.map((v) => expandRt(asn, vni, v));
}

export function l3RouteTargets(dev: Device, vrfName: string, dir: 'import' | 'export'): string[] {
  const vrf = dev.config.vrfs.find((v) => v.name === vrfName);
  const vni = vrf?.vni ?? 0;
  const asn = dev.config.bgp?.asn ?? 0;
  const rts = vrf?.afs.ipv4?.routeTargets ?? [];
  const out: string[] = [];
  let saw = false;
  for (const rt of rts) {
    if (!rt.evpn && rt.value !== 'auto') {
      /* non-evpn RT still imports into the VRF for type-5 when evpn flag is set;
         NX-OS `route-target both auto evpn` is the EVPN one. Non-evpn RTs are for VPNv4.
         Only EVPN-flagged (or auto, which we treat as EVPN when a VNI is set) apply here. */
    }
    if (rt.evpn || rt.value === 'auto') {
      if (rt.dir === 'both' || rt.dir === dir) {
        saw = true;
        out.push(expandRt(asn, vni, rt.value));
      }
    }
  }
  if (!saw && vni) out.push(autoRt(asn, vni));
  return out;
}

export function routeMap(dev: Device, name: string | undefined): RouteMapCfg | undefined {
  if (!name) return undefined;
  return dev.config.routeMaps.find((r) => r.name === name);
}

export interface RmResult {
  permit: boolean;
  nextHopUnchanged: boolean;
}

/** First matching entry wins. Missing route-map denies (implicit). */
export function evalRouteMap(
  dev: Device,
  name: string | undefined,
  subject: { intf?: string; tag?: number },
): RmResult {
  if (!name) return { permit: true, nextHopUnchanged: false };
  const rm = routeMap(dev, name);
  if (!rm) return { permit: false, nextHopUnchanged: false };
  const entries = [...rm.entries].sort((a, b) => a.seq - b.seq);
  for (const e of entries) {
    if (entryMatches(e, subject)) {
      return { permit: e.action === 'permit', nextHopUnchanged: !!e.setNextHopUnchanged };
    }
  }
  return { permit: false, nextHopUnchanged: false };
}

function entryMatches(e: RouteMapEntry, subject: { intf?: string; tag?: number }): boolean {
  if (e.matchInterface) {
    const want = canonicalIntf(e.matchInterface) ?? e.matchInterface;
    if ((canonicalIntf(subject.intf ?? '') ?? subject.intf) !== want) return false;
  }
  if (e.matchTag != null && subject.tag !== e.matchTag) return false;
  return true;
}

export function sendsExtended(af: { sendCommunity?: string } | undefined): boolean {
  return af?.sendCommunity === 'extended' || af?.sendCommunity === 'both';
}

export function ensureBgp(dev: Device, asn: number): BgpCfg {
  if (!dev.config.bgp || dev.config.bgp.asn !== asn) {
    dev.config.bgp = { asn, afs: {}, neighbors: [], vrfs: [] };
  }
  return dev.config.bgp;
}

export function ensureBgpAf(bgp: BgpCfg, af: 'ipv4' | 'l2vpn'): BgpAfCfg {
  if (af === 'ipv4') {
    bgp.afs.ipv4 ??= { networks: [] };
    return bgp.afs.ipv4;
  }
  bgp.afs.l2vpn ??= { networks: [] };
  return bgp.afs.l2vpn;
}

export function findNeighbor(bgp: BgpCfg, addr: string) {
  return bgp.neighbors.find((n) => n.address === addr);
}

export function areaDot(area: string): string {
  if (/^\d+$/.test(area)) {
    const n = Number(area);
    return `${(n >>> 24) & 255}.${(n >>> 16) & 255}.${(n >>> 8) & 255}.${n & 255}`;
  }
  return area;
}

export function ifaceAllowsVlan(intf: InterfaceCfg, vlan: number): boolean {
  if (!intf.switchport) return false;
  if (intf.mode === 'access') return intf.accessVlan === vlan;
  if (intf.trunkVlans === 'all') return true;
  return intf.trunkVlans.includes(vlan);
}

export function connectedPrefix(addr: Ipv4Addr): string {
  return networkOf(addr.ip, addr.prefix);
}

export function ipsShareSubnet(a: Ipv4Addr, b: Ipv4Addr): boolean {
  return sameSubnet(a.ip, a.prefix, b.ip, b.prefix) && a.ip !== b.ip;
}

export function ownsAddress(dev: Device, ip: string): boolean {
  if (!isIp(ip)) return false;
  for (const intf of dev.config.interfaces) {
    if (!dev.op.ifOper[intf.name]) continue;
    for (const a of intf.ips) if (a.ip === ip) return true;
  }
  return false;
}

export function nveSourceIps(dev: Device): { primary?: string; secondary?: string; intf?: InterfaceCfg } {
  const nve = dev.config.interfaces.find((i) => i.name === 'nve1');
  if (!nve?.nveSource) return {};
  const src = getIntf(dev, nve.nveSource);
  if (!src) return {};
  const primary = src.ips.find((a) => !a.secondary)?.ip;
  const secondary = src.ips.find((a) => a.secondary)?.ip;
  return { primary, secondary, intf: src };
}

export function vtepIpForHostPort(dev: Device, intf: InterfaceCfg): string | undefined {
  const { primary, secondary } = nveSourceIps(dev);
  if (intf.vpcId != null && secondary && hasFeature(dev, 'vpc') && dev.config.vpc) return secondary;
  return primary;
}

export function multisiteVip(dev: Device): string | undefined {
  const nve = dev.config.interfaces.find((i) => i.name === 'nve1');
  if (!nve?.nveMultisiteIf) return undefined;
  const intf = getIntf(dev, nve.nveMultisiteIf);
  return primaryIp(intf)?.ip;
}

export function macOfSystem(dev: Device): string {
  return normalizeMac(dev.systemMac) ?? dev.systemMac;
}

export function esiOf(intf: InterfaceCfg): string | undefined {
  return intf.esi ? normalizeEsi(intf.esi) ?? intf.esi : undefined;
}

export function featureList(): { id: string; cli: string[] }[] {
  return [
    { id: 'bgp', cli: ['bgp'] },
    { id: 'ospf', cli: ['ospf'] },
    { id: 'nv overlay', cli: ['nv', 'overlay'] },
    { id: 'vn-segment-vlan-based', cli: ['vn-segment-vlan-based'] },
    { id: 'interface-vlan', cli: ['interface-vlan'] },
    { id: 'fabric forwarding', cli: ['fabric', 'forwarding'] },
    { id: 'vpc', cli: ['vpc'] },
    { id: 'lacp', cli: ['lacp'] },
    { id: 'lldp', cli: ['lldp'] },
    { id: 'cdp', cli: ['cdp'] },
  ];
}

export function ipKey(ip: string): number {
  return ipToInt(ip);
}
