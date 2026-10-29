import { describe, expect, it } from 'vitest';
import { execLine, newSession } from '../src/cli/engine';
import { exampleClosIbgp, exampleFiveStageEbgp, exampleMultisiteVpc } from '../src/sim/examples';

describe('protocol details', () => {
  it('reflects EVPN type 2, 3, and 5 through iBGP route reflectors', () => {
    const lab = exampleClosIbgp();
    lab.converge(40);
    const leaf2 = lab.device('leaf2')!;
    const types = new Set(leaf2.op.evpn.filter((r) => r.best && r.source !== 'local').map((r) => r.type));
    expect(types.has(2)).toBe(true);
    expect(types.has(3)).toBe(true);
    expect(types.has(5)).toBe(true);
    const mac = leaf2.op.macTable.find((m) => m.mac === '0000.2222.3333');
    expect(mac?.flag).toBe('G');
    const s = newSession();
    const out = execLine(lab, 'leaf2', 'show bgp l2vpn evpn route-type 5', s);
    expect(out).toContain('[5]:');
    expect(out).toContain('Route Distinguisher:');
  });

  it('propagates EVPN across eBGP super-spines with the VTEP next hop preserved', () => {
    const lab = exampleFiveStageEbgp();
    lab.converge(48);
    const leaf1 = lab.device('leaf1')!;
    const t2 = leaf1.op.evpn.find((r) => r.type === 2 && r.mac === '0050.0001.0002' && r.best);
    expect(t2?.nextHop).toBe('10.3.0.2');
    expect(t2?.rts).toContain('65201:10010');
    const host = leaf1.op.evpn.find((r) => r.type === 2 && r.macIp === '10.10.20.13' && r.best);
    expect(host?.nextHop).toBe('10.3.0.3');
    expect(leaf1.op.evpn.some((r) => r.type === 5 && r.best && r.prefix === '10.10.20.0/24')).toBe(true);
  });

  it('drops an OSPF adjacency when one end is shut', () => {
    const lab = exampleClosIbgp();
    lab.converge(40);
    const leaf1 = lab.device('leaf1')!;
    expect(leaf1.op.ospfNbrs.filter((n) => n.state === 'Full').length).toBe(2);
    const s = newSession();
    execLine(lab, 'leaf1', 'configure terminal', s);
    execLine(lab, 'leaf1', 'interface Ethernet1/1', s);
    execLine(lab, 'leaf1', 'shutdown', s);
    lab.converge(8);
    expect(leaf1.op.ospfNbrs.filter((n) => n.state === 'Full').length).toBe(1);
    const brief = execLine(lab, 'leaf1', 'show ip interface brief', newSession());
    expect(brief).toContain('protocol-down/link-down/admin-down');
  });

  it('re-originates multisite routes toward the local border gateway', () => {
    const lab = exampleMultisiteVpc();
    lab.converge(56);
    const leaf = lab.device('s2-leaf1')!;
    const remoteMac = leaf.op.evpn.find((r) => r.type === 2 && r.mac === '0050.000a.0001' && r.best && !r.macIp);
    expect(remoteMac).toBeTruthy();
    expect(remoteMac!.nextHop).toBe('10.2.1.21');
    expect(remoteMac!.rts.some((rt) => rt.startsWith('65002:'))).toBe(true);
    const bgw = lab.device('s1-bgw')!;
    expect(bgw.op.nvePeers.some((p) => p.peerIp === '10.2.100.1' && p.state === 'Up')).toBe(true);
  });
});
