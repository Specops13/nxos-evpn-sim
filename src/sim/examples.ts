import { areaDot } from './model';
import { Lab } from './lab';
import type { BgpNeighborCfg, Device, InterfaceCfg } from './types';

/**
 * Ready-made fabrics. Addresses and command structure follow the Nexus 9000
 * VXLAN BGP EVPN configuration guide (iBGP route-reflector spines, eBGP
 * underlay + overlay with retain route-target all / next-hop unchanged, and
 * Multi-Site border gateways).
 */

function feat(dev: Device, ...names: string[]): void {
  for (const n of names) if (!dev.config.features.includes(n)) dev.config.features.push(n);
}

function intf(dev: Device, name: string): InterfaceCfg {
  const canon =
    name.startsWith('Ethernet') ||
    name.startsWith('loopback') ||
    name.startsWith('Vlan') ||
    name.startsWith('port-channel') ||
    name.startsWith('nve')
      ? name
      : name;
  let i = dev.config.interfaces.find((x) => x.name === canon);
  if (!i) {
    const l2 = canon.startsWith('Ethernet') || canon.startsWith('port-channel');
    i = {
      name: canon,
      adminDown: l2,
      switchport: l2,
      mode: 'access',
      accessVlan: 1,
      trunkVlans: 'all',
      vrf: 'default',
      ips: [],
      nveMembers: [],
    };
    dev.config.interfaces.push(i);
  }
  return i;
}

function loopback(dev: Device, id: number, ip: string, secondary = false): void {
  const i = intf(dev, `loopback${id}`);
  i.adminDown = false;
  i.switchport = false;
  i.ips.push({ ip, prefix: 32, secondary });
}

function routed(dev: Device, name: string, cidr: string): void {
  const [ip, len] = cidr.split('/');
  const i = intf(dev, name);
  i.switchport = false;
  i.adminDown = false;
  i.ips.push({ ip, prefix: Number(len) });
}

function access(dev: Device, name: string, vlan: number, vpc?: number): void {
  const i = intf(dev, name);
  i.switchport = true;
  i.adminDown = false;
  i.mode = 'access';
  i.accessVlan = vlan;
  if (vpc != null) i.vpcId = vpc;
}

function ospfIf(dev: Device, name: string): void {
  const i = intf(dev, name);
  i.ospf = { tag: 'UNDERLAY', area: areaDot('0'), network: 'point-to-point' };
}

function ospfProc(dev: Device, rid: string): void {
  feat(dev, 'ospf');
  dev.config.ospf.push({ tag: 'UNDERLAY', routerId: rid });
}

function vlan(dev: Device, id: number, vni?: number, name?: string): void {
  const existing = dev.config.vlans.find((v) => v.id === id);
  if (existing) {
    if (vni) existing.vnSegment = vni;
    if (name) existing.name = name;
    return;
  }
  dev.config.vlans.push({ id, vnSegment: vni, name });
}

function vrfTenant(dev: Device): void {
  dev.config.vrfs.push({
    name: 'TENANT',
    vni: 50001,
    rd: 'auto',
    afs: {
      ipv4: {
        routeTargets: [
          { dir: 'both', value: 'auto', evpn: true },
          { dir: 'both', value: 'auto', evpn: false },
        ],
      },
    },
  });
}

function svi(dev: Device, vlanId: number, ip: string | undefined, opts: { anycast?: boolean; forward?: boolean; tag?: number } = {}): void {
  const i = intf(dev, `Vlan${vlanId}`);
  i.adminDown = false;
  i.switchport = false;
  i.vrf = 'TENANT';
  if (ip) i.ips.push({ ip, prefix: 24, tag: opts.tag });
  if (opts.anycast) i.anycastGateway = true;
  if (opts.forward) i.ipForward = true;
}

