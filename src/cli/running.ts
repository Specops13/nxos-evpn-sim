import { canonicalIntf, shortIntf } from '../sim/model';
import type { Device, InterfaceCfg } from '../sim/types';

function ind(n: number, s: string): string {
  return '  '.repeat(n) + s;
}

export function runningConfig(dev: Device): string {
  const c = dev.config;
  const lines: string[] = [];
  lines.push(`hostname ${c.hostname}`);
  const featureOrder = [
    'bgp',
    'ospf',
    'interface-vlan',
    'vn-segment-vlan-based',
    'fabric forwarding',
    'nv overlay',
    'vpc',
    'lacp',
    'lldp',
    'cdp',
  ];
  for (const f of featureOrder) if (c.features.includes(f)) lines.push(f.includes(' ') ? `feature ${f}` : `feature ${f}`);
  if (c.nvOverlayEvpn) lines.push('nv overlay evpn');
  if (c.anycastGatewayMac) lines.push(`fabric forwarding anycast-gateway-mac ${c.anycastGatewayMac}`);
  if (c.multisiteBgw != null) lines.push(`evpn multisite border-gateway ${c.multisiteBgw}`);
  lines.push('!');
  for (const v of c.vlans) {
    if (v.id === 1 && !v.vnSegment && !v.name) continue;
    lines.push(`vlan ${v.id}`);
    if (v.name && v.name !== 'default') lines.push(ind(1, `name ${v.name}`));
    if (v.vnSegment) lines.push(ind(1, `vn-segment ${v.vnSegment}`));
  }
  for (const v of c.vrfs) {
    lines.push(`vrf context ${v.name}`);
    if (v.vni) lines.push(ind(1, `vni ${v.vni}`));
    if (v.rd) lines.push(ind(1, `rd ${v.rd}`));
    if (v.afs.ipv4) {
      lines.push(ind(1, 'address-family ipv4 unicast'));
      for (const rt of v.afs.ipv4.routeTargets) {
        const ev = rt.evpn ? ' evpn' : '';
        lines.push(ind(2, `route-target ${rt.dir} ${rt.value}${ev}`));
      }
    }
  }
  for (const rm of c.routeMaps) {
    for (const e of [...rm.entries].sort((a, b) => a.seq - b.seq)) {
      lines.push(`route-map ${rm.name} ${e.action} ${e.seq}`);
      if (e.matchInterface) lines.push(ind(1, `match interface ${e.matchInterface}`));
      if (e.matchTag != null) lines.push(ind(1, `match tag ${e.matchTag}`));
      if (e.setNextHopUnchanged) lines.push(ind(1, 'set ip next-hop unchanged'));
    }
  }
  const ifaces = [...c.interfaces].sort(cmpIntf);
  for (const i of ifaces) lines.push(...renderIntf(i));
  for (const o of c.ospf) {
    lines.push(`router ospf ${o.tag}`);
    if (o.routerId) lines.push(ind(1, `router-id ${o.routerId}`));
  }
  if (c.bgp) {
    lines.push(`router bgp ${c.bgp.asn}`);
    if (c.bgp.routerId) lines.push(ind(1, `router-id ${c.bgp.routerId}`));
    lines.push(...renderAf(c.bgp.afs.ipv4, 'ipv4 unicast', 1));
    lines.push(...renderAf(c.bgp.afs.l2vpn, 'l2vpn evpn', 1));
    for (const n of c.bgp.neighbors) lines.push(...renderNeighbor(n, 1));
    for (const v of c.bgp.vrfs) {
      lines.push(ind(1, `vrf ${v.name}`));
      lines.push(...renderAf(v.afs.ipv4, 'ipv4 unicast', 2));
    }
  }
  if (c.evpnVnis.length) {
    lines.push('evpn');
    for (const e of c.evpnVnis) {
      lines.push(ind(1, `vni ${e.vni} l2`));
      if (e.rd) lines.push(ind(2, `rd ${e.rd}`));
      for (const rt of e.importRt) lines.push(ind(2, `route-target import ${rt}`));
      for (const rt of e.exportRt) lines.push(ind(2, `route-target export ${rt}`));
    }
  }
  if (c.vpc) {
    lines.push(`vpc domain ${c.vpc.domain}`);
    if (c.vpc.rolePriority !== 32667) lines.push(ind(1, `role priority ${c.vpc.rolePriority}`));
    if (c.vpc.peerGateway) lines.push(ind(1, 'peer-gateway'));
    if (c.vpc.keepaliveDest) {
      const src = c.vpc.keepaliveSrc ? ` source ${c.vpc.keepaliveSrc}` : '';
      lines.push(ind(1, `peer-keepalive destination ${c.vpc.keepaliveDest}${src}`));
    }
  }
  return lines.filter((l) => l !== '').join('\n') + '\n';
}

