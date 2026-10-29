import type { Lab } from './lab';
import { connectedTo, deviceOwningIp, intfToward, hostAttachments } from './graph';
import { pathHops } from './forward';
import { cmpIp, networkOf } from './ip';
import {
  bgpRouterId,
  evalRouteMap,
  hasFeature,
  l2Rd,
  l2RouteTargets,
  l3Rd,
  l3RouteTargets,
  multisiteVip,
  nveSourceIps,
  primaryIp,
  sendsExtended,
  vlanForVni,
  vtepIpForHostPort,
} from './model';
import { addPath, lookup, selectBest } from './rib';
import type { BgpIpRoute, BgpFsm, BgpNeighborCfg, Device, EvpnRoute, InterfaceCfg } from './types';

const ADVANCE: Record<BgpFsm, BgpFsm> = {
  Idle: 'Connect',
  Connect: 'OpenSent',
  Active: 'Connect',
  OpenSent: 'OpenConfirm',
  OpenConfirm: 'Established',
  Established: 'Established',
};

export function stepBgp(lab: Lab): void {
  for (const dev of lab.devices) {
    if (dev.role === 'host') continue;
    const bgp = dev.config.bgp;
    const keep = new Set<string>();
    if (bgp && hasFeature(dev, 'bgp')) {
      for (const n of bgp.neighbors) {
        if (!n.remoteAs) continue;
        keep.add(n.address);
        const health = sessionHealth(lab, dev, n);
        const prev = dev.mem.bgp[n.address];
        let state: BgpFsm;
        if (health === 'down') state = 'Idle';
        else if (health === 'mismatch') state = 'Active';
        else state = prev ? ADVANCE[prev.state] : 'Connect';
        const since = prev && prev.state === state ? prev.since : lab.tick;
        const msgIn = prev?.msgIn ?? 0;
        const msgOut = prev?.msgOut ?? 0;
        dev.mem.bgp[n.address] = {
          state,
          since,
          msgIn: state === 'Established' ? msgIn + 1 : msgIn,
          msgOut: state === 'Established' ? msgOut + 1 : msgOut,
        };
        if (state !== 'Established') {
          delete dev.mem.ribInV4[n.address];
          delete dev.mem.ribInEvpn[n.address];
        }
      }
    }
    for (const k of Object.keys(dev.mem.bgp)) if (!keep.has(k)) delete dev.mem.bgp[k];
  }
  refreshPeerRows(lab);
}

/** One BGP advertisement pass: build adj-RIB-out from current best paths and install it. */
export function exchangeBgp(lab: Lab): void {
  const v4 = new Map<string, Map<string, BgpIpRoute[]>>();
  const ev = new Map<string, Map<string, EvpnRoute[]>>();
  for (const dev of lab.devices) {
    if (dev.role === 'host' || !dev.config.bgp || !hasFeature(dev, 'bgp')) continue;
    for (const n of dev.config.bgp.neighbors) {
      if (dev.mem.bgp[n.address]?.state !== 'Established') continue;
      deliver(lab, dev, n, advertiseV4(lab, dev, n), advertiseEvpn(lab, dev, n), v4, ev);
    }
  }
  for (const dev of lab.devices) {
    if (dev.role === 'host') continue;
    const v = v4.get(dev.id);
    const e = ev.get(dev.id);
    for (const n of dev.config.bgp?.neighbors ?? []) {
      if (dev.mem.bgp[n.address]?.state === 'Established') {
        dev.mem.ribInV4[n.address] = v?.get(n.address) ?? [];
        dev.mem.ribInEvpn[n.address] = e?.get(n.address) ?? [];
      }
    }
  }
  rebuildBgpTables(lab);
  refreshPeerRows(lab);
}

export function rebuildBgpTables(lab: Lab): void {
  for (const dev of lab.devices) {
    if (dev.role === 'host') continue;
    selectBgp(lab, dev);
  }
}

function deliver(
  lab: Lab,
  sender: Device,
  n: BgpNeighborCfg,
  ipv4: BgpIpRoute[],
  evpn: EvpnRoute[],
  v4: Map<string, Map<string, BgpIpRoute[]>>,
  ev: Map<string, Map<string, EvpnRoute[]>>,
): void {
  const remote = deviceOwningIp(lab, n.address);
  if (!remote) return;
  const src = sourceIp(lab, sender, n);
  if (!src) return;
  const back = remote.config.bgp?.neighbors.find((x) => x.address === src);
  if (!back) return;
  const acceptedV4 = ipv4
    .map((r) => acceptV4(remote, back, r))
    .filter((r): r is BgpIpRoute => !!r);
  const acceptedEv = evpn
    .map((r) => acceptEvpn(remote, back, r))
    .filter((r): r is EvpnRoute => !!r);
  const mv = v4.get(remote.id) ?? new Map<string, BgpIpRoute[]>();
  mv.set(src, acceptedV4);
  v4.set(remote.id, mv);
  const me = ev.get(remote.id) ?? new Map<string, EvpnRoute[]>();
  me.set(src, acceptedEv);
  ev.set(remote.id, me);
}

