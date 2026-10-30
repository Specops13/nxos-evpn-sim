import {
  canonicalIntf,
  createDevice,
  emptyOp,
  ensureInterface,
  getIntf,
  hasFeature,
  intfKind,
  ifaceAllowsVlan,
  vlanById,
} from './model';
import { FutureSaveError, migrateDocument } from '../persist/migrate';
import { validateLabDocument } from '../persist/validate';
import type { Device, DeviceCfg, HostCfg, Link, Role } from './types';
import { stepOspf } from './ospf';
import { addBgpToRib, exchangeBgp, rebuildBgpTables, stepBgp } from './bgp';
import { importOverlay, stepEsi, stepNve, stepVpc } from './evpn';
import { rebuildConnected } from './rib';

let linkSeq = 1;

export class Lab {
  name: string;
  devices: Device[] = [];
  links: Link[] = [];
  tick = 0;

  constructor(name = 'lab') {
    this.name = name;
  }

  device(id: string): Device | undefined {
    return this.devices.find((d) => d.id === id || d.config.hostname === id);
  }

  addDevice(opts: { id: string; role: Role; hostname?: string; x?: number; y?: number; systemMac?: string }): Device {
    const d = createDevice(opts);
    this.devices.push(d);
    return d;
  }

  removeDevice(id: string): void {
    this.devices = this.devices.filter((d) => d.id !== id);
    this.links = this.links.filter((l) => l.a.device !== id && l.b.device !== id);
  }

  addLink(aDevice: string, aIntf: string, bDevice: string, bIntf: string): Link {
    const ai = canonicalIntf(aIntf) ?? aIntf;
    const bi = canonicalIntf(bIntf) ?? bIntf;
    const a = this.device(aDevice);
    const b = this.device(bDevice);
    if (a && a.role !== 'host') ensureInterface(a, ai);
    if (b && b.role !== 'host') ensureInterface(b, bi);
    const existing = this.links.find(
      (l) =>
        (l.a.device === aDevice && l.a.intf === ai) ||
        (l.b.device === aDevice && l.b.intf === ai) ||
        (l.a.device === bDevice && l.a.intf === bi) ||
        (l.b.device === bDevice && l.b.intf === bi),
    );
    if (existing) this.links = this.links.filter((l) => l !== existing);
    const link: Link = { id: `l${linkSeq++}`, a: { device: aDevice, intf: ai }, b: { device: bDevice, intf: bi } };
    this.links.push(link);
    return link;
  }

  removeLink(id: string): void {
    this.links = this.links.filter((l) => l.id !== id);
  }

  peer(devId: string, intf: string): { dev: Device; intf: string } | null {
    const name = canonicalIntf(intf) ?? intf;
    for (const l of this.links) {
      if (l.a.device === devId && l.a.intf === name) {
        const dev = this.device(l.b.device);
        return dev ? { dev, intf: l.b.intf } : null;
      }
      if (l.b.device === devId && l.b.intf === name) {
        const dev = this.device(l.a.device);
        return dev ? { dev, intf: l.a.intf } : null;
      }
    }
    return null;
  }

  step(): void {
    this.tick++;
    computeInterfaces(this);
    computeLldp(this);
    rebuildConnected(this);
    stepOspf(this);
    // Reinstall the previous tick's BGP routes so loopback sessions stay reachable
    // while this tick's FSM and exchange run.
    addBgpToRib(this);
    stepBgp(this);
    rebuildBgpTables(this);
    for (let pass = 0; pass < 5; pass++) {
      exchangeBgp(this);
      addBgpToRib(this);
      importOverlay(this);
    }
    stepNve(this);
    stepVpc(this);
    stepEsi(this);
  }

  converge(max = 48): number {
    let prev = '';
    for (let i = 0; i < max; i++) {
      this.step();
      const sig = this.signature();
      if (sig === prev) return i + 1;
      prev = sig;
    }
    return max;
  }

