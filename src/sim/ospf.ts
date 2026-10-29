import type { Lab } from './lab';
import { cmpIp, networkOf } from './ip';
import { hasFeature, intfKind, ospfRouterId, primaryIp } from './model';
import { addPath, selectBest } from './rib';
import type { Device, OspfFsm, OspfNbrOp } from './types';

const NEXT: Record<OspfFsm, OspfFsm> = {
  Down: 'Init',
  Init: 'ExStart',
  ExStart: 'Exchange',
  Exchange: 'Loading',
  Loading: 'Full',
  Full: 'Full',
};

interface Adj {
  local: Device;
  intf: string;
  neighbor: Device;
  neighborIntf: string;
  neighborIp: string;
  tag: string;
  area: string;
  network: 'point-to-point' | 'broadcast';
}

export function stepOspf(lab: Lab): void {
  const adjs = discover(lab);
  for (const dev of lab.devices) {
    if (dev.role === 'host') continue;
    const keep = new Set<string>();
    for (const adj of adjs.filter((a) => a.local.id === dev.id)) {
      const key = `${adj.tag}|${adj.intf}|${ospfRouterId(adj.neighbor, adj.tag)}`;
      keep.add(key);
      const prev = dev.mem.ospf[key];
      const state = prev ? NEXT[prev.state] : 'Init';
      dev.mem.ospf[key] = { state, since: prev && prev.state === state ? prev.since : lab.tick };
    }
    for (const k of Object.keys(dev.mem.ospf)) {
      if (!keep.has(k)) delete dev.mem.ospf[k];
    }
  }
  // Publish neighbor table and run SPF per process/area over the Full component.
  for (const dev of lab.devices) dev.op.ospfNbrs = [];
  const nbrs = buildNbrs(adjs);
  for (const n of nbrs) {
    n.local.op.ospfNbrs.push(n.op);
  }
  runSpf(lab, adjs);
}

function discover(lab: Lab): Adj[] {
  const out: Adj[] = [];
  for (const dev of lab.devices) {
    if (dev.role === 'host' || !hasFeature(dev, 'ospf')) continue;
    for (const intf of dev.config.interfaces) {
      if (!intf.ospf || !dev.op.ifOper[intf.name]) continue;
      const peer = lab.peer(dev.id, intf.name);
      if (!peer || peer.dev.role === 'host') continue;
      if (!hasFeature(peer.dev, 'ospf')) continue;
      const pintf = peer.dev.config.interfaces.find((i) => i.name === peer.intf);
      if (!pintf?.ospf || !peer.dev.op.ifOper[pintf.name]) continue;
      if (pintf.ospf.tag !== intf.ospf.tag) continue;
      if (pintf.ospf.area !== intf.ospf.area) continue;
      if (pintf.ospf.network !== intf.ospf.network) continue;
      const mine = primaryIp(intf);
      const theirs = primaryIp(pintf);
      if (!mine || !theirs) continue;
      if (mine.prefix !== theirs.prefix) continue;
      if (networkOf(mine.ip, mine.prefix) !== networkOf(theirs.ip, theirs.prefix)) continue;
      if (mine.ip === theirs.ip) continue;
      out.push({
        local: dev,
        intf: intf.name,
        neighbor: peer.dev,
        neighborIntf: pintf.name,
        neighborIp: theirs.ip,
        tag: intf.ospf.tag,
        area: intf.ospf.area,
        network: intf.ospf.network,
      });
    }
  }
  return out;
}

function buildNbrs(adjs: Adj[]): { local: Device; op: OspfNbrOp }[] {
  const rows: { local: Device; op: OspfNbrOp }[] = [];
  for (const adj of adjs) {
    const rid = ospfRouterId(adj.neighbor, adj.tag);
    const key = `${adj.tag}|${adj.intf}|${rid}`;
    const mem = adj.local.mem.ospf[key];
    if (!mem) continue;
    let role: 'DR' | 'BDR' | '-' = '-';
    if (adj.network === 'broadcast' && mem.state === 'Full') {
      const a = ospfRouterId(adj.local, adj.tag);
      const b = rid;
      role = cmpIp(a, b) > 0 ? 'DR' : 'BDR';
    }
    rows.push({
      local: adj.local,
      op: {
        tag: adj.tag,
        routerId: rid,
        priority: 1,
        state: mem.state,
        address: adj.neighborIp,
        intf: adj.intf,
        since: mem.since,
        role,
      },
    });
  }
  return rows;
}

interface Lsa {
  rid: string;
  stubs: { prefix: string; metric: number }[];
  links: { rid: string; metric: number }[];
}