export function addBgpToRib(lab: Lab): void {
  for (const dev of lab.devices) {
    if (dev.role === 'host') continue;
    const asn = dev.config.bgp?.asn ?? 0;
    // Remove previously installed BGP paths so a withdrawn route does not stick.
    for (const list of Object.values(dev.op.vrfRib)) {
      for (const route of list) {
        route.paths = route.paths.filter((p) => !p.protocol.startsWith('bgp-'));
        selectBest(route);
      }
    }
    for (const r of dev.op.bgpIpv4) {
      if (!r.best && !r.multipath) continue;
      const resolved = resolveOut(dev, r.nextHop);
      if (!resolved) continue;
      addPath(dev.op.vrfRib, 'default', r.prefix, {
        nextHop: r.nextHop,
        intf: resolved,
        pref: r.source === 'ebgp' ? 20 : 200,
        metric: r.metric,
        protocol: `bgp-${asn}`,
        best: false,
        internal: r.source !== 'ebgp',
      });
      const route = dev.op.vrfRib['default']?.find((x) => x.prefix === r.prefix);
      if (route) selectBest(route);
    }
    dev.op.rib = dev.op.vrfRib['default'] ?? [];
  }
}

function resolveOut(dev: Device, nextHop: string): string | undefined {
  if (intfToward(dev, nextHop)) return intfToward(dev, nextHop);
  const route = lookup(dev, 'default', nextHop);
  const path = route?.paths.find((p) => p.best);
  if (!path) return undefined;
  if (path.intf && path.intf !== 'local') return path.intf;
  return intfToward(dev, path.nextHop) ?? path.intf;
}

function selectBgp(lab: Lab, dev: Device): void {
  const v4: BgpIpRoute[] = [];
  for (const routes of Object.values(dev.mem.ribInV4)) v4.push(...routes.map(cloneV4));
  for (const local of originateIpv4(dev)) v4.push(local);
  markBestV4(dev, v4);
  dev.op.bgpIpv4 = v4;

  const ev: EvpnRoute[] = [];
  for (const routes of Object.values(dev.mem.ribInEvpn)) ev.push(...routes.map(cloneEv));
  for (const local of originateEvpn(dev)) ev.push(local);
  for (const local of originateHostRoutes(lab, dev)) ev.push(local);
  markBestEvpn(dev, ev);
  dev.op.evpn = ev;
  dev.op.bgpTableVersion = ev.filter((e) => e.best).length + v4.filter((e) => e.best).length;
}

function markBestV4(dev: Device, routes: BgpIpRoute[]): void {
  const groups = new Map<string, BgpIpRoute[]>();
  for (const r of routes) {
    const g = groups.get(r.prefix) ?? [];
    g.push(r);
    groups.set(r.prefix, g);
  }
  for (const g of groups.values()) {
    g.sort(betterV4);
    const best = g[0];
    const max = maxPaths(dev, 'ipv4', best.source);
    g.forEach((r, i) => {
      r.valid = true;
      r.best = i === 0;
      r.multipath = false;
    });
    let n = 1;
    for (let i = 1; i < g.length && n < max; i++) {
      if (sameCostV4(best, g[i])) {
        g[i].multipath = true;
        g[i].best = true;
        n++;
      }
    }
  }
}

function markBestEvpn(dev: Device, routes: EvpnRoute[]): void {
  const groups = new Map<string, EvpnRoute[]>();
  for (const r of routes) {
    const k = `${r.type}|${r.rd}|${r.esi}|${r.ethTag}|${r.mac ?? ''}|${r.macIp ?? ''}|${r.prefix ?? ''}|${r.type === 3 || r.type === 4 ? r.nextHop : ''}`;
    const g = groups.get(k) ?? [];
    g.push(r);
    groups.set(k, g);
  }
  for (const g of groups.values()) {
    g.sort(betterEv);
    const best = g[0];
    const max = maxPaths(dev, 'l2vpn', best.source);
    g.forEach((r, i) => {
      r.valid = true;
      r.best = i === 0;
      r.multipath = false;
    });
    let n = 1;
    for (let i = 1; i < g.length && n < max; i++) {
      if (sameCostEv(best, g[i])) {
        g[i].multipath = true;
        g[i].best = true;
        n++;
      }
    }
  }
}