  signature(): string {
    const parts: string[] = [];
    for (const d of this.devices) {
      if (d.role === 'host') continue;
      const bgp = d.op.bgpPeers.map((p) => `${p.address}:${p.state}:${p.ipv4Pfx}:${p.evpnPfx}`).join(',');
      const ospf = d.op.ospfNbrs.map((n) => `${n.tag}:${n.routerId}:${n.state}:${n.role}`).join(',');
      const rib = (d.op.vrfRib['default'] ?? [])
        .map((r) => `${r.prefix}=${r.paths.filter((p) => p.best).map((p) => p.nextHop + '@' + p.intf).sort().join('|')}`)
        .sort()
        .join(',');
      const evpn = d.op.evpn
        .filter((e) => e.best)
        .map((e) => `${e.type}:${e.rd}:${e.mac ?? ''}:${e.macIp ?? ''}:${e.prefix ?? ''}:${e.esi}:${e.nextHop}:${e.rts.join('+')}`)
        .sort()
        .join(',');
      const nve = d.op.nvePeers.map((p) => `${p.peerIp}:${p.state}:${p.routerMac}`).sort().join(',');
      const mac = d.op.macTable.map((m) => `${m.vlan}:${m.mac}:${m.port}`).sort().join(',');
      const vpc = d.op.vpc ? `${d.op.vpc.role}:${d.op.vpc.peerStatus}:${d.op.vpc.peerLinkUp}` : '';
      const esi = d.op.esi.map((e) => `${e.esi}:${e.df}:${e.dfIp}`).join(',');
      parts.push([d.id, bgp, ospf, rib, evpn, nve, mac, vpc, esi].join('#'));
    }
    return parts.join('||');
  }

  toJSON(): Record<string, unknown> {
    return {
      schema: 2,
      name: this.name,
      devices: this.devices.map((d) => ({
        id: d.id,
        role: d.role,
        x: d.x,
        y: d.y,
        systemMac: d.systemMac,
        config: d.config,
        host: d.host,
      })),
      links: this.links.map((l) => ({
        aDevice: l.a.device,
        aIntf: l.a.intf,
        bDevice: l.b.device,
        bIntf: l.b.intf,
      })),
    };
  }

  static fromJSON(file: unknown, opts?: { allowFuture?: boolean }): Lab {
    const migrated = migrateDocument(file);
    if (migrated.future && !opts?.allowFuture) throw new FutureSaveError();
    const doc = migrated.document;
    if (!migrated.future) {
      const problem = validateLabDocument(doc);
      if (problem) throw new Error(problem);
    }
    const name = typeof doc.name === 'string' ? doc.name : 'lab';
    const devices = Array.isArray(doc.devices) ? doc.devices : [];
    const links = Array.isArray(doc.links) ? doc.links : [];
    const lab = new Lab(name);
    for (const item of devices) {
      const d = item as {
        id: string;
        role: Role;
        x: number;
        y: number;
        systemMac: string;
        config: DeviceCfg;
        host?: HostCfg;
      };
      const dev = lab.addDevice({
        id: d.id,
        role: d.role,
        hostname: d.config.hostname,
        x: d.x,
        y: d.y,
        systemMac: d.systemMac,
      });
      dev.config = d.config;
      dev.host = d.host;
    }
    for (const item of links) {
      const l = item as { aDevice: string; aIntf: string; bDevice: string; bIntf: string };
      lab.addLink(l.aDevice, l.aIntf, l.bDevice, l.bIntf);
    }
    return lab;
  }
}

function linkPeerAdminUp(lab: Lab, dev: Device, intfName: string): boolean {
  const peer = lab.peer(dev.id, intfName);
  if (!peer) return false;
  if (peer.dev.role === 'host') return true;
  const p = getIntf(peer.dev, peer.intf);
  return !!p && !p.adminDown;
}