function runSpf(_lab: Lab, adjs: Adj[]): void {
  const full = adjs.filter((a) => {
    const rid = ospfRouterId(a.neighbor, a.tag);
    return a.local.mem.ospf[`${a.tag}|${a.intf}|${rid}`]?.state === 'Full';
  });
  // Group by tag+area, flood within the connected component of Full adjacencies.
  const groups = new Map<string, Adj[]>();
  for (const a of full) {
    const k = `${a.tag}|${a.area}`;
    (groups.get(k) ?? groups.set(k, []).get(k)!).push(a);
  }
  for (const [k, list] of groups) {
    const [tag, area] = k.split('|');
    const comps = components(list);
    for (const comp of comps) {
      const members = new Set<Device>();
      for (const a of comp) {
        members.add(a.local);
        members.add(a.neighbor);
      }
      const lsdb = new Map<string, Lsa>();
      for (const dev of members) {
        const rid = ospfRouterId(dev, tag);
        const lsa: Lsa = { rid, stubs: [], links: [] };
        for (const intf of dev.config.interfaces) {
          if (intf.ospf?.tag !== tag || intf.ospf.area !== area || !dev.op.ifOper[intf.name]) continue;
          for (const addr of intf.ips) {
            lsa.stubs.push({ prefix: networkOf(addr.ip, addr.prefix), metric: intfKind(intf.name) === 'lo' ? 1 : 1 });
          }
        }
        for (const a of comp) {
          if (a.local !== dev) continue;
          lsa.links.push({ rid: ospfRouterId(a.neighbor, tag), metric: 1 });
        }
        lsdb.set(rid, lsa);
      }
      for (const dev of members) spfOne(dev, tag, lsdb, comp);
    }
  }
}

function components(list: Adj[]): Adj[][] {
  const seen = new Set<string>();
  const out: Adj[][] = [];
  const ids = new Set<string>();
  for (const a of list) {
    ids.add(a.local.id);
    ids.add(a.neighbor.id);
  }
  for (const id of ids) {
    if (seen.has(id)) continue;
    const stack = [id];
    const compIds = new Set<string>();
    while (stack.length) {
      const cur = stack.pop()!;
      if (compIds.has(cur)) continue;
      compIds.add(cur);
      seen.add(cur);
      for (const a of list) {
        if (a.local.id === cur && !compIds.has(a.neighbor.id)) stack.push(a.neighbor.id);
        if (a.neighbor.id === cur && !compIds.has(a.local.id)) stack.push(a.local.id);
      }
    }
    out.push(list.filter((a) => compIds.has(a.local.id) && compIds.has(a.neighbor.id)));
  }
  return out;
}

function spfOne(dev: Device, tag: string, lsdb: Map<string, Lsa>, comp: Adj[]): void {
  const self = ospfRouterId(dev, tag);
  const dist = new Map<string, number>();
  const prev = new Map<string, string[]>();
  dist.set(self, 0);
  const used = new Set<string>();
  while (used.size < lsdb.size) {
    let u: string | null = null;
    let best = Infinity;
    for (const rid of lsdb.keys()) {
      if (used.has(rid)) continue;
      const d = dist.get(rid);
      if (d != null && d < best) {
        best = d;
        u = rid;
      }
    }
    if (u == null) break;
    used.add(u);
    const lsa = lsdb.get(u)!;
    for (const link of lsa.links) {
      const nd = best + link.metric;
      const cur = dist.get(link.rid);
      if (cur == null || nd < cur) {
        dist.set(link.rid, nd);
        prev.set(link.rid, [u]);
      } else if (nd === cur) {
        const parents = prev.get(link.rid) ?? [];
        if (!parents.includes(u)) parents.push(u);
        prev.set(link.rid, parents);
      }
    }
  }
  const rib = dev.op.vrfRib;
  const installed = new Map<string, { metric: number; hops: { nh: string; intf: string }[] }>();
  for (const [rid, lsa] of lsdb) {
    if (rid === self) continue;
    const base = dist.get(rid);
    if (base == null) continue;
    const hopRids = firstHops(prev, self, rid);
    const adjs = hopRids
      .map((hopRid) => comp.find((a) => a.local === dev && ospfRouterId(a.neighbor, tag) === hopRid))
      .filter((a): a is Adj => !!a);
    if (!adjs.length) continue;
    for (const stub of lsa.stubs) {
      const metric = base + stub.metric;
      for (const adj of adjs) {
        const cur = installed.get(stub.prefix);
        const hop = { nh: adj.neighborIp, intf: adj.intf };
        if (!cur || metric < cur.metric) {
          installed.set(stub.prefix, { metric, hops: [hop] });
        } else if (metric === cur.metric) {
          if (cur.hops.length < 8 && !cur.hops.some((h) => h.nh === hop.nh && h.intf === hop.intf)) {
            cur.hops.push(hop);
          }
        }
      }
    }
  }
  for (const [prefix, info] of installed) {
    // Connected routes already cover local prefixes at pref 0.
    for (const h of info.hops) {
      addPath(rib, 'default', prefix, {
        nextHop: h.nh,
        intf: h.intf,
        pref: 110,
        metric: info.metric,
        protocol: `ospf-${tag}`,
        best: false,
      });
    }
    const route = rib['default']?.find((r) => r.prefix === prefix);
    if (route) selectBest(route);
  }
  dev.op.rib = rib['default'] ?? [];
}

function firstHops(prev: Map<string, string[]>, self: string, target: string): string[] {
  const hops = new Set<string>();
  const stack = [target];
  const seen = new Set<string>();
  while (stack.length) {
    const cur = stack.pop()!;
    if (cur === self || seen.has(cur)) continue;
    seen.add(cur);
    const parents = prev.get(cur) ?? [];
    for (const p of parents) {
      if (p === self) hops.add(cur);
      else stack.push(p);
    }
  }
  return [...hops];
}