function betterV4(a: BgpIpRoute, b: BgpIpRoute): number {
  return comparePath(a, b);
}
function betterEv(a: EvpnRoute, b: EvpnRoute): number {
  return comparePath(a, b);
}

function comparePath(
  a: { weight: number; localPref?: number; asPath: number[]; origin: string; source: string; peer: string; metric: number },
  b: { weight: number; localPref?: number; asPath: number[]; origin: string; source: string; peer: string; metric: number },
): number {
  if (a.weight !== b.weight) return b.weight - a.weight;
  const lp = (b.localPref ?? 0) - (a.localPref ?? 0);
  if (lp) return lp;
  if (a.asPath.length !== b.asPath.length) return a.asPath.length - b.asPath.length;
  const ov = (o: string) => (o === 'i' ? 0 : o === 'e' ? 1 : 2);
  if (ov(a.origin) !== ov(b.origin)) return ov(a.origin) - ov(b.origin);
  if (a.metric !== b.metric) return a.metric - b.metric;
  const ext = (s: string) => (s === 'ebgp' ? 0 : s === 'ibgp' ? 1 : 2);
  if (ext(a.source) !== ext(b.source)) return ext(a.source) - ext(b.source);
  const ip = (p: string) => (p === 'local' ? 0 : cmpIp(p, '0.0.0.0'));
  return ip(a.peer) - ip(b.peer);
}

function sameCostV4(a: BgpIpRoute, b: BgpIpRoute): boolean {
  return a.weight === b.weight && (a.localPref ?? 0) === (b.localPref ?? 0) && a.asPath.length === b.asPath.length && a.origin === b.origin && a.source === b.source && a.metric === b.metric;
}
function sameCostEv(a: EvpnRoute, b: EvpnRoute): boolean {
  return sameCostV4(a as unknown as BgpIpRoute, b as unknown as BgpIpRoute);
}

function maxPaths(dev: Device, af: 'ipv4' | 'l2vpn', source: string): number {
  const cfg = af === 'ipv4' ? dev.config.bgp?.afs.ipv4 : dev.config.bgp?.afs.l2vpn;
  if (!cfg) return 1;
  if (source === 'ibgp') return cfg.maximumPathsIbgp ?? 1;
  if (source === 'ebgp') return cfg.maximumPaths ?? 1;
  return 1;
}

function sessionHealth(lab: Lab, dev: Device, n: BgpNeighborCfg): 'ok' | 'mismatch' | 'down' {
  const bgp = dev.config.bgp;
  if (!bgp || !hasFeature(dev, 'bgp') || n.remoteAs == null) return 'down';
  const src = sourceIp(lab, dev, n);
  if (!src) return 'down';
  const remote = deviceOwningIp(lab, n.address);
  const reachable = connectedTo(dev, n.address) || pathHops(lab, dev, n.address) != null;
  if (!remote?.config.bgp || !hasFeature(remote, 'bgp')) return reachable ? 'mismatch' : 'down';
  const back = remote.config.bgp.neighbors.find((x) => x.address === src);
  if (!back || back.remoteAs == null) return 'mismatch';
  if (back.remoteAs !== bgp.asn || n.remoteAs !== remote.config.bgp.asn) return 'mismatch';
  const shared = sharedAf(n, back);
  if (!shared) return 'mismatch';
  const ebgp = remote.config.bgp.asn !== bgp.asn;
  if (!connectedTo(dev, n.address)) {
    const hops = pathHops(lab, dev, n.address);
    if (hops == null) return 'down';
    if (ebgp && (n.ebgpMultihop == null || n.ebgpMultihop < Math.max(2, hops))) return 'down';
  }
  if (!canReach(lab, remote, src, back)) return 'down';
  return 'ok';
}

function canReach(lab: Lab, dev: Device, dest: string, n: BgpNeighborCfg): boolean {
  const bgp = dev.config.bgp;
  if (!bgp || n.remoteAs == null) return false;
  if (connectedTo(dev, dest)) return true;
  const ebgp = n.remoteAs !== bgp.asn;
  const hops = pathHops(lab, dev, dest);
  if (hops == null) return false;
  if (ebgp) {
    if (n.ebgpMultihop == null) return false;
    if (n.ebgpMultihop < Math.max(2, hops)) return false;
  }
  return true;
}