function nve(dev: Device, source: string, vnis: { vni: number; l3?: boolean }[], multisite?: string): void {
  const i = intf(dev, 'nve1');
  i.adminDown = false;
  i.switchport = false;
  i.nveSource = source;
  i.nveHostReachBgp = true;
  if (multisite) i.nveMultisiteIf = multisite;
  i.nveMembers = vnis.map((v) =>
    v.l3
      ? { vni: v.vni, associateVrf: true }
      : { vni: v.vni, ingressReplicationBgp: true },
  );
}

function leafOverlay(dev: Device): void {
  feat(dev, 'bgp', 'ospf', 'nv overlay', 'vn-segment-vlan-based', 'interface-vlan', 'fabric forwarding', 'lldp');
  dev.config.nvOverlayEvpn = true;
  dev.config.anycastGatewayMac = '0000.2222.3333';
  vlan(dev, 10, 10010, 'WEB');
  vlan(dev, 20, 10020, 'APP');
  vlan(dev, 100, 50001, 'L3VNI');
  vrfTenant(dev);
  svi(dev, 10, '10.10.10.1', { anycast: true, tag: 12345 });
  svi(dev, 20, '10.10.20.1', { anycast: true, tag: 12345 });
  svi(dev, 100, undefined, { forward: true });
  dev.config.routeMaps.push({ name: 'FABRIC', entries: [{ seq: 10, action: 'permit', matchTag: 12345 }] });
  dev.config.evpnVnis.push(
    { vni: 10010, rd: 'auto', importRt: ['auto'], exportRt: ['auto'] },
    { vni: 10020, rd: 'auto', importRt: ['auto'], exportRt: ['auto'] },
  );
}

function bgpBase(dev: Device, asn: number, rid: string): void {
  feat(dev, 'bgp');
  dev.config.bgp = { asn, routerId: rid, afs: { l2vpn: { networks: [] }, ipv4: { networks: [] } }, neighbors: [], vrfs: [] };
}

function nbr(partial: BgpNeighborCfg): BgpNeighborCfg {
  return partial;
}

function evpnAf(extra: Partial<NonNullable<BgpNeighborCfg['afs']['l2vpn']>> = {}): NonNullable<BgpNeighborCfg['afs']['l2vpn']> {
  return { sendCommunity: 'extended', ...extra };
}

function host(lab: Lab, id: string, sw: Device, swIf: string, ip: string, mac: string, vlanId: number, gw: string, x: number, y: number, hostIf = 'eth0'): void {
  const h = lab.addDevice({ id, role: 'host', x, y, systemMac: mac });
  h.host = { mac, ip, prefix: 24, vlan: vlanId, gateway: gw };
  access(sw, swIf, vlanId);
  lab.addLink(sw.id, swIf, h.id, hostIf);
}

