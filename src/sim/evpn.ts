import type { Lab } from './lab';
import { hostAttachments } from './graph';
import { cmpIp, ipToInt } from './ip';
import {
  hasFeature,
  l3RouteTargets,
  nveSourceIps,
  primaryIp,
  shortIntf,
  vlanForVni,
} from './model';
import { importable } from './bgp';
import { addPath, lookup, selectBest } from './rib';
import type { Device, EsiOp, EvpnRoute, InterfaceCfg, NvePeerOp, VpcOp } from './types';

export function importOverlay(lab: Lab): void {
  for (const dev of lab.devices) {
    if (dev.role === 'host') continue;
    dev.op.l2mac = [];
    dev.op.l2macip = [];
    dev.op.macTable = [];
    stripOverlay(dev);
    if (!hasFeature(dev, 'nv overlay') || !dev.config.nvOverlayEvpn) continue;

    for (const att of hostAttachments(lab, dev)) {
      const h = att.host.host!;
      dev.op.l2mac.push({ vlan: h.vlan, mac: h.mac, prod: 'Local', nextHop: ifindex(att.swIntf) });
      dev.op.l2macip.push({ vlan: h.vlan, mac: h.mac, ip: h.ip, prod: 'Local', nextHop: ifindex(att.swIntf) });
      dev.op.macTable.push({ vlan: h.vlan, mac: h.mac, type: 'dynamic', flag: '*', port: shortIntf(att.swIntf) });
    }

    if (dev.config.anycastGatewayMac && hasFeature(dev, 'fabric forwarding')) {
      for (const intf of dev.config.interfaces) {
        if (!intf.anycastGateway || !intf.name.startsWith('Vlan')) continue;
        const vlan = Number(intf.name.replace(/\D/g, ''));
        dev.op.macTable.push({
          vlan,
          mac: dev.config.anycastGatewayMac,
          type: 'static',
          flag: 'G',
          port: 'sup-eth1(R)',
        });
      }
    }

    const mine = new Set<string>();
    const src = nveSourceIps(dev);
    if (src.primary) mine.add(src.primary);
    if (src.secondary) mine.add(src.secondary);
    const ms = dev.config.interfaces.find((i) => i.name === 'nve1')?.nveMultisiteIf;
    if (ms) {
      const ip = primaryIp(dev.config.interfaces.find((i) => i.name === ms));
      if (ip) mine.add(ip.ip);
    }

    for (const r of dev.op.evpn) {
      if (!r.best || r.source === 'local') continue;
      if (!importable(dev, r)) continue;
      if (mine.has(r.nextHop)) continue;
      if (r.type === 2 && r.mac) {
        const vlan = vlanForVni(dev, r.vni)?.id;
        if (vlan == null) continue;
        if (!dev.op.l2mac.some((m) => m.vlan === vlan && m.mac === r.mac)) {
          dev.op.l2mac.push({ vlan, mac: r.mac, prod: 'BGP', nextHop: r.nextHop });
          dev.op.macTable.push({
            vlan,
            mac: r.mac,
            type: 'dynamic',
            flag: 'C',
            port: `nve1(${r.nextHop})`,
            peerIp: r.nextHop,
          });
        }
        if (r.macIp && !dev.op.l2macip.some((m) => m.vlan === vlan && m.ip === r.macIp)) {
          dev.op.l2macip.push({ vlan, mac: r.mac, ip: r.macIp, prod: 'BGP', nextHop: r.nextHop });
          const vrf = vrfForL2(dev, vlan);
          if (vrf && r.label2) {
            addOverlay(dev, vrf, `${r.macIp}/32`, r, 'hmm');
          }
        }
      } else if (r.type === 5 && r.prefix) {
        const vrf = vrfImporting(dev, r);
        if (!vrf) continue;
        const asn = dev.config.bgp?.asn ?? 0;
        addOverlay(dev, vrf, r.prefix, r, `bgp-${asn}`);
      }
    }
  }
}

function stripOverlay(dev: Device): void {
  for (const [vrf, list] of Object.entries(dev.op.vrfRib)) {
    for (const route of list) {
      route.paths = route.paths.filter((p) => p.protocol !== 'hmm' && !p.nhVrf);
      if (!route.paths.length) {
        /* keep empty and compact later */
      }
      selectBest(route);
    }
    dev.op.vrfRib[vrf] = list.filter((r) => r.paths.length);
  }
  dev.op.rib = dev.op.vrfRib['default'] ?? [];
}