function sharedAf(a: BgpNeighborCfg, b: BgpNeighborCfg): boolean {
  if (a.afs.ipv4 && b.afs.ipv4) return true;
  if (a.afs.l2vpn && b.afs.l2vpn) return true;
  return false;
}

export function sourceIp(_lab: Lab, dev: Device, n: BgpNeighborCfg): string | null {
  if (n.updateSource) {
    const intf = dev.config.interfaces.find((i) => i.name === n.updateSource);
    if (!intf || !dev.op.ifOper[intf.name]) return null;
    return primaryIp(intf)?.ip ?? null;
  }
  const direct = intfToward(dev, n.address);
  if (direct) return primaryIp(dev.config.interfaces.find((i) => i.name === direct))?.ip ?? null;
  const route = lookup(dev, 'default', n.address);
  const path = route?.paths.find((p) => p.best);
  if (!path) return null;
  const intf = dev.config.interfaces.find((i) => i.name === path.intf);
  return primaryIp(intf)?.ip ?? null;
}

function originateIpv4(dev: Device): BgpIpRoute[] {
  const bgp = dev.config.bgp;
  if (!bgp || !hasFeature(dev, 'bgp')) return [];
  const af = bgp.afs.ipv4;
  const routes: BgpIpRoute[] = [];
  const push = (prefix: string, origin: 'i' | '?', tag?: number) => {
    if (routes.some((r) => r.prefix === prefix)) return;
    routes.push({
      prefix,
      nextHop: '0.0.0.0',
      asPath: [],
      localPref: 100,
      origin,
      source: 'local',
      peer: 'local',
      cluster: [],
      weight: 32768,
      best: true,
      valid: true,
      metric: 0,
      tag,
    });
  };
  if (af?.redistributeDirect) {
    for (const intf of dev.config.interfaces) {
      if ((intf.vrf || 'default') !== 'default') continue;
      if (!dev.op.ifOper[intf.name]) continue;
      for (const addr of intf.ips) {
        const rm = evalRouteMap(dev, af.redistributeDirect.routeMap, { intf: intf.name, tag: addr.tag });
        if (!rm.permit) continue;
        push(networkOf(addr.ip, addr.prefix), '?', addr.tag);
      }
    }
  }
  for (const n of af?.networks ?? []) {
    const hit = (dev.op.vrfRib['default'] ?? []).some((r) => r.prefix === n);
    if (hit) push(n, 'i');
  }
  return routes;
}

function advertiseV4(lab: Lab, dev: Device, n: BgpNeighborCfg): BgpIpRoute[] {
  const af = n.afs.ipv4;
  if (!af || !dev.config.bgp) return [];
  const localAs = dev.config.bgp.asn;
  const ebgp = n.remoteAs !== localAs;
  const out: BgpIpRoute[] = [];
  const candidates = dev.op.bgpIpv4.filter((r) => r.best && !r.multipath);
  for (const r of candidates) {
    if (r.peer === n.address) continue;
    if (!exportAllowed(dev, n, r.source, !!r.fromClient, false)) continue;
    if (r.cluster.includes(bgpRouterId(dev))) continue;
    if (ebgp && n.remoteAs != null && r.asPath.includes(n.remoteAs) && !af.disablePeerAsCheck) continue;
    let rm = { permit: true, nextHopUnchanged: false };
    if (af.routeMapOut) rm = evalRouteMap(dev, af.routeMapOut, { tag: r.tag });
    if (dev.config.bgp.afs.ipv4?.nextHopRouteMap) {
      const arm = evalRouteMap(dev, dev.config.bgp.afs.ipv4.nextHopRouteMap, { tag: r.tag });
      if (!arm.permit) continue;
      rm = { permit: rm.permit, nextHopUnchanged: rm.nextHopUnchanged || arm.nextHopUnchanged };
    }
    if (!rm.permit) continue;
    const copy = cloneV4(r);
    copy.weight = 0;
    if (ebgp) {
      copy.asPath = [localAs, ...copy.asPath];
      copy.source = 'ebgp';
      copy.localPref = undefined;
      if (!rm.nextHopUnchanged) copy.nextHop = sourceIp(lab, dev, n) ?? copy.nextHop;
    } else {
      copy.source = r.source === 'local' ? 'ibgp' : 'ibgp';
      if (r.source === 'local') copy.nextHop = sourceIp(lab, dev, n) ?? copy.nextHop;
      if (r.source !== 'local') copy.cluster = [...copy.cluster, bgpRouterId(dev)];
    }
    copy.peer = sourceIp(lab, dev, n) ?? 'local';
    copy.fromClient = false;
    out.push(copy);
  }
  return out;
}