/** (a) 2 spines + 4 leaves, OSPF underlay, iBGP EVPN with spines as route reflectors. */
export function exampleClosIbgp(): Lab {
  const lab = new Lab('2-spine 4-leaf OSPF + iBGP EVPN');
  const s1 = lab.addDevice({ id: 'spine1', role: 'spine', x: 280, y: 70, systemMac: '5000.0000.0011' });
  const s2 = lab.addDevice({ id: 'spine2', role: 'spine', x: 560, y: 70, systemMac: '5000.0000.0012' });
  const leaves = [1, 2, 3, 4].map((n, idx) =>
    lab.addDevice({
      id: `leaf${n}`,
      role: 'leaf',
      x: 80 + idx * 200,
      y: 280,
      systemMac: `5000.0000.000${n}`,
    }),
  );
  const spines = [s1, s2];
  spines.forEach((s, si) => {
    const rid = `10.0.0.1${si + 1}`;
    loopback(s, 0, rid);
    ospfProc(s, rid);
    ospfIf(s, 'loopback0');
    feat(s, 'lldp', 'nv overlay');
    bgpBase(s, 65001, rid);
    s.config.bgp!.afs.l2vpn!.retainRouteTargetAll = true;
  });
  leaves.forEach((leaf, li) => {
    const n = li + 1;
    const rid = `10.0.0.${n}`;
    const vtep = `10.1.1.${n}`;
    loopback(leaf, 0, rid);
    loopback(leaf, 1, vtep);
    ospfProc(leaf, rid);
    ospfIf(leaf, 'loopback0');
    ospfIf(leaf, 'loopback1');
    leafOverlay(leaf);
    nve(leaf, 'loopback1', [
      { vni: 10010 },
      { vni: 10020 },
      { vni: 50001, l3: true },
    ]);
    bgpBase(leaf, 65001, rid);
    leaf.config.bgp!.vrfs.push({
      name: 'TENANT',
      afs: { ipv4: { networks: [], redistributeDirect: { routeMap: 'FABRIC' } } },
    });
    spines.forEach((s, si) => {
      const idx = li * 2 + si;
      const leafIp = `10.1.0.${idx * 2}`;
      const spineIp = `10.1.0.${idx * 2 + 1}`;
      const leafIf = `Ethernet1/${si + 1}`;
      const spineIf = `Ethernet1/${n}`;
      routed(leaf, leafIf, `${leafIp}/31`);
      routed(s, spineIf, `${spineIp}/31`);
      ospfIf(leaf, leafIf);
      ospfIf(s, spineIf);
      lab.addLink(leaf.id, leafIf, s.id, spineIf);
      leaf.config.bgp!.neighbors.push(
        nbr({
          address: `10.0.0.1${si + 1}`,
          remoteAs: 65001,
          updateSource: 'loopback0',
          afs: { l2vpn: evpnAf() },
        }),
      );
      s.config.bgp!.neighbors.push(
        nbr({
          address: rid,
          remoteAs: 65001,
          updateSource: 'loopback0',
          afs: { l2vpn: evpnAf({ routeReflectorClient: true }) },
        }),
      );
    });
  });
  host(lab, 'host1', leaves[0], 'Ethernet1/10', '10.10.10.11', '0050.0001.0001', 10, '10.10.10.1', 80, 460);
  host(lab, 'host2', leaves[1], 'Ethernet1/10', '10.10.10.12', '0050.0001.0002', 10, '10.10.10.1', 280, 460);
  host(lab, 'host3', leaves[2], 'Ethernet1/10', '10.10.20.13', '0050.0002.0003', 20, '10.10.20.1', 480, 460);
  return lab;
}

