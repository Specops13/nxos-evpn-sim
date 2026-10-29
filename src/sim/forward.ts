import { inSubnet, networkOf } from './ip';
import type { Lab } from './lab';
import { connectedTo, deviceOwningIp, hostAttachments, intfToward } from './graph';
import { getIntf, nveSourceIps, ownsAddress, primaryIp } from './model';
import { lookup } from './rib';
import type { Device, RibPath } from './types';

/** Hop count through the default-VRF RIB. 0 if this device owns the address. */
export function pathHops(lab: Lab, start: Device, dest: string): number | null {
  let dev = start;
  const seen = new Set<string>();
  for (let hops = 0; hops < 16; hops++) {
    if (ownsAddress(dev, dest)) return hops;
    if (seen.has(dev.id)) return null;
    seen.add(dev.id);
    if (connectedTo(dev, dest)) {
      const peer = peerOnSubnet(lab, dev, dest);
      if (!peer) return null;
      dev = peer;
      continue;
    }
    const route = lookup(dev, 'default', dest);
    const path = route?.paths.find((p) => p.best);
    if (!path) return null;
    const next = forwardDevice(lab, dev, path);
    if (!next || next.id === dev.id) return null;
    dev = next;
  }
  return null;
}

function peerOnSubnet(lab: Lab, dev: Device, ip: string): Device | null {
  const intf = intfToward(dev, ip);
  if (!intf) return null;
  const peer = lab.peer(dev.id, intf);
  return peer && peer.dev.role !== 'host' ? peer.dev : null;
}

function forwardDevice(lab: Lab, dev: Device, path: RibPath): Device | null {
  if (path.intf && path.intf !== 'nve1' && path.intf !== 'local') {
    const peer = lab.peer(dev.id, path.intf);
    if (peer && peer.dev.role !== 'host') return peer.dev;
  }
  return deviceOwningIp(lab, path.nextHop) ?? null;
}

export function pingSwitch(lab: Lab, dev: Device, dst: string, vrf = 'default', count = 5): string {
  const ok = vrf === 'default' ? pathHops(lab, dev, dst) != null : routeVrf(lab, dev, vrf, dst, new Set());
  return pingText(dst, ok, count);
}

export function pingHost(lab: Lab, host: Device, dst: string, count = 5): string {
  const ok = hostReach(lab, host, dst, new Set()) && reverseOk(lab, host, dst);
  return pingText(dst, ok, count);
}

function reverseOk(lab: Lab, src: Device, dst: string): boolean {
  const other = lab.devices.find((d) => d.host?.ip === dst);
  if (!other?.host) return true;
  return hostReach(lab, other, src.host!.ip, new Set());
}

function hostReach(lab: Lab, host: Device, dst: string, seen: Set<string>): boolean {
  if (!host.host) return false;
  if (seen.has(host.id + '>' + dst)) return false;
  seen.add(host.id + '>' + dst);
  const att = hostAttachmentsOfHost(lab, host).find((a) => a.sw.op.ifOper[a.swIntf]);
  if (!att) return false;
  const { sw } = att;
  const subnet = networkOf(host.host.ip, host.host.prefix);
  if (inSubnet(dst, subnet)) {
    if (gatewayIp(sw, host.host.vlan) === dst) return !!sw.op.ifOper[`Vlan${host.host.vlan}`];
    const mac = resolveMac(lab, sw, host.host.vlan, dst);
    if (!mac) return false;
    return bridge(lab, sw, host.host.vlan, dst, mac, new Set());
  }
  const svi = getIntf(sw, `Vlan${host.host.vlan}`);
  if (!svi || !sw.op.ifOper[svi.name]) return false;
  if (!svi.ips.some((a) => a.ip === host.host!.gateway)) return false;
  return routeVrf(lab, sw, svi.vrf || 'default', dst, new Set());
}

function hostAttachmentsOfHost(lab: Lab, host: Device): { sw: Device; swIntf: string }[] {
  const out: { sw: Device; swIntf: string }[] = [];
  for (const l of lab.links) {
    const ends = [l.a, l.b];
    for (let i = 0; i < 2; i++) {
      if (ends[i].device !== host.id) continue;
      const sw = lab.device(ends[1 - i].device);
      if (!sw || sw.role === 'host') continue;
      out.push({ sw, swIntf: ends[1 - i].intf });
    }
  }
  return out;
}

function gatewayIp(sw: Device, vlan: number): string | undefined {
  return primaryIp(getIntf(sw, `Vlan${vlan}`))?.ip;
}

