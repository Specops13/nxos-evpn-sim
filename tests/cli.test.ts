import { describe, expect, it } from 'vitest';
import { execLine, helpFor, newSession } from '../src/cli/engine';
import { exampleClosIbgp } from '../src/sim/examples';
import { Lab } from '../src/sim/lab';

describe('NX-OS CLI', () => {
  it('rejects unknown commands with a caret', () => {
    const lab = exampleClosIbgp();
    const s = newSession();
    const out = execLine(lab, 'leaf1', 'show foo', s);
    expect(out).toContain("% Invalid command at '^' marker.");
    expect(out).toContain('^');
  });

  it('gates router bgp on feature bgp', () => {
    const lab = new Lab('bare');
    const sw = lab.addDevice({ id: 'sw1', role: 'leaf' });
    const s = newSession();
    execLine(lab, sw.id, 'configure terminal', s);
    const out = execLine(lab, sw.id, 'router bgp 65001', s);
    expect(out).toContain('BGP feature is not enabled');
    expect(s.mode).toBe('config');
  });

  it('accepts abbreviations and prints EVPN and NVE tables', () => {
    const lab = exampleClosIbgp();
    lab.converge(40);
    const s = newSession();
    const evpn = execLine(lab, 'leaf1', 'sh bgp l2vpn evpn', s);
    expect(evpn).toContain('Route Distinguisher:');
    expect(evpn).toContain('[2]:');
    const peers = execLine(lab, 'leaf1', 'show nve peers', s);
    expect(peers).toContain('Peer-IP');
    expect(peers).toContain('Up');
    const filtered = execLine(lab, 'leaf1', 'show bgp l2vpn evpn | include Route Distinguisher', s);
    expect(filtered.split('\n').every((l) => l.includes('Route Distinguisher'))).toBe(true);
    const run = execLine(lab, 'leaf1', 'show running-config | section bgp', s);
    expect(run).toContain('router bgp 65001');
    expect(run).toContain('address-family l2vpn evpn');
  });

  it('question mark lists show ip options', () => {
    const s = newSession();
    const help = helpFor(s, 'show ip ?');
    expect(help).toContain('interface');
    expect(help).toContain('route');
    expect(help).toContain('ospf');
  });

  it('BGP stays Active on an AS mismatch and Idle when the source is shut', () => {
    const lab = exampleClosIbgp();
    lab.converge(40);
    const s = newSession();
    execLine(lab, 'leaf1', 'configure terminal', s);
    execLine(lab, 'leaf1', 'router bgp 65001', s);
    execLine(lab, 'leaf1', 'neighbor 10.0.0.11', s);
    execLine(lab, 'leaf1', 'remote-as 65099', s);
    lab.converge(12);
    const sum = execLine(lab, 'leaf1', 'show bgp l2vpn evpn summary', newSession());
    expect(sum).toContain('10.0.0.11');
    expect(sum).toContain('Active');
    execLine(lab, 'leaf1', 'remote-as 65001', s);
    execLine(lab, 'leaf1', 'end', s);
    execLine(lab, 'leaf1', 'configure terminal', s);
    execLine(lab, 'leaf1', 'interface loopback0', s);
    execLine(lab, 'leaf1', 'shutdown', s);
    lab.converge(8);
    const after = execLine(lab, 'leaf1', 'show bgp l2vpn evpn summary', newSession());
    expect(after).toContain('Idle');
  });
});