/** (b) 5-stage Clos: 2 super-spines, 2 spines, 4 leaves. eBGP underlay and EVPN overlay. */
export function exampleFiveStageEbgp(): Lab {
  const lab = new Lab('5-stage eBGP underlay + EVPN');
  const supers = [0, 1].map((i) =>
    lab.addDevice({
      id: `ss${i + 1}`,
      role: 'super-spine',
      x: 260 + i * 280,
      y: 40,
      systemMac: `5000.0000.010${i + 1}`,
    }),
  );
  const spines = [0, 1].map((i) =>
    lab.addDevice({
      id: `spine${i + 1}`,
      role: 'spine',
      x: 260 + i * 280,
      y: 180,
      systemMac: `5000.0000.011${i + 1}`,
    }),
  );
  const leaves = [0, 1, 2, 3].map((i) =>
    lab.addDevice({
      id: `leaf${i + 1}`,
      role: 'leaf',
      x: 60 + i * 200,
      y: 360,
      systemMac: `5000.0000.020${i + 1}`,
    }),
  );
  const nhu = { name: 'NH-UNCHANGED', entries: [{ seq: 10, action: 'permit' as const, setNextHopUnchanged: true }] };
  const loMap = { name: 'LOOPBACKS', entries: [{ seq: 10, action: 'permit' as const, matchInterface: 'loopback0' }] };

  supers.forEach((s, i) => {
    const rid = `10.2.2.${i + 1}`;
    loopback(s, 0, rid);
    feat(s, 'bgp', 'lldp');
    bgpBase(s, 65000, rid);
    s.config.bgp!.afs.ipv4!.redistributeDirect = { routeMap: 'LOOPBACKS' };
    s.config.bgp!.afs.ipv4!.maximumPaths = 4;
    s.config.bgp!.afs.l2vpn!.retainRouteTargetAll = true;
    s.config.bgp!.afs.l2vpn!.nextHopRouteMap = 'NH-UNCHANGED';
    s.config.routeMaps.push(structuredClone(nhu), structuredClone(loMap));
  });
  spines.forEach((s, i) => {
    const rid = `10.2.1.${i + 1}`;
    loopback(s, 0, rid);
    feat(s, 'bgp', 'lldp');
    bgpBase(s, 65101 + i, rid);
    s.config.bgp!.afs.ipv4!.redistributeDirect = { routeMap: 'LOOPBACKS' };
    s.config.bgp!.afs.ipv4!.maximumPaths = 4;
    s.config.bgp!.afs.l2vpn!.retainRouteTargetAll = true;
    s.config.bgp!.afs.l2vpn!.nextHopRouteMap = 'NH-UNCHANGED';
    s.config.routeMaps.push(structuredClone(nhu), structuredClone(loMap));
  });
  leaves.forEach((leaf, i) => {
    const vtep = `10.3.0.${i + 1}`;
    loopback(leaf, 0, vtep);
    feat(leaf, 'bgp', 'lldp');
    leafOverlay(leaf);
    nve(leaf, 'loopback0', [
      { vni: 10010 },
      { vni: 10020 },
      { vni: 50001, l3: true },
    ]);
    // Leaves share an ASN so route-target auto (ASN:VNI) matches across the
    // fabric. allowas-in is required because the AS path returns with 65201.
    bgpBase(leaf, 65201, vtep);
    leaf.config.bgp!.afs.ipv4!.redistributeDirect = { routeMap: 'LOOPBACKS' };
    leaf.config.bgp!.afs.ipv4!.maximumPaths = 4;
    leaf.config.routeMaps.push(structuredClone(loMap));
    leaf.config.bgp!.vrfs.push({
      name: 'TENANT',
      afs: { ipv4: { networks: [], redistributeDirect: { routeMap: 'FABRIC' } } },
    });
  });

  const v4 = (allow = false): NonNullable<BgpNeighborCfg['afs']['ipv4']> => ({
    sendCommunity: 'extended',
    ...(allow ? { allowAsIn: 3 } : {}),
  });

  leaves.forEach((leaf, li) => {
    spines.forEach((sp, si) => {
      const n = li * 2 + si;
      const leafIf = `Ethernet1/${si + 1}`;
      const spineIf = `Ethernet1/${li + 1}`;
      routed(leaf, leafIf, `10.20.${n}.0/31`);
      routed(sp, spineIf, `10.20.${n}.1/31`);
      lab.addLink(leaf.id, leafIf, sp.id, spineIf);
      leaf.config.bgp!.neighbors.push(
        nbr({ address: `10.20.${n}.1`, remoteAs: 65101 + si, afs: { ipv4: v4(true) } }),
        nbr({
          address: `10.2.1.${si + 1}`,
          remoteAs: 65101 + si,
          updateSource: 'loopback0',
          ebgpMultihop: 10,
          afs: { l2vpn: evpnAf({ allowAsIn: 3 }) },
        }),
      );
      sp.config.bgp!.neighbors.push(
        nbr({
          address: `10.20.${n}.0`,
          remoteAs: 65201,
          afs: { ipv4: { sendCommunity: 'extended', disablePeerAsCheck: true } },
        }),
        nbr({
          address: `10.3.0.${li + 1}`,
          remoteAs: 65201,
          updateSource: 'loopback0',
          ebgpMultihop: 10,
          afs: { l2vpn: evpnAf({ disablePeerAsCheck: true, routeMapOut: 'NH-UNCHANGED' }) },
        }),
      );
    });
  });

  spines.forEach((sp, si) => {
    supers.forEach((ss, ui) => {
      const n = si * 2 + ui;
      const spineIf = `Ethernet1/${5 + ui}`;
      const ssIf = `Ethernet1/${si + 1}`;
      routed(sp, spineIf, `10.30.${n}.0/31`);
      routed(ss, ssIf, `10.30.${n}.1/31`);
      lab.addLink(sp.id, spineIf, ss.id, ssIf);
      sp.config.bgp!.neighbors.push(
        nbr({ address: `10.30.${n}.1`, remoteAs: 65000, afs: { ipv4: v4() } }),
        nbr({
          address: `10.2.2.${ui + 1}`,
          remoteAs: 65000,
          updateSource: 'loopback0',
          ebgpMultihop: 10,
          afs: { l2vpn: evpnAf({ disablePeerAsCheck: true, routeMapOut: 'NH-UNCHANGED' }) },
        }),
      );
      ss.config.bgp!.neighbors.push(
        nbr({ address: `10.30.${n}.0`, remoteAs: 65101 + si, afs: { ipv4: v4() } }),
        nbr({
          address: `10.2.1.${si + 1}`,
          remoteAs: 65101 + si,
          updateSource: 'loopback0',
          ebgpMultihop: 10,
          afs: { l2vpn: evpnAf({ disablePeerAsCheck: true, routeMapOut: 'NH-UNCHANGED' }) },
        }),
      );
    });
  });

  host(lab, 'host1', leaves[0], 'Ethernet1/10', '10.10.10.11', '0050.0001.0001', 10, '10.10.10.1', 60, 520);
  host(lab, 'host2', leaves[1], 'Ethernet1/10', '10.10.10.12', '0050.0001.0002', 10, '10.10.10.1', 260, 520);
  host(lab, 'host3', leaves[2], 'Ethernet1/10', '10.10.20.13', '0050.0002.0003', 20, '10.10.20.1', 460, 520);
  return lab;
}