function renderAf(
  af: { retainRouteTargetAll?: boolean; maximumPaths?: number; maximumPathsIbgp?: number; networks: string[]; redistributeDirect?: { routeMap?: string }; nextHopRouteMap?: string } | undefined,
  name: string,
  level: number,
): string[] {
  if (!af) return [];
  const lines = [ind(level, `address-family ${name}`)];
  if (af.retainRouteTargetAll) lines.push(ind(level + 1, 'retain route-target all'));
  if (af.maximumPaths) lines.push(ind(level + 1, `maximum-paths ${af.maximumPaths}`));
  if (af.maximumPathsIbgp) lines.push(ind(level + 1, `maximum-paths ibgp ${af.maximumPathsIbgp}`));
  if (af.redistributeDirect) {
    const rm = af.redistributeDirect.routeMap ? ` route-map ${af.redistributeDirect.routeMap}` : '';
    lines.push(ind(level + 1, `redistribute direct${rm}`));
  }
  for (const n of af.networks) lines.push(ind(level + 1, `network ${n}`));
  if (af.nextHopRouteMap) lines.push(ind(level + 1, `nexthop route-map ${af.nextHopRouteMap}`));
  return lines;
}

function renderNeighbor(n: import('../sim/types').BgpNeighborCfg, level: number): string[] {
  const lines = [ind(level, `neighbor ${n.address}`)];
  if (n.remoteAs != null) lines.push(ind(level + 1, `remote-as ${n.remoteAs}`));
  if (n.updateSource) lines.push(ind(level + 1, `update-source ${n.updateSource}`));
  if (n.ebgpMultihop != null) lines.push(ind(level + 1, `ebgp-multihop ${n.ebgpMultihop}`));
  if (n.peerType === 'fabric-external') lines.push(ind(level + 1, 'peer-type fabric-external'));
  for (const [key, label] of [
    ['ipv4', 'ipv4 unicast'],
    ['l2vpn', 'l2vpn evpn'],
  ] as const) {
    const af = n.afs[key];
    if (!af) continue;
    lines.push(ind(level + 1, `address-family ${label}`));
    if (af.sendCommunity) lines.push(ind(level + 2, `send-community ${af.sendCommunity}`));
    if (af.routeReflectorClient) lines.push(ind(level + 2, 'route-reflector-client'));
    if (af.allowAsIn != null) lines.push(ind(level + 2, `allowas-in ${af.allowAsIn}`));
    if (af.disablePeerAsCheck) lines.push(ind(level + 2, 'disable-peer-as-check'));
    if (af.rewriteEvpnRtAsn) lines.push(ind(level + 2, 'rewrite-evpn-rt-asn'));
    if (af.routeMapIn) lines.push(ind(level + 2, `route-map ${af.routeMapIn} in`));
    if (af.routeMapOut) lines.push(ind(level + 2, `route-map ${af.routeMapOut} out`));
  }
  return lines;
}

