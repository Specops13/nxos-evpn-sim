import { inSubnet, isIp, networkOf } from './ip';
import type { Lab } from './lab';
import { canonicalIntf, getIntf, ifaceAllowsVlan, ownsAddress, primaryIp } from './model';
import type { Device } from './types';

export function findPeer(lab: Lab, devId: string, intf: string): { dev: Device; intf: string } | null {
  const name = canonicalIntf(intf) ?? intf;
  for (const l of lab.links) {
    if (l.a.device === devId && l.a.intf === name) {
      const dev = lab.device(l.b.device);
      return dev ? { dev, intf: l.b.intf } : null;
    }
    if (l.b.device === devId && l.b.intf === name) {
      const dev = lab.device(l.a.device);
      return dev ? { dev, intf: l.a.intf } : null;
    }
  }
  return null;
}

export function hostAttachments(lab: Lab, sw: Device): { host: Device; swIntf: string }[] {
  const out: { host: Device; swIntf: string }[] = [];
  for (const l of lab.links) {
    const ends = [l.a, l.b];
    for (let i = 0; i < 2; i++) {
      if (ends[i].device !== sw.id) continue;
      const host = lab.device(ends[1 - i].device);
      if (!host?.host) continue;
      const intf = getIntf(sw, ends[i].intf);
      if (!intf || !sw.op.ifOper[intf.name]) continue;
      if (!ifaceAllowsVlan(intf, host.host.vlan)) continue;
      out.push({ host, swIntf: intf.name });
    }
  }
  return out;
}

export function deviceOwningIp(lab: Lab, ip: string): Device | undefined {
  if (!isIp(ip)) return undefined;
  return lab.devices.find((d) => ownsAddress(d, ip));
}

export function connectedTo(dev: Device, ip: string): boolean {
  for (const intf of dev.config.interfaces) {
    if (!dev.op.ifOper[intf.name]) continue;
    for (const a of intf.ips) {
      if (a.ip !== ip && inSubnet(ip, networkOf(a.ip, a.prefix))) return true;
    }
  }
  return false;
}

export function intfToward(dev: Device, ip: string): string | undefined {
  for (const intf of dev.config.interfaces) {
    if (!dev.op.ifOper[intf.name]) continue;
    for (const a of intf.ips) {
      if (a.ip !== ip && inSubnet(ip, networkOf(a.ip, a.prefix))) return intf.name;
    }
  }
  return undefined;
}

export function primaryOf(dev: Device, intfName: string): string | undefined {
  return primaryIp(getIntf(dev, intfName))?.ip;
}