function addOverlay(dev: Device, vrf: string, prefix: string, r: EvpnRoute, protocol: string): void {
  const resolved = lookup(dev, 'default', r.nextHop);
  if (!resolved?.paths.some((p) => p.best)) return;
  const outIntf = resolved.paths.find((p) => p.best)?.intf ?? 'nve1';
  addPath(dev.op.vrfRib, vrf, prefix, {
    nextHop: r.nextHop,
    intf: outIntf,
    pref: r.source === 'ebgp' ? 20 : 200,
    metric: 0,
    protocol,
    best: false,
    nhVrf: 'default',
    vni: r.label2 ?? r.label,
    routerMac: r.routerMac,
    internal: r.source !== 'ebgp',
  });
  const route = dev.op.vrfRib[vrf]?.find((x) => x.prefix === prefix);
  if (route) selectBest(route);
  if (vrf === 'default') dev.op.rib = dev.op.vrfRib['default'] ?? [];
}

function vrfForL2(dev: Device, vlan: number): string | undefined {
  const svi = dev.config.interfaces.find((i) => i.name === `Vlan${vlan}`);
  if (!svi) return undefined;
  return svi.vrf || 'default';
}

function vrfImporting(dev: Device, r: EvpnRoute): string | undefined {
  for (const v of dev.config.vrfs) {
    const rts = l3RouteTargets(dev, v.name, 'import');
    if (r.rts.some((rt) => rts.includes(rt))) return v.name;
  }
  return undefined;
}

function ifindex(name: string): string {
  const eth = /^Ethernet(\d+)\/(\d+)$/.exec(name);
  if (eth) return `Ifindex ${Number(eth[1]) * 4096 + Number(eth[2])}`;
  const po = /^port-channel(\d+)$/.exec(name);
  if (po) return `Ifindex ${200000 + Number(po[1])}`;
  return name;
}

export function stepNve(lab: Lab): void {
  for (const dev of lab.devices) {
    if (dev.role === 'host') continue;
    const nve = dev.config.interfaces.find((i) => i.name === 'nve1');
    dev.op.nveVnis = [];
    if (!nve || !hasFeature(dev, 'nv overlay')) {
      dev.op.nvePeers = [];
      continue;
    }
    const up = !!dev.op.ifOper['nve1'];
    for (const m of nve.nveMembers) {
      const l2 = !m.associateVrf;
      const vlan = l2 ? vlanForVni(dev, m.vni) : undefined;
      const vrf = !l2 ? dev.config.vrfs.find((v) => v.vni === m.vni) : undefined;
      let mcast = 'n/a';
      if (m.mcastGroup) mcast = m.mcastGroup;
      else if (m.ingressReplicationBgp || m.multisiteIngressReplication) mcast = 'UnicastBGP';
      const flags = m.multisiteIngressReplication ? 'MS-IR' : '';
      dev.op.nveVnis.push({
        vni: m.vni,
        mcast,
        up: up && (l2 ? !!vlan : !!vrf),
        kind: l2 ? 'L2' : 'L3',
        bd: l2 ? String(vlan?.id ?? '') : vrf?.name ?? '',
        flags,
      });
    }
    const peers = new Map<string, NvePeerOp>();
    const src = nveSourceIps(dev);
    for (const r of dev.op.evpn) {
      if (!r.best || r.source === 'local') continue;
      if (r.type !== 2 && r.type !== 3 && r.type !== 5) continue;
      const vni = r.vni || r.label;
      if (!nve.nveMembers.some((m) => m.vni === vni)) continue;
      if (!r.nextHop || r.nextHop === src.primary || r.nextHop === src.secondary) continue;
      if (!lookup(dev, 'default', r.nextHop)?.paths.some((p) => p.best)) continue;
      const cur = peers.get(r.nextHop) ?? {
        peerIp: r.nextHop,
        state: 'Up' as const,
        learn: 'CP' as const,
        routerMac: r.routerMac || '0000.0000.0000',
        since: dev.mem.nveSince[r.nextHop] ?? lab.tick,
        vnis: [],
      };
      if (r.routerMac) cur.routerMac = r.routerMac;
      if (!cur.vnis.includes(vni)) cur.vnis.push(vni);
      peers.set(r.nextHop, cur);
      dev.mem.nveSince[r.nextHop] = cur.since;
    }
    for (const ip of Object.keys(dev.mem.nveSince)) if (!peers.has(ip)) delete dev.mem.nveSince[ip];
    dev.op.nvePeers = [...peers.values()].sort((a, b) => cmpIp(a.peerIp, b.peerIp));
  }
}