function exportAllowed(dev: Device, n: BgpNeighborCfg, source: string, fromClient: boolean, evpn: boolean): boolean {
  const localAs = dev.config.bgp?.asn ?? 0;
  const ebgp = n.remoteAs !== localAs;
  const af = evpn ? n.afs.l2vpn : n.afs.ipv4;
  const toClient = !!af?.routeReflectorClient;
  if (source === 'local') return true;
  if (ebgp) return true;
  // iBGP split horizon, with reflection.
  if (source === 'ebgp') return true;
  if (fromClient || toClient) return true;
  return false;
}

function acceptV4(dev: Device, n: BgpNeighborCfg, route: BgpIpRoute): BgpIpRoute | null {
  const localAs = dev.config.bgp?.asn ?? 0;
  const af = n.afs.ipv4;
  if (!af) return null;
  const count = route.asPath.filter((a) => a === localAs).length;
  if (count > 0 && (af.allowAsIn == null || count > af.allowAsIn)) return null;
  if (route.cluster.includes(bgpRouterId(dev))) return null;
  if (af.routeMapIn) {
    const rm = evalRouteMap(dev, af.routeMapIn, { tag: route.tag });
    if (!rm.permit) return null;
  }
  const copy = cloneV4(route);
  copy.peer = n.address;
  copy.fromClient = !!af.routeReflectorClient;
  if (copy.source === 'ebgp') copy.localPref = copy.localPref ?? 100;
  return copy;
}

function advertiseEvpn(lab: Lab, dev: Device, n: BgpNeighborCfg): EvpnRoute[] {
  const af = n.afs.l2vpn;
  if (!af || !dev.config.bgp) return [];
  const localAs = dev.config.bgp.asn;
  const ebgp = n.remoteAs !== localAs;
  const bgw = isBgw(dev);
  const externalPeer = n.peerType === 'fabric-external';
  let pool: EvpnRoute[] = [];
  if (bgw && externalPeer) {
    if (!trackingUp(dev, 'dci-tracking')) return [];
    const vip = multisiteVip(dev);
    if (!vip) return [];
    pool = dev.op.evpn.filter((r) => r.best && !r.multipath && r.learnedFrom !== 'external' && !r.reoriginatedBy.includes(dev.id));
    pool = pool.map((r) => reorig(dev, r, vip, 'external'));
  } else {
    const locals = dev.op.evpn.filter((r) => r.best && !r.multipath && r.source === 'local');
    const learned = dev.op.evpn.filter((r) => r.best && !r.multipath && r.source !== 'local' && r.learnedFrom !== 'external');
    const reorigExt =
      bgw && trackingUp(dev, 'fabric-tracking')
        ? dev.op.evpn
            .filter((r) => r.best && !r.multipath && r.learnedFrom === 'external' && !r.reoriginatedBy.includes(dev.id))
            .map((r) => reorig(dev, r, nveSourceIps(dev).primary ?? bgpRouterId(dev), 'fabric'))
        : [];
    pool = [...locals, ...reorigExt, ...learned];
  }
  const out: EvpnRoute[] = [];
  for (const r of pool) {
    if (r.peer === n.address) continue;
    const fromClient = !!r.fromClient;
    if (!exportAllowed(dev, n, r.source, fromClient, true)) continue;
    if (r.cluster.includes(bgpRouterId(dev))) continue;
    if (ebgp && n.remoteAs != null && r.asPath.includes(n.remoteAs) && !af.disablePeerAsCheck) continue;
    let unchanged = false;
    if (af.routeMapOut) {
      const rm = evalRouteMap(dev, af.routeMapOut, {});
      if (!rm.permit) continue;
      unchanged = rm.nextHopUnchanged;
    }
    if (dev.config.bgp.afs.l2vpn?.nextHopRouteMap) {
      const rm = evalRouteMap(dev, dev.config.bgp.afs.l2vpn.nextHopRouteMap, {});
      if (!rm.permit) continue;
      unchanged = unchanged || rm.nextHopUnchanged;
    }
    const copy = cloneEv(r);
    copy.weight = 0;
    if (!sendsExtended(af)) {
      copy.rts = [];
      copy.routerMac = undefined;
    }
    if (ebgp) {
      copy.asPath = [localAs, ...copy.asPath];
      copy.source = 'ebgp';
      copy.localPref = undefined;
      if (externalPeer && bgw) {
        copy.nextHop = multisiteVip(dev) ?? copy.nextHop;
      } else if (!unchanged && r.source === 'local') {
        /* locally originated EVPN next-hop is the VTEP; eBGP would rewrite it to the
           session source. next-hop unchanged keeps the VTEP. Without it, use session source
           only when that source is the VTEP; otherwise keep VTEP if unchanged was not set
           and update-source differs — NX-OS rewrites unless the route-map says otherwise.
           We follow NX-OS: rewrite to the BGP source address. */
        copy.nextHop = sourceIp(lab, dev, n) ?? copy.nextHop;
      } else if (!unchanged && r.source !== 'local') {
        copy.nextHop = sourceIp(lab, dev, n) ?? copy.nextHop;
      }
    } else {
      copy.source = 'ibgp';
      if (r.source !== 'local') copy.cluster = [...copy.cluster, bgpRouterId(dev)];
      if (r.source === 'local' && copy.nextHop === '0.0.0.0') copy.nextHop = nveSourceIps(dev).primary ?? sourceIp(lab, dev, n) ?? copy.nextHop;
    }
    copy.peer = sourceIp(lab, dev, n) ?? 'local';
    copy.fromClient = false;
    out.push(copy);
  }
  return dedupeEv(out);
}