function renderIntf(i: InterfaceCfg): string[] {
  const lines = [`interface ${i.name}`];
  if (i.description) lines.push(ind(1, `description ${i.description}`));
  if (!i.switchport && (i.name.startsWith('Ethernet') || i.name.startsWith('port-channel'))) lines.push(ind(1, 'no switchport'));
  if (i.switchport && i.mode === 'trunk') lines.push(ind(1, 'switchport mode trunk'));
  if (i.switchport && i.mode === 'access' && i.accessVlan !== 1) lines.push(ind(1, `switchport access vlan ${i.accessVlan}`));
  if (i.switchport && i.mode === 'trunk' && i.trunkVlans !== 'all') lines.push(ind(1, `switchport trunk allowed vlan ${i.trunkVlans.join(',')}`));
  if (i.vrf && i.vrf !== 'default') lines.push(ind(1, `vrf member ${i.vrf}`));
  for (const a of i.ips) {
    const sec = a.secondary ? ' secondary' : '';
    const tag = a.tag != null ? ` tag ${a.tag}` : '';
    lines.push(ind(1, `ip address ${a.ip}/${a.prefix}${sec}${tag}`));
  }
  if (i.ipForward) lines.push(ind(1, 'ip forward'));
  if (i.anycastGateway) lines.push(ind(1, 'fabric forwarding mode anycast-gateway'));
  if (i.ospf) {
    if (i.ospf.network === 'point-to-point') lines.push(ind(1, 'ip ospf network point-to-point'));
    lines.push(ind(1, `ip router ospf ${i.ospf.tag} area ${i.ospf.area}`));
  }
  if (i.vpcPeerLink) lines.push(ind(1, 'vpc peer-link'));
  if (i.vpcId != null) lines.push(ind(1, `vpc ${i.vpcId}`));
  if (i.evpnMultisite) lines.push(ind(1, `evpn multisite ${i.evpnMultisite}`));
  if (i.esi) {
    lines.push(ind(1, 'ethernet-segment'));
    lines.push(ind(2, `esi ${i.esi}`));
  }
  if (i.name.startsWith('nve')) {
    if (i.nveSource) lines.push(ind(1, `source-interface ${i.nveSource}`));
    if (i.nveHostReachBgp) lines.push(ind(1, 'host-reachability protocol bgp'));
    if (i.nveMultisiteIf) lines.push(ind(1, `multisite border-gateway interface ${i.nveMultisiteIf}`));
    for (const m of i.nveMembers) {
      if (m.associateVrf) lines.push(ind(1, `member vni ${m.vni} associate-vrf`));
      else {
        lines.push(ind(1, `member vni ${m.vni}`));
        if (m.ingressReplicationBgp) lines.push(ind(2, 'ingress-replication protocol bgp'));
        if (m.mcastGroup) lines.push(ind(2, `mcast-group ${m.mcastGroup}`));
        if (m.multisiteIngressReplication) lines.push(ind(2, 'multisite ingress-replication'));
      }
    }
  }
  const l2 = i.name.startsWith('Ethernet') || i.name.startsWith('port-channel');
  if (l2 || i.name.startsWith('Vlan') || i.name.startsWith('nve')) {
    if (!i.adminDown) lines.push(ind(1, 'no shutdown'));
  } else if (i.adminDown) lines.push(ind(1, 'shutdown'));
  return lines;
}

function cmpIntf(a: InterfaceCfg, b: InterfaceCfg): number {
  const rank = (n: string) => (n.startsWith('Ethernet') ? 0 : n.startsWith('port-channel') ? 1 : n.startsWith('loopback') ? 2 : n.startsWith('Vlan') ? 3 : 4);
  const d = rank(a.name) - rank(b.name);
  if (d) return d;
  return a.name.localeCompare(b.name, undefined, { numeric: true });
}

export function sectionFilter(config: string, text: string): string {
  const stanzas: string[] = [];
  let cur: string[] = [];
  for (const line of config.split('\n')) {
    if (line === '!' || (line.length && !line.startsWith(' ') && cur.length)) {
      if (cur.length) stanzas.push(cur.join('\n'));
      cur = line === '!' ? [] : [line];
    } else if (line.length) cur.push(line);
  }
  if (cur.length) stanzas.push(cur.join('\n'));
  return stanzas.filter((s) => s.includes(text)).join('\n\n');
}

void shortIntf;
void canonicalIntf;