export function stepVpc(lab: Lab): void {
  for (const dev of lab.devices) {
    if (dev.role === 'host') continue;
    if (!hasFeature(dev, 'vpc') || !dev.config.vpc) {
      dev.op.vpc = undefined;
      continue;
    }
    const vpc = dev.config.vpc;
    const peerLink = dev.config.interfaces.find((i) => i.vpcPeerLink);
    const peer = peerLink ? lab.peer(dev.id, peerLink.name) : null;
    const peerLinkUp = !!(peerLink && dev.op.ifOper[peerLink.name]);
    const peerDev = peer?.dev;
    const alive = vpc.keepaliveDest ? keepaliveUp(lab, dev, vpc.keepaliveDest) : false;
    let role: VpcOp['role'] = 'none established';
    if (peerLinkUp && peerDev?.config.vpc && peerDev.config.vpc.domain === vpc.domain) {
      const pr = vpc.rolePriority - peerDev.config.vpc.rolePriority;
      if (pr < 0) role = 'primary';
      else if (pr > 0) role = 'secondary';
      else role = dev.systemMac <= peerDev.systemMac ? 'primary' : 'secondary';
    }
    const members = dev.config.interfaces
      .filter((i) => i.vpcId != null)
      .map((i) => ({
        id: i.vpcId!,
        port: shortIntf(i.name),
        up: !!dev.op.ifOper[i.name],
        vlans: vlanList(dev, i),
      }));
    dev.op.vpc = {
      peerStatus: !peerLink
        ? 'peer link not configured'
        : peerLinkUp
          ? 'peer adjacency formed ok'
          : 'peer link is down',
      keepalive: alive ? 'peer is alive' : 'peer is not reachable',
      consistency: peerLinkUp && peerDev?.config.vpc?.domain === vpc.domain ? 'success' : 'failed',
      role,
      peerLinkIf: peerLink ? shortIntf(peerLink.name) : '',
      peerLinkUp,
      activeVlans: configuredVlans(dev),
      members,
    };
  }
}

function keepaliveUp(lab: Lab, dev: Device, dest: string): boolean {
  if (lookup(dev, 'default', dest)?.paths.some((p) => p.best)) return true;
  return lab.devices.some((d) => d.id !== dev.id && d.config.interfaces.some((i) => i.ips.some((a) => a.ip === dest)));
}

function configuredVlans(dev: Device): string {
  return dev.config.vlans.map((v) => v.id).join(',') || '-';
}

function vlanList(dev: Device, intf: InterfaceCfg): string {
  if (!intf.switchport) return '-';
  if (intf.mode === 'access') return String(intf.accessVlan);
  if (intf.trunkVlans === 'all') return configuredVlans(dev);
  return intf.trunkVlans.join(',') || '-';
}

export function stepEsi(lab: Lab): void {
  for (const dev of lab.devices) {
    dev.op.esi = [];
    if (dev.role === 'host' || !dev.config.nvOverlayEvpn) continue;
    const local = nveSourceIps(dev).primary;
    if (!local) continue;
    const groups = new Map<string, InterfaceCfg>();
    for (const intf of dev.config.interfaces) {
      if (intf.esi && dev.op.ifOper[intf.name]) groups.set(intf.esi, intf);
    }
    for (const [esi, intf] of groups) {
      const ips: Set<string> = new Set();
      ips.add(local);
      for (const r of dev.op.evpn) {
        if (r.type === 4 && r.best && r.esi === esi && r.nextHop) ips.add(r.nextHop);
      }
      const ordered: string[] = [...ips].sort((a, b) => ipToInt(a) - ipToInt(b));
      const vlans = vlansOf(dev, intf);
      const access = intf.mode === 'access' ? intf.accessVlan : vlans[0] ?? 1;
      const dfIp = ordered.length ? ordered[access % ordered.length] : local;
      const row: EsiOp = {
        esi,
        intf: intf.name,
        up: true,
        df: dfIp === local,
        dfIp,
        algo: 'Modulus',
        vteps: ordered.map((ip) => ({ ip, df: ip === dfIp })),
      };
      dev.op.esi.push(row);
    }
  }
}

function vlansOf(dev: Device, intf: InterfaceCfg): number[] {
  if (!intf.switchport) return [];
  if (intf.mode === 'access') return [intf.accessVlan];
  if (intf.trunkVlans === 'all') return dev.config.vlans.map((v) => v.id);
  return intf.trunkVlans;
}