function reorig(dev: Device, r: EvpnRoute, nextHop: string, toward: 'external' | 'fabric'): EvpnRoute {
  const site = dev.config.multisiteBgw ?? 0;
  const copy = cloneEv(r);
  copy.nextHop = nextHop;
  copy.routerMac = dev.systemMac;
  copy.source = 'local';
  copy.peer = 'local';
  copy.learnedFrom = 'local';
  copy.weight = 32768;
  copy.localPref = 100;
  copy.asPath = [];
  copy.cluster = [];
  copy.fromClient = false;
  copy.reoriginatedBy = [...r.reoriginatedBy, dev.id];
  if (site > 0 && site <= 65535 && r.vni) copy.rd = `${site}:${r.vni}`;
  copy.best = true;
  void toward;
  return copy;
}

function acceptEvpn(dev: Device, n: BgpNeighborCfg, route: EvpnRoute): EvpnRoute | null {
  const localAs = dev.config.bgp?.asn ?? 0;
  const af = n.afs.l2vpn;
  if (!af) return null;
  const count = route.asPath.filter((a) => a === localAs).length;
  if (count > 0 && (af.allowAsIn == null || count > af.allowAsIn)) return null;
  if (route.cluster.includes(bgpRouterId(dev))) return null;
  const copy = cloneEv(route);
  if (af.rewriteEvpnRtAsn) copy.rts = copy.rts.map((rt) => rewriteRtAsn(rt, localAs));
  if (af.routeMapIn) {
    const rm = evalRouteMap(dev, af.routeMapIn, {});
    if (!rm.permit) return null;
  }
  copy.peer = n.address;
  copy.fromClient = !!af.routeReflectorClient;
  copy.learnedFrom = n.peerType === 'fabric-external' ? 'external' : 'fabric';
  if (copy.source === 'ebgp' && copy.localPref == null) copy.localPref = 100;
  if (!dev.config.bgp?.afs.l2vpn?.retainRouteTargetAll && !importable(dev, copy)) return null;
  return copy;
}

export function importable(dev: Device, r: EvpnRoute): boolean {
  if (r.rts.length === 0) return false;
  if ((r.type === 1 || r.type === 4) && dev.config.interfaces.some((i) => i.esi && i.esi === r.esi)) return true;
  for (const rt of r.rts) {
    if (r.type === 5) {
      for (const v of dev.config.vrfs) {
        if (l3RouteTargets(dev, v.name, 'import').includes(rt)) return true;
      }
    } else {
      const vni = r.vni || r.ethTag;
      if (vni && l2RouteTargets(dev, vni, 'import').includes(rt)) return true;
      for (const vlan of dev.config.vlans) {
        if (!vlan.vnSegment) continue;
        if (l2RouteTargets(dev, vlan.vnSegment, 'import').includes(rt)) return true;
      }
    }
  }
  return false;
}

function rewriteRtAsn(rt: string, asn: number): string {
  const i = rt.lastIndexOf(':');
  if (i < 0) return rt;
  const admin = asn > 65535 ? 23456 : asn;
  return `${admin}:${rt.slice(i + 1)}`;
}

function isBgw(dev: Device): boolean {
  return dev.config.multisiteBgw != null && hasFeature(dev, 'nv overlay') && dev.config.nvOverlayEvpn;
}

function trackingUp(dev: Device, kind: 'dci-tracking' | 'fabric-tracking'): boolean {
  return dev.config.interfaces.some((i) => i.evpnMultisite === kind && dev.op.ifOper[i.name]);
}