function siteUnderlay(
  lab: Lab,
  prefix: string,
  asn: number,
  siteId: number,
  x0: number,
): { spine: Device; leaves: Device[]; bgw: Device } {
  const spine = lab.addDevice({
    id: `${prefix}-spine`,
    role: 'spine',
    x: x0 + 160,
    y: 60,
    systemMac: `5100.0000.00${siteId}1`,
  });
  const leafA = lab.addDevice({
    id: `${prefix}-leaf1`,
    role: 'leaf',
    x: x0,
    y: 240,
    systemMac: `5100.0000.00${siteId}2`,
  });
  const leafB = lab.addDevice({
    id: `${prefix}-leaf2`,
    role: 'leaf',
    x: x0 + 180,
    y: 240,
    systemMac: `5100.0000.00${siteId}3`,
  });
  const bgw = lab.addDevice({
    id: `${prefix}-bgw`,
    role: 'border-gateway',
    x: x0 + 340,
    y: 240,
    systemMac: `5100.0000.00${siteId}4`,
  });
  const nodes = [
    { dev: spine, lo0: `10.${siteId}.0.11`, lo1: undefined as string | undefined },
    { dev: leafA, lo0: `10.${siteId}.0.1`, lo1: `10.${siteId}.1.1` },
    { dev: leafB, lo0: `10.${siteId}.0.2`, lo1: `10.${siteId}.1.2` },
    { dev: bgw, lo0: `10.${siteId}.0.21`, lo1: `10.${siteId}.1.21` },
  ];
  for (const n of nodes) {
    loopback(n.dev, 0, n.lo0);
    ospfProc(n.dev, n.lo0);
    ospfIf(n.dev, 'loopback0');
    if (n.lo1) {
      loopback(n.dev, 1, n.lo1);
      ospfIf(n.dev, 'loopback1');
    }
    feat(n.dev, 'lldp');
    bgpBase(n.dev, asn, n.lo0);
    n.dev.config.bgp!.afs.l2vpn!.retainRouteTargetAll = n.dev === spine;
  }
  const edge = [leafA, leafB, bgw];
  edge.forEach((dev, i) => {
    const leafIf = 'Ethernet1/1';
    const spineIf = `Ethernet1/${i + 1}`;
    const base = i * 2;
    routed(dev, leafIf, `10.${siteId}.10.${base}/31`);
    routed(spine, spineIf, `10.${siteId}.10.${base + 1}/31`);
    ospfIf(dev, leafIf);
    ospfIf(spine, spineIf);
    lab.addLink(dev.id, leafIf, spine.id, spineIf);
    dev.config.bgp!.neighbors.push(
      nbr({
        address: `10.${siteId}.0.11`,
        remoteAs: asn,
        updateSource: 'loopback0',
        afs: { l2vpn: evpnAf() },
      }),
    );
    spine.config.bgp!.neighbors.push(
      nbr({
        address: nodes[i + 1].lo0,
        remoteAs: asn,
        updateSource: 'loopback0',
        afs: { l2vpn: evpnAf({ routeReflectorClient: true }) },
      }),
    );
  });
  return { spine, leaves: [leafA, leafB], bgw };
}

