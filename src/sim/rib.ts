import { networkOf } from './ip';
import { longest } from './ip';
import type { Lab } from './lab';
import type { Device, RibPath, RibRoute } from './types';

export function emptyRib(): Record<string, RibRoute[]> {
  return {};
}

export function addPath(rib: Record<string, RibRoute[]>, vrf: string, prefix: string, path: RibPath): void {
  const list = (rib[vrf] ??= []);
  let route = list.find((r) => r.prefix === prefix);
  if (!route) {
    route = { vrf, prefix, paths: [] };
    list.push(route);
  }
  const dup = route.paths.find((p) => p.nextHop === path.nextHop && p.intf === path.intf && p.protocol === path.protocol);
  if (!dup) route.paths.push(path);
}

export function rebuildConnected(lab: Lab): void {
  for (const dev of lab.devices) {
    if (dev.role === 'host') {
      dev.op.rib = [];
      dev.op.vrfRib = {};
      continue;
    }
    const rib: Record<string, RibRoute[]> = {};
    for (const intf of dev.config.interfaces) {
      if (!dev.op.ifOper[intf.name]) continue;
      const vrf = intf.vrf || 'default';
      for (const addr of intf.ips) {
        const subnet = networkOf(addr.ip, addr.prefix);
        addPath(rib, vrf, subnet, {
          nextHop: addr.ip,
          intf: intf.name,
          pref: 0,
          metric: 0,
          protocol: 'direct',
          best: true,
          attached: true,
          tag: addr.tag,
        });
        const host = `${addr.ip}/32`;
        if (host !== subnet) {
          addPath(rib, vrf, host, {
            nextHop: addr.ip,
            intf: intf.name,
            pref: 0,
            metric: 0,
            protocol: 'local',
            best: true,
            attached: true,
            tag: addr.tag,
          });
        }
      }
    }
    dev.op.vrfRib = rib;
    dev.op.rib = rib['default'] ?? [];
  }
}

/** Install protocol paths, then keep lowest admin-distance and mark ECMP best. */
export function installPaths(
  rib: Record<string, RibRoute[]>,
  vrf: string,
  prefix: string,
  paths: RibPath[],
): void {
  for (const p of paths) addPath(rib, vrf, prefix, p);
  const route = rib[vrf]?.find((r) => r.prefix === prefix);
  if (!route) return;
  selectBest(route);
}

export function selectBest(route: RibRoute): void {
  if (!route.paths.length) return;
  const bestPref = Math.min(...route.paths.map((p) => p.pref));
  const contenders = route.paths.filter((p) => p.pref === bestPref);
  const bestMetric = Math.min(...contenders.map((p) => p.metric));
  // OSPF/static ECMP on equal metric. BGP paths are pre-marked and share pref.
  for (const p of route.paths) {
    p.best = p.pref === bestPref && p.metric === bestMetric;
  }
}

export function lookup(dev: Device, vrf: string, ip: string): RibRoute | null {
  const list = dev.op.vrfRib[vrf] ?? (vrf === 'default' ? dev.op.rib : []);
  return longest(list, ip);
}

export function bestPaths(route: RibRoute | null): RibPath[] {
  if (!route) return [];
  return route.paths.filter((p) => p.best);
}