/** EVPN routes this switch originates from hosts, IMET, ESI, and VRF prefixes. */
export function originateEvpn(dev: Device): EvpnRoute[] {
  if (!dev.config.bgp || !hasFeature(dev, 'bgp') || !hasFeature(dev, 'nv overlay') || !dev.config.nvOverlayEvpn) return [];
  const nve = dev.config.interfaces.find((i) => i.name === 'nve1');
  if (!nve || !dev.op.ifOper['nve1'] || !nve.nveHostReachBgp) return [];
  const src = nveSourceIps(dev);
  if (!src.primary) return [];
  const routes: EvpnRoute[] = [];
  const base = (): Omit<EvpnRoute, 'type' | 'rd' | 'esi' | 'ethTag' | 'label' | 'nextHop' | 'rts' | 'vni'> => ({
    asPath: [],
    localPref: 100,
    origin: 'i',
    source: 'local',
    peer: 'local',
    cluster: [],
    weight: 32768,
    best: true,
    valid: true,
    metric: 0,
    reoriginatedBy: [],
    learnedFrom: 'local',
    routerMac: dev.systemMac,
  });

  // The lab is not in scope here — host attachments are filled by importOverlay's caller
  // via originateEvpnFor(lab, dev). This function handles config-only routes (IMET, type-5, ESI)
  // and is completed by originateHostRoutes.
  for (const m of nve.nveMembers) {
    if (m.associateVrf) continue;
    if (!m.ingressReplicationBgp && !m.multisiteIngressReplication && !m.mcastGroup) continue;
    if (!m.ingressReplicationBgp && !m.multisiteIngressReplication) continue;
    const vlan = vlanForVni(dev, m.vni);
    routes.push({
      ...base(),
      type: 3,
      rd: l2Rd(dev, m.vni),
      esi: '0',
      ethTag: 0,
      label: m.vni,
      nextHop: src.secondary && dev.config.vpc ? src.secondary : src.primary,
      rts: l2RouteTargets(dev, m.vni, 'export'),
      vni: m.vni,
      mac: undefined,
    });
    void vlan;
  }

  // Type-5 from VRF redistribute direct.
  for (const vrfBgp of dev.config.bgp.vrfs) {
    const af = vrfBgp.afs.ipv4;
    if (!af?.redistributeDirect) continue;
    const vrf = dev.config.vrfs.find((v) => v.name === vrfBgp.name);
    if (!vrf?.vni) continue;
    const member = nve.nveMembers.find((m) => m.vni === vrf.vni && m.associateVrf);
    if (!member) continue;
    for (const intf of dev.config.interfaces) {
      if ((intf.vrf || 'default') !== vrf.name) continue;
      if (!dev.op.ifOper[intf.name]) continue;
      for (const addr of intf.ips) {
        if (addr.secondary) continue;
        const rm = evalRouteMap(dev, af.redistributeDirect.routeMap, { intf: intf.name, tag: addr.tag });
        if (!rm.permit) continue;
        routes.push({
          ...base(),
          type: 5,
          rd: l3Rd(dev, vrf.name),
          esi: '0',
          ethTag: 0,
          prefix: networkOf(addr.ip, addr.prefix),
          label: vrf.vni,
          nextHop: src.primary,
          rts: l3RouteTargets(dev, vrf.name, 'export'),
          vni: vrf.vni,
          origin: '?',
        });
      }
    }
  }

  for (const intf of dev.config.interfaces) {
    if (!intf.esi || !dev.op.ifOper[intf.name]) continue;
    const esi = intf.esi;
    const nh = src.primary;
    const vlans = vlansOn(intf);
    const exportRts = new Set<string>();
    for (const vlanId of vlans) {
      const vlan = dev.config.vlans.find((v) => v.id === vlanId);
      if (!vlan?.vnSegment) continue;
      for (const rt of l2RouteTargets(dev, vlan.vnSegment, 'export')) exportRts.add(rt);
    }
    const rts = [...exportRts];
    if (!rts.length) continue;
    routes.push({
      ...base(),
      type: 4,
      rd: `${bgpRouterId(dev)}:1`,
      esi,
      ethTag: 0,
      label: 0,
      nextHop: nh,
      rts,
      vni: 0,
    });
    routes.push({
      ...base(),
      type: 1,
      rd: `${bgpRouterId(dev)}:1`,
      esi,
      ethTag: 4294967295,
      label: 0,
      nextHop: nh,
      rts,
      vni: 0,
    });
    for (const vlanId of vlans) {
      const vlan = dev.config.vlans.find((v) => v.id === vlanId);
      if (!vlan?.vnSegment) continue;
      routes.push({
        ...base(),
        type: 1,
        rd: l2Rd(dev, vlan.vnSegment),
        esi,
        ethTag: vlan.vnSegment,
        label: vlan.vnSegment,
        nextHop: nh,
        rts: l2RouteTargets(dev, vlan.vnSegment, 'export'),
        vni: vlan.vnSegment,
      });
    }
  }
  return routes;
}