function computeInterfaces(lab: Lab): void {
  const raw = new Map<string, boolean>();
  const key = (id: string, intf: string) => `${id}|${intf}`;
  for (const dev of lab.devices) {
    if (dev.role === 'host') continue;
    for (const intf of dev.config.interfaces) {
      raw.set(key(dev.id, intf.name), rawOper(lab, dev, intf));
    }
  }
  for (const dev of lab.devices) {
    if (dev.role === 'host') {
      dev.op.ifOper = {};
      continue;
    }
    const peerLink = dev.config.interfaces.find((i) => i.vpcPeerLink);
    const peerLinkUp = peerLink ? !!raw.get(key(dev.id, peerLink.name)) : false;
    const vpcOn = hasFeature(dev, 'vpc') && !!dev.config.vpc;
    const oper: Record<string, boolean> = {};
    for (const intf of dev.config.interfaces) {
      let up = !!raw.get(key(dev.id, intf.name));
      if (vpcOn && intf.vpcId != null && !peerLinkUp) up = false;
      oper[intf.name] = up;
    }
    dev.op.ifOper = oper;
  }
  for (const dev of lab.devices) {
    if (dev.role !== 'host') continue;
    const oper: Record<string, boolean> = {};
    for (const l of lab.links) {
      const ends = [l.a, l.b];
      for (let i = 0; i < 2; i++) {
        if (ends[i].device !== dev.id) continue;
        const sw = lab.device(ends[1 - i].device);
        if (!sw) continue;
        oper[ends[i].intf] = !!sw.op.ifOper[ends[1 - i].intf];
      }
    }
    dev.op.ifOper = oper;
  }
}

function rawOper(lab: Lab, dev: Device, intf: Device['config']['interfaces'][number]): boolean {
  if (intf.adminDown) return false;
  const kind = intfKind(intf.name);
  if (kind === 'lo') return true;
  if (kind === 'nve') {
    if (!hasFeature(dev, 'nv overlay')) return false;
    if (!intf.nveSource) return false;
    const src = getIntf(dev, intf.nveSource);
    return !!src && !src.adminDown;
  }
  if (kind === 'vlan') {
    if (!hasFeature(dev, 'interface-vlan')) return false;
    const id = Number(intf.name.replace(/\D/g, ''));
    if (!vlanById(dev, id)) return false;
    const l2 = dev.config.interfaces.some((i) => {
      const k = intfKind(i.name);
      if (k !== 'eth' && k !== 'po') return false;
      if (i.adminDown || !ifaceAllowsVlan(i, id)) return false;
      return linkPeerAdminUp(lab, dev, i.name);
    });
    const nve = dev.config.interfaces.find((i) => i.name === 'nve1');
    const nveUp =
      vlanById(dev, id)?.vnSegment != null &&
      hasFeature(dev, 'nv overlay') &&
      !!nve &&
      !nve.adminDown &&
      !!nve.nveSource;
    return l2 || !!nveUp;
  }
  return linkPeerAdminUp(lab, dev, intf.name);
}

function computeLldp(lab: Lab): void {
  for (const dev of lab.devices) {
    dev.op.lldp = [];
    dev.op.cdp = [];
    if (dev.role === 'host') continue;
    for (const intf of dev.config.interfaces) {
      if (!dev.op.ifOper[intf.name]) continue;
      if (intfKind(intf.name) !== 'eth' && intfKind(intf.name) !== 'po') continue;
      const peer = lab.peer(dev.id, intf.name);
      if (!peer) continue;
      const caps = peer.dev.role === 'host' ? 'S' : 'B R';
      const row = {
        deviceId: peer.dev.config.hostname,
        localIntf: intf.name,
        portId: peer.intf,
        hold: 120,
        capability: caps,
      };
      if (hasFeature(dev, 'lldp')) dev.op.lldp.push(row);
      if (hasFeature(dev, 'cdp')) dev.op.cdp.push(row);
    }
  }
}

export function freshOpKeep(dev: Device): void {
  const ifOper = dev.op.ifOper;
  const lldp = dev.op.lldp;
  const cdp = dev.op.cdp;
  const ospfNbrs = dev.op.ospfNbrs;
  dev.op = emptyOp();
  dev.op.ifOper = ifOper;
  dev.op.lldp = lldp;
  dev.op.cdp = cdp;
  dev.op.ospfNbrs = ospfNbrs;
}

export type { DeviceCfg, HostCfg };