export function resolveMac(lab: Lab, sw: Device, vlan: number, ip: string): string | null {
  for (const att of hostAttachments(lab, sw)) {
    if (att.host.host?.vlan === vlan && att.host.host.ip === ip) return att.host.host.mac;
  }
  const mip = sw.op.l2macip.find((e) => e.vlan === vlan && e.ip === ip);
  if (mip) return mip.mac;
  const svi = getIntf(sw, `Vlan${vlan}`);
  if (svi?.ips.some((a) => a.ip === ip)) return sw.config.anycastGatewayMac || sw.systemMac;
  const vni = sw.config.vlans.find((v) => v.id === vlan)?.vnSegment;
  if (vni && sw.op.nvePeers.some((p) => p.state === 'Up' && p.vnis.includes(vni))) {
    for (const d of lab.devices) {
      if (!d.host || d.host.vlan !== vlan || d.host.ip !== ip) continue;
      return d.host.mac;
    }
  }
  return null;
}

function bridge(lab: Lab, dev: Device, vlan: number, dstIp: string, mac: string, seen: Set<string>): boolean {
  if (seen.has(dev.id + ':l2:' + vlan + ':' + dstIp)) return false;
  seen.add(dev.id + ':l2:' + vlan + ':' + dstIp);
  for (const att of hostAttachments(lab, dev)) {
    if (att.host.host?.vlan === vlan && att.host.host.ip === dstIp) return true;
  }
  const row = dev.op.macTable.find((m) => m.vlan === vlan && m.mac === mac);
  if (!row) return false;
  if (row.peerIp) {
    const owners = vtepOwners(lab, row.peerIp);
    return owners.some((o) => o.id !== dev.id && bridge(lab, o, vlan, dstIp, mac, seen));
  }
  return true;
}

function routeVrf(lab: Lab, dev: Device, vrf: string, dst: string, seen: Set<string>): boolean {
  const mark = `${dev.id}:l3:${vrf}:${dst}`;
  if (seen.has(mark)) return false;
  seen.add(mark);
  if (dev.config.interfaces.some((i) => (i.vrf || 'default') === vrf && i.ips.some((a) => a.ip === dst) && dev.op.ifOper[i.name])) {
    return true;
  }
  for (const att of hostAttachments(lab, dev)) {
    const svi = getIntf(dev, `Vlan${att.host.host!.vlan}`);
    if ((svi?.vrf || 'default') === vrf && att.host.host!.ip === dst) return true;
  }
  const route = lookup(dev, vrf, dst);
  if (!route) return false;
  for (const path of route.paths.filter((p) => p.best)) {
    if (path.protocol === 'direct' || path.protocol === 'local' || path.attached) {
      for (const att of hostAttachments(lab, dev)) {
        if (att.host.host && inSubnet(att.host.host.ip, path.nextHop.includes('/') ? path.nextHop : route.prefix) && att.host.host.ip === dst) {
          return true;
        }
      }
      // Connected subnet with no local host: not delivered here.
      continue;
    }
    if (path.nhVrf || path.protocol === 'hmm' || path.intf === 'nve1') {
      const owners = vtepOwners(lab, path.nextHop);
      if (owners.some((o) => routeVrf(lab, o, vrf, dst, seen))) return true;
    }
  }
  return false;
}

export function vtepOwners(lab: Lab, ip: string): Device[] {
  const owners: Device[] = [];
  for (const d of lab.devices) {
    if (d.role === 'host') continue;
    const src = nveSourceIps(d);
    const vip = d.config.interfaces.find((i) => i.name === 'nve1')?.nveMultisiteIf;
    const vipIp = vip ? primaryIp(getIntf(d, vip))?.ip : undefined;
    if (src.primary === ip || src.secondary === ip || vipIp === ip) owners.push(d);
  }
  return owners;
}

function pingText(target: string, ok: boolean, count: number): string {
  const lines = [`PING ${target} (${target}): 56 data bytes`];
  if (!ok) {
    for (let i = 0; i < count; i++) lines.push(`Request ${i} timed out`);
    lines.push('', `--- ${target} ping statistics ---`);
    lines.push(`${count} packets transmitted, 0 packets received, 100.00% packet loss`);
    return lines.join('\n');
  }
  for (let i = 0; i < count; i++) {
    lines.push(`64 bytes from ${target}: icmp_seq=${i} ttl=254 time=1.${i} ms`);
  }
  lines.push('', `--- ${target} ping statistics ---`);
  lines.push(`${count} packets transmitted, ${count} packets received, 0.00% packet loss`);
  lines.push('round-trip min/avg/max = 1.0/1.2/1.4 ms');
  return lines.join('\n');
}