export function originateHostRoutes(lab: Lab, dev: Device): EvpnRoute[] {
  if (!dev.config.bgp || !hasFeature(dev, 'bgp') || !dev.config.nvOverlayEvpn) return [];
  const nve = dev.config.interfaces.find((i) => i.name === 'nve1');
  if (!nve || !dev.op.ifOper['nve1'] || !nve.nveHostReachBgp) return [];
  const routes: EvpnRoute[] = [];
  for (const att of hostAttachments(lab, dev)) {
    const intf = dev.config.interfaces.find((i) => i.name === att.swIntf);
    if (!intf) continue;
    const vlan = dev.config.vlans.find((v) => v.id === att.host.host!.vlan);
    if (!vlan?.vnSegment) continue;
    const member = nve.nveMembers.find((m) => m.vni === vlan.vnSegment && !m.associateVrf);
    if (!member) continue;
    const nh = vtepIpForHostPort(dev, intf);
    if (!nh) continue;
    const esi = intf.esi ?? '0';
    const svi = sviFor(dev, vlan.id);
    const l3 = svi ? dev.config.vrfs.find((v) => v.name === (svi.vrf || 'default')) : undefined;
    const common = {
      asPath: [] as number[],
      localPref: 100,
      origin: 'i' as const,
      source: 'local' as const,
      peer: 'local',
      cluster: [] as string[],
      weight: 32768,
      best: true,
      valid: true,
      metric: 0,
      reoriginatedBy: [] as string[],
      learnedFrom: 'local' as const,
      routerMac: dev.systemMac,
      rd: l2Rd(dev, vlan.vnSegment),
      esi,
      ethTag: vlan.vnSegment,
      rts: l2RouteTargets(dev, vlan.vnSegment, 'export'),
      vni: vlan.vnSegment,
      nextHop: nh,
    };
    routes.push({
      ...common,
      type: 2,
      mac: att.host.host!.mac,
      label: vlan.vnSegment,
    });
    routes.push({
      ...common,
      type: 2,
      mac: att.host.host!.mac,
      macIp: att.host.host!.ip,
      label: vlan.vnSegment,
      label2: l3?.vni,
    });
  }
  return routes;
}

function sviFor(dev: Device, vlan: number): InterfaceCfg | undefined {
  return dev.config.interfaces.find((i) => i.name === `Vlan${vlan}`);
}

function vlansOn(intf: InterfaceCfg): number[] {
  if (!intf.switchport) return [];
  if (intf.mode === 'access') return [intf.accessVlan];
  return intf.trunkVlans === 'all' ? [] : intf.trunkVlans;
}

function cloneV4(r: BgpIpRoute): BgpIpRoute {
  return { ...r, asPath: [...r.asPath], cluster: [...r.cluster] };
}
function cloneEv(r: EvpnRoute): EvpnRoute {
  return { ...r, asPath: [...r.asPath], cluster: [...r.cluster], rts: [...r.rts], reoriginatedBy: [...r.reoriginatedBy] };
}
function dedupeEv(routes: EvpnRoute[]): EvpnRoute[] {
  const seen = new Set<string>();
  const out: EvpnRoute[] = [];
  for (const r of routes) {
    const k = `${r.type}|${r.rd}|${r.esi}|${r.mac ?? ''}|${r.macIp ?? ''}|${r.prefix ?? ''}|${r.nextHop}|${r.ethTag}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(r);
  }
  return out;
}

function refreshPeerRows(lab: Lab): void {
  for (const dev of lab.devices) {
    dev.op.bgpPeers = [];
    if (!dev.config.bgp) continue;
    for (const n of dev.config.bgp.neighbors) {
      const mem = dev.mem.bgp[n.address];
      if (!mem) continue;
      dev.op.bgpPeers.push({
        address: n.address,
        state: mem.state,
        since: mem.since,
        msgIn: mem.msgIn,
        msgOut: mem.msgOut,
        ipv4Pfx: (dev.mem.ribInV4[n.address] ?? []).length,
        evpnPfx: (dev.mem.ribInEvpn[n.address] ?? []).length,
      });
    }
  }
}