/**
 * (c) Two-site EVPN Multi-Site.
 * Site 1 has a vPC leaf pair. Site 2 has an ESI all-active pair.
 * Border gateways re-originate between sites.
 */
export function exampleMultisiteVpc(): Lab {
  const lab = new Lab('Two-site Multi-Site with vPC');
  const s1 = siteUnderlay(lab, 's1', 65001, 1, 40);
  const s2 = siteUnderlay(lab, 's2', 65002, 2, 620);

  for (const site of [s1, s2]) {
    for (const leaf of [...site.leaves, site.bgw]) {
      leafOverlay(leaf);
      const ms = leaf.role === 'border-gateway' ? 'loopback100' : undefined;
      nve(leaf, 'loopback1', [
        { vni: 10010 },
        { vni: 10020 },
        { vni: 50001, l3: true },
      ], ms);
      leaf.config.bgp!.vrfs.push({
        name: 'TENANT',
        afs: { ipv4: { networks: [], redistributeDirect: { routeMap: 'FABRIC' } } },
      });
    }
  }

  // vPC pair on site 1.
  const [l1, l2] = s1.leaves;
  feat(l1, 'vpc', 'lacp');
  feat(l2, 'vpc', 'lacp');
  loopback(l1, 1, '10.1.1.100', true);
  loopback(l2, 1, '10.1.1.100', true);
  l1.config.vpc = { domain: 1, keepaliveDest: '10.1.255.1', keepaliveSrc: '10.1.255.0', rolePriority: 100, peerGateway: true };
  l2.config.vpc = { domain: 1, keepaliveDest: '10.1.255.0', keepaliveSrc: '10.1.255.1', rolePriority: 200, peerGateway: true };
  const po1 = intf(l1, 'port-channel1');
  po1.switchport = true;
  po1.adminDown = false;
  po1.mode = 'trunk';
  po1.vpcPeerLink = true;
  const po2 = intf(l2, 'port-channel1');
  po2.switchport = true;
  po2.adminDown = false;
  po2.mode = 'trunk';
  po2.vpcPeerLink = true;
  lab.addLink(l1.id, 'port-channel1', l2.id, 'port-channel1');
  routed(l1, 'Ethernet1/30', '10.1.255.0/31');
  routed(l2, 'Ethernet1/30', '10.1.255.1/31');
  lab.addLink(l1.id, 'Ethernet1/30', l2.id, 'Ethernet1/30');
  access(l1, 'Ethernet1/10', 10, 10);
  access(l2, 'Ethernet1/10', 10, 10);

  const hostA = lab.addDevice({ id: 'host-a', role: 'host', x: 80, y: 430, systemMac: '0050.000a.0001' });
  hostA.host = { mac: '0050.000a.0001', ip: '10.10.10.11', prefix: 24, vlan: 10, gateway: '10.10.10.1' };
  lab.addLink(l1.id, 'Ethernet1/10', hostA.id, 'eth0');
  lab.addLink(l2.id, 'Ethernet1/10', hostA.id, 'eth1');

  // ESI pair on site 2, vlan 10, plus a single-homed host on vlan 20 for L3.
  const [e1, e2] = s2.leaves;
  const esi = '0300.0000.0000.0000.0011';
  access(e1, 'Ethernet1/11', 10);
  access(e2, 'Ethernet1/11', 10);
  intf(e1, 'Ethernet1/11').esi = esi;
  intf(e2, 'Ethernet1/11').esi = esi;
  const hostE = lab.addDevice({ id: 'host-e', role: 'host', x: 700, y: 430, systemMac: '0050.000e.0001' });
  hostE.host = { mac: '0050.000e.0001', ip: '10.10.10.21', prefix: 24, vlan: 10, gateway: '10.10.10.1' };
  lab.addLink(e1.id, 'Ethernet1/11', hostE.id, 'eth0');
  lab.addLink(e2.id, 'Ethernet1/11', hostE.id, 'eth1');
  host(lab, 'host-c', e1, 'Ethernet1/12', '10.10.20.31', '0050.000c.0001', 20, '10.10.20.1', 860, 430);

  // Border gateways.
  for (const [bgw, siteId, asn] of [
    [s1.bgw, 1, 65001],
    [s2.bgw, 2, 65002],
  ] as const) {
    bgw.config.multisiteBgw = siteId;
    loopback(bgw, 100, `10.${siteId}.100.1`);
    const fabric = intf(bgw, 'Ethernet1/1');
    fabric.evpnMultisite = 'fabric-tracking';
    const dci = intf(bgw, 'Ethernet1/32');
    dci.evpnMultisite = 'dci-tracking';
    bgw.config.routeMaps.push({ name: 'MS-LB', entries: [{ seq: 10, action: 'permit', matchInterface: 'loopback100' }] });
    void asn;
  }
  routed(s1.bgw, 'Ethernet1/32', '172.16.0.0/31');
  routed(s2.bgw, 'Ethernet1/32', '172.16.0.1/31');
  lab.addLink(s1.bgw.id, 'Ethernet1/32', s2.bgw.id, 'Ethernet1/32');

  const dciAf = (remoteAs: number): BgpNeighborCfg =>
    nbr({
      address: remoteAs === 65002 ? '172.16.0.1' : '172.16.0.0',
      remoteAs,
      peerType: 'fabric-external',
      afs: {
        ipv4: { sendCommunity: 'extended' },
        l2vpn: evpnAf({ rewriteEvpnRtAsn: true, disablePeerAsCheck: true }),
      },
    });
  // Fix addresses explicitly.
  s1.bgw.config.bgp!.neighbors.push(
    nbr({
      address: '172.16.0.1',
      remoteAs: 65002,
      peerType: 'fabric-external',
      afs: {
        ipv4: { sendCommunity: 'extended' },
        l2vpn: evpnAf({ rewriteEvpnRtAsn: true, disablePeerAsCheck: true }),
      },
    }),
  );
  s2.bgw.config.bgp!.neighbors.push(
    nbr({
      address: '172.16.0.0',
      remoteAs: 65001,
      peerType: 'fabric-external',
      afs: {
        ipv4: { sendCommunity: 'extended' },
        l2vpn: evpnAf({ rewriteEvpnRtAsn: true, disablePeerAsCheck: true }),
      },
    }),
  );
  s1.bgw.config.bgp!.afs.ipv4!.redistributeDirect = { routeMap: 'MS-LB' };
  s2.bgw.config.bgp!.afs.ipv4!.redistributeDirect = { routeMap: 'MS-LB' };
  void dciAf;
  return lab;
}

export const EXAMPLES = [
  { id: 'clos-ibgp', name: 'Clos: OSPF + iBGP EVPN', blurb: '2 spines as route reflectors, 4 leaves', build: exampleClosIbgp },
  { id: 'five-stage', name: '5-stage eBGP', blurb: 'Super-spine / spine / leaf, eBGP underlay and overlay', build: exampleFiveStageEbgp },
  { id: 'multisite', name: 'Multi-Site + vPC', blurb: 'Two sites, border gateways, vPC pair and ESI pair', build: exampleMultisiteVpc },
] as const;
