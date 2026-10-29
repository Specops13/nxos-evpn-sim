import { describe, expect, it } from 'vitest';
import { exampleClosIbgp, exampleFiveStageEbgp, exampleMultisiteVpc } from '../src/sim/examples';
import { pingHost } from '../src/sim/forward';
import type { Device } from '../src/sim/types';

function established(dev: Device, af: 'evpn' | 'ipv4' = 'evpn'): string[] {
  return dev.op.bgpPeers
    .filter((p) => p.state !== 'Established' && (af === 'evpn' ? dev.config.bgp?.neighbors.find((n) => n.address === p.address)?.afs.l2vpn : dev.config.bgp?.neighbors.find((n) => n.address === p.address)?.afs.ipv4))
    .map((p) => `${dev.id} ${p.address} ${p.state}`);
}

describe('example fabrics converge', () => {
  it('clos iBGP: OSPF full, EVPN established, hosts ping', () => {
    const lab = exampleClosIbgp();
    lab.converge(40);
    const leaf1 = lab.device('leaf1')!;
    const down = lab.devices.flatMap((d) => established(d));
    expect(down, down.join('\n')).toEqual([]);
    const nbrs = leaf1.op.ospfNbrs.filter((n) => n.state === 'Full');
    expect(nbrs.length).toBe(2);
    const remote = leaf1.op.rib.find((r) => r.prefix === '10.1.1.2/32');
    expect(remote?.paths.filter((p) => p.best).length).toBe(2);
    expect(leaf1.op.nvePeers.filter((p) => p.state === 'Up').length).toBeGreaterThanOrEqual(2);
    const h1 = lab.device('host1')!;
    expect(pingHost(lab, h1, '10.10.10.12')).toContain('0.00% packet loss');
    expect(pingHost(lab, h1, '10.10.20.13')).toContain('0.00% packet loss');
  });

  it('5-stage eBGP: sessions established and pings', () => {
    const lab = exampleFiveStageEbgp();
    lab.converge(48);
    const down = lab.devices.flatMap((d) => [...established(d, 'evpn'), ...established(d, 'ipv4')]);
    expect(down, down.join('\n')).toEqual([]);
    const leaf1 = lab.device('leaf1')!;
    expect(leaf1.op.nvePeers.some((p) => p.peerIp === '10.3.0.2' && p.state === 'Up')).toBe(true);
    const h1 = lab.device('host1')!;
    expect(pingHost(lab, h1, '10.10.10.12'), pingHost(lab, h1, '10.10.10.12')).toContain('0.00% packet loss');
    expect(pingHost(lab, h1, '10.10.20.13')).toContain('0.00% packet loss');
  });

  it('multisite: re-origination, vPC, ESI DF, cross-site ping', () => {
    const lab = exampleMultisiteVpc();
    lab.converge(56);
    const down = lab.devices.flatMap((d) => [...established(d, 'evpn'), ...established(d, 'ipv4')]);
    expect(down, down.join('\n')).toEqual([]);
    const l1 = lab.device('s1-leaf1')!;
    expect(l1.op.vpc?.role).toBe('primary');
    expect(l1.op.vpc?.peerStatus).toContain('ok');
    const e1 = lab.device('s2-leaf1')!;
    const e2 = lab.device('s2-leaf2')!;
    const dfs = [e1, e2].filter((d) => d.op.esi.some((e) => e.df));
    expect(dfs.length).toBe(1);
    const types = new Set(e1.op.evpn.filter((r) => r.best).map((r) => r.type));
    expect(types.has(1)).toBe(true);
    expect(types.has(4)).toBe(true);
    const hostA = lab.device('host-a')!;
    expect(pingHost(lab, hostA, '10.10.10.21'), pingHost(lab, hostA, '10.10.10.21')).toContain('0.00% packet loss');
    expect(pingHost(lab, hostA, '10.10.20.31'), pingHost(lab, hostA, '10.10.20.31')).toContain('0.00% packet loss');
  });
});
