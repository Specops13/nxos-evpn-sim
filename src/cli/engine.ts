import { isIp, normalizeEsi, normalizeMac, parseCidr } from '../sim/ip';
import type { Lab } from '../sim/lab';
import {
  areaDot,
  canonicalIntf,
  ensureBgp,
  ensureBgpAf,
  ensureInterface,
  featureList,
  findNeighbor,
  hasFeature,
} from '../sim/model';
import type { BgpAfCfg, BgpNeighborCfg, BgpNbrAf, Device, InterfaceCfg } from '../sim/types';
import { runningConfig, sectionFilter } from './running';
import {
  attachTick,
  ping,
  showBgpEvpn,
  showBgpIpv4,
  showBgpSummary,
  showEs,
  showInterface,
  showIpInterfaceBrief,
  showIpOspfNeighbors,
  showIpRoute,
  showL2Mac,
  showL2MacIp,
  showLldp,
  showMacTable,
  showNveInterface,
  showNvePeers,
  showNveVni,
  showVlan,
  showVpc,
  showVrf,
} from './show';

export type Mode =
  | 'exec'
  | 'config'
  | 'if'
  | 'if-nve'
  | 'if-nve-vni'
  | 'if-esi'
  | 'router'
  | 'router-af'
  | 'nbr'
  | 'nbr-af'
  | 'vrf'
  | 'vrf-af'
  | 'vlan'
  | 'vpc'
  | 'rmap'
  | 'evpn'
  | 'evpn-vni';

export interface Session {
  mode: Mode;
  intf?: string;
  proto?: 'bgp' | 'ospf';
  ospfTag?: string;
  af?: 'ipv4' | 'l2vpn';
  afVrf?: string;
  neighbor?: string;
  vrf?: string;
  vlan?: number;
  evpnVni?: number;
  nveVni?: number;
  routeMap?: string;
  routeSeq?: number;
}

export function newSession(): Session {
  return { mode: 'exec' };
}

const PROMPT: Record<Mode, string> = {
  exec: '#',
  config: '(config)#',
  if: '(config-if)#',
  'if-nve': '(config-if-nve)#',
  'if-nve-vni': '(config-if-nve-vni)#',
  'if-esi': '(config-if-esi)#',
  router: '(config-router)#',
  'router-af': '(config-router-af)#',
  nbr: '(config-router-neighbor)#',
  'nbr-af': '(config-router-neighbor-af)#',
  vrf: '(config-vrf)#',
  'vrf-af': '(config-vrf-af)#',
  vlan: '(config-vlan)#',
  vpc: '(config-vpc-domain)#',
  rmap: '(config-route-map)#',
  evpn: '(config-evpn)#',
  'evpn-vni': '(config-evpn-evi)#',
};

export function promptOf(hostname: string, session: Session): string {
  return `${hostname}${PROMPT[session.mode]} `;
}

type ArgType = 'word' | 'ip' | 'cidr' | 'num' | 'intf' | 'mac' | 'esi' | 'rest' | 'slot';
type Tok = { lit: string; help: string } | { arg: string; type: ArgType; help: string };
interface Step {
  optional?: boolean;
  choices: Tok[][];
}
type Args = Record<string, string>;
interface Variant {
  modes: Mode[];
  toks: Tok[];
  run: (lab: Lab, dev: Device, args: Args, s: Session) => string | void;
}
interface Cmd {
  modes: Mode[];
  steps: Step[];
  run: Variant['run'];
}

const L = (text: string, help = text): Tok => ({ lit: text, help });
const A = (name: string, type: ArgType, help: string): Tok => ({ arg: name, type, help });
const seq = (...toks: Tok[]): Step => ({ choices: [toks] });
const opt = (...toks: Tok[]): Step => ({ optional: true, choices: [toks] });

const CONFIGISH: Mode[] = ['exec', 'config', 'if', 'if-nve', 'if-nve-vni', 'if-esi', 'router', 'router-af', 'nbr', 'nbr-af', 'vrf', 'vrf-af', 'vlan', 'vpc', 'rmap', 'evpn', 'evpn-vni'];

function expand(steps: Step[]): Tok[][] {
  let acc: Tok[][] = [[]];
  for (const step of steps) {
    const next: Tok[][] = [];
    for (const base of acc) {
      if (step.optional) next.push(base.slice());
      for (const choice of step.choices) next.push(base.concat(choice));
    }
    acc = next;
  }
  return acc;
}

const commands: Cmd[] = [];
function cmd(modes: Mode[], steps: Step[], run: Variant['run']): void {
  commands.push({ modes, steps, run });
}

function variants(mode: Mode): Variant[] {
  const out: Variant[] = [];
  for (const c of commands) {
    if (!c.modes.includes(mode)) continue;
    for (const toks of expand(c.steps)) out.push({ modes: c.modes, toks, run: c.run });
  }
  return out;
}

function coerce(tok: Tok, word: string): string | null {
  if ('lit' in tok) return tok.lit.startsWith(word) && word.length > 0 ? tok.lit : null;
  switch (tok.type) {
    case 'word':
      return /^[A-Za-z0-9_.:/-]+$/.test(word) ? word : null;
    case 'ip':
      return isIp(word) ? word : null;
    case 'cidr':
      return parseCidr(word) ? word : null;
    case 'num':
      return /^\d+$/.test(word) ? word : null;
    case 'intf':
      return canonicalIntf(word);
    case 'mac':
      return normalizeMac(word);
    case 'esi':
      return normalizeEsi(word);
    case 'slot':
      return /^\d+\/\d+$/.test(word) ? word : null;
    case 'rest':
      return word;
    default:
      return null;
  }
}

interface Hit {
  v: Variant;
  args: Args;
  lits: string[];
}

function matchToken(v: Variant, tokens: string[]): Hit | null {
  if (tokens.length > v.toks.length) return null;
  const args: Args = {};
  const lits: string[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const tok = v.toks[i];
    if ('arg' in tok && tok.type === 'rest') {
      args[tok.arg] = tokens.slice(i).join(' ');
      return { v, args, lits };
    }
    const value = coerce(tok, tokens[i]);
    if (value == null) return null;
    if ('lit' in tok) {
      lits.push(value);
      if (value === 'no') args.no = '1';
    } else args[tok.arg] = value;
  }
  return { v, args, lits };
}

function ambiguous(hits: Hit[], tokens: string[]): boolean {
  for (let i = 0; i < tokens.length; i++) {
    const lits = new Set<string>();
    for (const h of hits) {
      const tok = h.v.toks[i];
      if (tok && 'lit' in tok && tok.lit.startsWith(tokens[i]) && tok.lit !== tokens[i]) lits.add(tok.lit);
    }
    if (lits.size > 1) return true;
  }
  return false;
}

function caret(line: string, tokenIndex: number): string {
  const starts: number[] = [];
  let i = 0;
  while (i < line.length) {
    while (line[i] === ' ') i++;
    if (i >= line.length) break;
    starts.push(i);
    while (i < line.length && line[i] !== ' ') i++;
  }
  const col = tokenIndex >= starts.length ? line.length : starts[tokenIndex];
  return `${line}\n${' '.repeat(col)}^\n% Invalid command at '^' marker.`;
}

function incomplete(line: string): string {
  return `${line}\n${' '.repeat(line.length)}^\n% Incomplete command at '^' marker.`;
}

function ambig(line: string, tokenIndex: number): string {
  const starts: number[] = [];
  let i = 0;
  while (i < line.length) {
    while (line[i] === ' ') i++;
    if (i >= line.length) break;
    starts.push(i);
    while (i < line.length && line[i] !== ' ') i++;
  }
  const col = starts[tokenIndex] ?? 0;
  return `${line}\n${' '.repeat(col)}^\n% Ambiguous command at '^' marker.`;
}

export function execLine(lab: Lab, deviceId: string, raw: string, session: Session): string {
  const dev = lab.device(deviceId);
  if (!dev) return '% No such device';
  const line = raw.trim();
  if (!line) return '';
  if (dev.role === 'host') return hostExec(lab, dev, line);
  attachTick(dev, lab.tick);
  const { cmd, pipes } = splitPipes(line);
  if (session.mode !== 'exec' && pipes.length && !cmd.startsWith('show') && !cmd.startsWith('sh')) {
    /* pipes are legal on show from any mode */
  }
  const tokens = cmd.split(/\s+/).filter(Boolean);
  const hits = variants(session.mode)
    .map((v) => matchToken(v, tokens))
    .filter((h): h is Hit => !!h);
  if (!hits.length) {
    // longest successful prefix
    let bad = 0;
    for (let n = tokens.length; n >= 0; n--) {
      const pref = tokens.slice(0, n);
      const ok = variants(session.mode).some((v) => matchToken(v, pref));
      if (ok || n === 0) {
        bad = n;
        break;
      }
    }
    return caret(cmd, bad);
  }
  if (ambiguous(hits, tokens)) {
    let idx = 0;
    for (let i = 0; i < tokens.length; i++) {
      const lits = new Set(hits.map((h) => {
        const tok = h.v.toks[i];
        return tok && 'lit' in tok ? tok.lit : '';
      }));
      if ([...lits].filter(Boolean).length > 1) idx = i;
    }
    return ambig(cmd, idx);
  }
  const done = hits.filter((h) => {
    const rest = h.v.toks.findIndex((t) => 'arg' in t && t.type === 'rest');
    if (rest >= 0) return tokens.length >= rest;
    return h.v.toks.length === tokens.length;
  });
  if (!done.length) return incomplete(cmd);
  if (done.length > 1) return ambig(cmd, tokens.length - 1);
  const hit = done[0];
  const out = hit.v.run(lab, dev, hit.args, session) ?? '';
  if (!pipes.length) return out;
  if (!cmd.startsWith('sh') && !cmd.startsWith('show')) return out;
  return applyPipes(out, pipes);
}

function splitPipes(line: string): { cmd: string; pipes: { op: string; arg: string }[] } {
  const parts = line.split('|').map((p) => p.trim());
  const cmd = parts[0];
  const pipes = parts.slice(1).map((p) => {
    const bits = p.split(/\s+/);
    return { op: bits[0], arg: bits.slice(1).join(' ') };
  });
  return { cmd, pipes };
}

function applyPipes(output: string, pipes: { op: string; arg: string }[]): string {
  let lines = output.split('\n');
  for (const p of pipes) {
    if (p.op === 'include' || p.op.startsWith('inc')) lines = lines.filter((l) => l.includes(p.arg));
    else if (p.op === 'exclude' || p.op.startsWith('exc')) lines = lines.filter((l) => !l.includes(p.arg));
    else if (p.op === 'begin' || p.op.startsWith('beg')) {
      const i = lines.findIndex((l) => l.includes(p.arg));
      lines = i < 0 ? [] : lines.slice(i);
    } else if (p.op === 'count' || p.op.startsWith('cou')) return String(lines.filter((l) => l.length).length);
    else if (p.op === 'section' || p.op.startsWith('sec')) {
      return sectionFilter(lines.join('\n'), p.arg);
    }
  }
  return lines.join('\n');
}

export function helpFor(session: Session, line: string): string {
  const trimmed = line.replace(/\?\s*$/, '');
  const trailing = /\s$/.test(trimmed) || trimmed.length === 0;
  const tokens = trimmed.trim().length ? trimmed.trim().split(/\s+/) : [];
  const partial = trailing ? '' : tokens.pop() ?? '';
  const vars = variants(session.mode);
  const hits = tokens.length ? vars.map((v) => matchToken(v, tokens)).filter((h): h is Hit => !!h) : vars.map((v) => ({ v, args: {}, lits: [] }));
  const rows = new Map<string, string>();
  const idx = tokens.length;
  for (const h of hits) {
    const tok = h.v.toks[idx];
    if (!tok) continue;
    if ('lit' in tok) {
      if (partial && !tok.lit.startsWith(partial)) continue;
      rows.set(tok.lit, tok.help);
    } else if (!partial) rows.set(argLabel(tok.type), tok.help);
  }
  if (!rows.size) return '% Invalid command at \'^\' marker.';
  const keys = [...rows.keys()];
  const width = Math.max(12, ...keys.map((k) => k.length)) + 2;
  return keys
    .sort()
    .map((k) => `  ${k.padEnd(width)}${rows.get(k)}`)
    .join('\n');
}

function argLabel(t: ArgType): string {
  switch (t) {
    case 'ip':
      return 'A.B.C.D';
    case 'cidr':
      return 'A.B.C.D/LEN';
    case 'num':
      return 'NUMBER';
    case 'intf':
      return 'IFACE';
    case 'mac':
      return 'MAC';
    case 'esi':
      return 'ESI';
    case 'slot':
      return 'SLOT/PORT';
    default:
      return 'WORD';
  }
}

export function completeLine(session: Session, buffer: string): { buffer: string; output?: string } {
  const trailing = buffer.endsWith(' ') || buffer.length === 0;
  const tokens = buffer.trim().length ? buffer.trim().split(/\s+/) : [];
  const partial = trailing ? '' : tokens[tokens.length - 1];
  const baseTokens = trailing ? tokens : tokens.slice(0, -1);
  const vars = variants(session.mode);
  const hits = baseTokens.length ? vars.map((v) => matchToken(v, baseTokens)).filter((h): h is Hit => !!h) : vars.map((v) => ({ v, args: {}, lits: [] }));
  const idx = baseTokens.length;
  const lits = new Map<string, string>();
  for (const h of hits) {
    const tok = h.v.toks[idx];
    if (tok && 'lit' in tok && (!partial || tok.lit.startsWith(partial))) lits.set(tok.lit, tok.help);
  }
  if (lits.size === 1) {
    const word = [...lits.keys()][0];
    const prefix = baseTokens.join(' ');
    const next = (prefix ? prefix + ' ' : '') + word + ' ';
    return { buffer: next };
  }
  if (lits.size > 1) {
    const width = Math.max(12, ...[...lits.keys()].map((k) => k.length)) + 2;
    const output = [...lits.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([k, h]) => `  ${k.padEnd(width)}${h}`)
      .join('\n');
    return { buffer, output };
  }
  return { buffer };
}

function parent(s: Session): void {
  const m = s.mode;
  if (m === 'if-nve-vni') s.mode = 'if-nve';
  else if (m === 'if-esi' || m === 'if-nve' || m === 'if') s.mode = 'config';
  else if (m === 'nbr-af') s.mode = 'nbr';
  else if (m === 'nbr' || m === 'router-af') s.mode = 'router';
  else if (m === 'vrf-af') s.mode = 'vrf';
  else if (m === 'evpn-vni') s.mode = 'evpn';
  else if (m === 'exec') return;
  else s.mode = 'config';
}

function gate(dev: Device, feature: string, label: string): string | null {
  if (!hasFeature(dev, feature)) return `${label} feature is not enabled`;
  return null;
}

function intfOf(s: Session, dev: Device): InterfaceCfg {
  return ensureInterface(dev, s.intf || 'Ethernet1/1');
}

function afOf(dev: Device, s: Session): BgpAfCfg | null {
  const bgp = dev.config.bgp;
  if (!bgp) return null;
  if (s.afVrf) {
    let v = bgp.vrfs.find((x) => x.name === s.afVrf);
    if (!v) {
      v = { name: s.afVrf, afs: {} };
      bgp.vrfs.push(v);
    }
    v.afs.ipv4 ??= { networks: [] };
    return v.afs.ipv4;
  }
  if (s.af === 'l2vpn') return ensureBgpAf(bgp, 'l2vpn');
  return ensureBgpAf(bgp, 'ipv4');
}

function nbrAf(dev: Device, s: Session): BgpNbrAf | null {
  const n = dev.config.bgp && s.neighbor ? findNeighbor(dev.config.bgp, s.neighbor) : undefined;
  if (!n) return null;
  const key = s.af === 'l2vpn' ? 'l2vpn' : 'ipv4';
  n.afs[key] ??= {};
  return n.afs[key]!;
}

// ----- commands -----
const SHOW = CONFIGISH;

cmd(SHOW, [seq(L('show', 'Show running system information'), L('ip', 'Display IP information'), L('interface', 'IP interface status'), L('brief', 'Brief summary')), opt(L('vrf', 'VRF'), A('vrf', 'word', 'VRF name'))], (_l, dev, a) => showIpInterfaceBrief(dev, a.vrf ?? 'default'));

cmd(SHOW, [seq(L('show', 'Show'), L('interface', 'Interface status')), opt(A('intf', 'intf', 'Interface'))], (_l, dev, a) => showInterface(dev, a.intf));

cmd(SHOW, [seq(L('show', 'Show'), L('ip', 'IP'), L('route', 'IP routing table')), opt(L('vrf', 'VRF'), A('vrf', 'word', 'VRF name')), opt(A('prefix', 'cidr', 'Prefix'))], (_l, dev, a) => showIpRoute(dev, a.vrf ?? 'default', a.prefix));

cmd(SHOW, [seq(L('show', 'Show'), L('ip', 'IP'), L('ospf', 'OSPF'), L('neighbors', 'OSPF neighbors'))], (_l, dev) => showIpOspfNeighbors(dev));

cmd(SHOW, [seq(L('show', 'Show'), L('bgp', 'BGP'), L('summary', 'BGP summary'))], (_l, dev) => showBgpSummary(dev, 'ipv4'));

cmd(SHOW, [seq(L('show', 'Show'), L('bgp', 'BGP'), L('l2vpn', 'L2VPN'), L('evpn', 'EVPN'), L('summary', 'Summary'))], (_l, dev) => showBgpSummary(dev, 'l2vpn'));

cmd(SHOW, [seq(L('show', 'Show'), L('bgp', 'BGP'), L('l2vpn', 'L2VPN'), L('evpn', 'EVPN')), opt(L('route-type', 'Route type'), A('rt', 'num', '1-5'))], (_l, dev, a) => showBgpEvpn(dev, a.rt ? Number(a.rt) : undefined));

cmd(SHOW, [seq(L('show', 'Show'), L('bgp', 'BGP'), L('ipv4', 'IPv4'), L('unicast', 'Unicast'))], (_l, dev) => showBgpIpv4(dev));

cmd(SHOW, [seq(L('show', 'Show'), L('bgp', 'BGP'), L('ipv4', 'IPv4'), L('unicast', 'Unicast'), L('summary', 'Summary'))], (_l, dev) => showBgpSummary(dev, 'ipv4'));

cmd(SHOW, [seq(L('show', 'Show'), L('nve', 'NVE'), L('peers', 'NVE peers'))], (_l, dev) => showNvePeers(dev));
cmd(SHOW, [seq(L('show', 'Show'), L('nve', 'NVE'), L('vni', 'NVE VNIs'))], (_l, dev) => showNveVni(dev));
cmd(SHOW, [seq(L('show', 'Show'), L('nve', 'NVE'), L('interface', 'NVE interface'))], (_l, dev) => showNveInterface(dev));
cmd(SHOW, [seq(L('show', 'Show'), L('nve', 'NVE'), L('ethernet-segment', 'ESI'))], (_l, dev) => showEs(dev));

cmd(SHOW, [seq(L('show', 'Show'), L('l2route', 'L2RIB'), L('evpn', 'EVPN'), L('mac', 'MAC'), L('all', 'All'))], (_l, dev) => showL2Mac(dev));
cmd(SHOW, [seq(L('show', 'Show'), L('l2route', 'L2RIB'), L('evpn', 'EVPN'), L('mac-ip', 'MAC-IP'), L('all', 'All'))], (_l, dev) => showL2MacIp(dev));
cmd(SHOW, [seq(L('show', 'Show'), L('l2route', 'L2RIB'), L('evpn', 'EVPN'), L('ethernet-segment', 'ESI'), L('all', 'All'))], (_l, dev) => showEs(dev));
cmd(SHOW, [seq(L('show', 'Show'), L('mac', 'MAC'), L('address-table', 'MAC table'))], (_l, dev) => showMacTable(dev));
cmd(SHOW, [seq(L('show', 'Show'), L('vpc', 'vPC'), L('brief', 'Brief'))], (_l, dev) => showVpc(dev));
cmd(SHOW, [seq(L('show', 'Show'), L('vpc', 'vPC'))], (_l, dev) => showVpc(dev));
cmd(SHOW, [seq(L('show', 'Show'), L('vlan', 'VLAN'))], (_l, dev) => showVlan(dev));
cmd(SHOW, [seq(L('show', 'Show'), L('vrf', 'VRF'))], (_l, dev) => showVrf(dev));
cmd(SHOW, [seq(L('show', 'Show'), L('lldp', 'LLDP'), L('neighbors', 'Neighbors'))], (_l, dev) => showLldp(dev, 'lldp'));
cmd(SHOW, [seq(L('show', 'Show'), L('cdp', 'CDP'), L('neighbors', 'Neighbors'))], (_l, dev) => showLldp(dev, 'cdp'));
cmd(SHOW, [seq(L('show', 'Show'), L('running-config', 'Current configuration'))], (_l, dev) => runningConfig(dev));
cmd(SHOW, [seq(L('show', 'Show'), L('startup-config', 'Startup configuration'))], (_l, dev) => (dev.startup ? runningConfig({ ...dev, config: dev.startup }) : 'No startup configuration'));

cmd(['exec', 'config'], [seq(L('ping', 'Send echo messages'), A('dst', 'ip', 'Destination')), opt(L('vrf', 'VRF'), A('vrf', 'word', 'VRF')), opt(L('count', 'Count'), A('count', 'num', 'Count')), opt(L('source', 'Source'), A('src', 'ip', 'Source IP'))], (lab, dev, a) => ping(lab, dev, a.dst, a.vrf, a.count ? Number(a.count) : 5));

cmd(['exec'], [seq(L('configure', 'Enter configuration mode'), L('terminal', 'Configure from the terminal'))], (_l, _d, _a, s) => {
  s.mode = 'config';
});

cmd(['exec'], [seq(L('copy', 'Copy'), L('running-config', 'Running'), L('startup-config', 'Startup'))], (_l, dev) => {
  dev.startup = structuredClone(dev.config);
  return 'Copy complete.';
});
cmd(['exec'], [seq(L('copy', 'Copy'), L('run', 'Running'), L('start', 'Startup'))], (_l, dev) => {
  dev.startup = structuredClone(dev.config);
  return 'Copy complete.';
});

cmd(['config'], [seq(L('hostname', 'Set hostname'), A('name', 'word', 'Hostname'))], (_l, dev, a) => {
  dev.config.hostname = a.name;
});

for (const f of featureList()) {
  const lits = f.cli.map((w, i) => L(w, i === f.cli.length - 1 ? `Enable ${f.id}` : w));
  cmd(['config'], [opt(L('no', 'Negate a command')), seq(L('feature', 'Enable a feature'), ...lits)], (_l, dev, a) => {
    if (a.no) dev.config.features = dev.config.features.filter((x) => x !== f.id);
    else if (!dev.config.features.includes(f.id)) dev.config.features.push(f.id);
  });
}

cmd(['config'], [opt(L('no', 'Negate')), seq(L('nv', 'Network virtualization'), L('overlay', 'Overlay'), L('evpn', 'EVPN'))], (_l, dev, a) => {
  const g = gate(dev, 'nv overlay', 'NV overlay');
  if (g) return g;
  dev.config.nvOverlayEvpn = !a.no;
});

cmd(['config'], [seq(L('fabric', 'Fabric'), L('forwarding', 'Forwarding'), L('anycast-gateway-mac', 'Anycast gateway MAC'), A('mac', 'mac', 'MAC address'))], (_l, dev, a) => {
  const g = gate(dev, 'fabric forwarding', 'fabric forwarding');
  if (g) return g;
  dev.config.anycastGatewayMac = a.mac;
});

cmd(['config'], [opt(L('no', 'Negate')), seq(L('evpn', 'EVPN'), L('multisite', 'Multi-Site'), L('border-gateway', 'Border gateway'), A('id', 'num', 'Site ID'))], (_l, dev, a) => {
  const g = gate(dev, 'nv overlay', 'NV overlay');
  if (g) return g;
  dev.config.multisiteBgw = a.no ? undefined : Number(a.id);
});

cmd(['config'], [seq(L('vlan', 'VLAN'), A('id', 'num', 'VLAN ID'))], (_l, dev, a, s) => {
  const id = Number(a.id);
  if (!dev.config.vlans.some((v) => v.id === id)) dev.config.vlans.push({ id });
  s.mode = 'vlan';
  s.vlan = id;
});

cmd(['vlan'], [seq(L('name', 'VLAN name'), A('name', 'word', 'Name'))], (_l, dev, a, s) => {
  const v = dev.config.vlans.find((x) => x.id === s.vlan);
  if (v) v.name = a.name;
});
cmd(['vlan'], [seq(L('vn-segment', 'VXLAN segment'), A('vni', 'num', 'VNI'))], (_l, dev, a, s) => {
  const g = gate(dev, 'vn-segment-vlan-based', 'vn-segment-vlan-based');
  if (g) return g;
  const v = dev.config.vlans.find((x) => x.id === s.vlan);
  if (v) v.vnSegment = Number(a.vni);
});

cmd(['config'], [seq(L('vrf', 'VRF'), L('context', 'Create VRF'), A('name', 'word', 'VRF name'))], (_l, dev, a, s) => {
  if (!dev.config.vrfs.some((v) => v.name === a.name)) dev.config.vrfs.push({ name: a.name, afs: {} });
  s.mode = 'vrf';
  s.vrf = a.name;
});
cmd(['vrf'], [seq(L('vni', 'L3 VNI'), A('vni', 'num', 'VNI'))], (_l, dev, a, s) => {
  const v = dev.config.vrfs.find((x) => x.name === s.vrf);
  if (v) v.vni = Number(a.vni);
});
cmd(['vrf'], [seq(L('rd', 'Route distinguisher'), A('rd', 'word', 'auto or RD'))], (_l, dev, a, s) => {
  const v = dev.config.vrfs.find((x) => x.name === s.vrf);
  if (v) v.rd = a.rd === 'auto' ? 'auto' : a.rd;
});
cmd(['vrf'], [seq(L('address-family', 'Address family'), L('ipv4', 'IPv4'), L('unicast', 'Unicast'))], (_l, dev, _a, s) => {
  const v = dev.config.vrfs.find((x) => x.name === s.vrf);
  if (v) v.afs.ipv4 ??= { routeTargets: [] };
  s.mode = 'vrf-af';
});
for (const dir of ['import', 'export', 'both'] as const) {
  cmd(['vrf-af'], [seq(L('route-target', 'Route target'), L(dir, dir), A('value', 'word', 'auto or RT')), opt(L('evpn', 'EVPN'))], (_l, dev, a, s) => {
    const v = dev.config.vrfs.find((x) => x.name === s.vrf);
    if (!v) return;
    v.afs.ipv4 ??= { routeTargets: [] };
    v.afs.ipv4.routeTargets.push({ dir, value: a.value === 'auto' ? 'auto' : a.value, evpn: true });
  });
}

cmd(['config'], [seq(L('interface', 'Interface'), A('intf', 'intf', 'Interface'))], (_l, dev, a, s) => {
  const name = a.intf;
  if (name.startsWith('nve')) {
    const g = gate(dev, 'nv overlay', 'NV overlay');
    if (g) return g;
  }
  if (name.startsWith('Vlan')) {
    const g = gate(dev, 'interface-vlan', 'interface-vlan');
    if (g) return g;
  }
  ensureInterface(dev, name);
  s.intf = name;
  s.mode = name.startsWith('nve') ? 'if-nve' : 'if';
});

cmd(['if', 'if-nve'], [opt(L('no', 'Negate')), seq(L('shutdown', 'Administratively down'))], (_l, dev, a, s) => {
  intfOf(s, dev).adminDown = !a.no;
});
cmd(['if', 'if-nve'], [seq(L('description', 'Description'), A('text', 'rest', 'Text'))], (_l, dev, a, s) => {
  intfOf(s, dev).description = a.text;
});
cmd(['if'], [opt(L('no', 'Negate')), seq(L('switchport', 'Switchport'))], (_l, dev, a, s) => {
  const i = intfOf(s, dev);
  if (!a.no && i.ips.length) i.ips = [];
  i.switchport = !a.no;
});
cmd(['if'], [seq(L('switchport', 'Switchport'), L('mode', 'Mode'), L('access', 'Access'))], (_l, dev, _a, s) => {
  const i = intfOf(s, dev);
  i.switchport = true;
  i.mode = 'access';
});
cmd(['if'], [seq(L('switchport', 'Switchport'), L('mode', 'Mode'), L('trunk', 'Trunk'))], (_l, dev, _a, s) => {
  const i = intfOf(s, dev);
  i.switchport = true;
  i.mode = 'trunk';
});
cmd(['if'], [seq(L('switchport', 'Switchport'), L('access', 'Access'), L('vlan', 'VLAN'), A('id', 'num', 'VLAN'))], (_l, dev, a, s) => {
  const i = intfOf(s, dev);
  i.switchport = true;
  i.mode = 'access';
  i.accessVlan = Number(a.id);
});
cmd(['if'], [seq(L('ip', 'IP'), L('address', 'Address'), A('cidr', 'cidr', 'Address')), opt(L('secondary', 'Secondary')), opt(L('tag', 'Tag'), A('tag', 'num', 'Tag'))], (_l, dev, a, s) => {
  const i = intfOf(s, dev);
  if (i.switchport && (i.name.startsWith('Ethernet') || i.name.startsWith('port-channel'))) return 'IP address cannot be configured on switchport';
  i.switchport = false;
  const c = parseCidr(a.cidr)!;
  i.ips = i.ips.filter((x) => x.ip !== c.ip);
  i.ips.push({ ip: c.ip, prefix: c.prefix, secondary: !!a.no ? false : a.secondary === 'secondary' || Object.prototype.hasOwnProperty.call(a, 'secondary'), tag: a.tag ? Number(a.tag) : undefined });
});
// secondary literal is not stored in args. Fix the command to branch.
commands.pop();
cmd(['if', 'if-nve'], [seq(L('ip', 'IP'), L('address', 'Address'), A('cidr', 'cidr', 'Address'))], (_l, dev, a, s) => {
  const i = intfOf(s, dev);
  i.switchport = false;
  const c = parseCidr(a.cidr)!;
  i.ips = i.ips.filter((x) => x.secondary);
  i.ips.unshift({ ip: c.ip, prefix: c.prefix });
});
cmd(['if'], [seq(L('ip', 'IP'), L('address', 'Address'), A('cidr', 'cidr', 'Address'), L('secondary', 'Secondary'))], (_l, dev, a, s) => {
  const i = intfOf(s, dev);
  i.switchport = false;
  const c = parseCidr(a.cidr)!;
  i.ips.push({ ip: c.ip, prefix: c.prefix, secondary: true });
});
cmd(['if'], [seq(L('ip', 'IP'), L('address', 'Address'), A('cidr', 'cidr', 'Address'), L('tag', 'Tag'), A('tag', 'num', 'Tag'))], (_l, dev, a, s) => {
  const i = intfOf(s, dev);
  i.switchport = false;
  const c = parseCidr(a.cidr)!;
  const slot = i.ips.find((x) => x.ip === c.ip && !x.secondary);
  if (slot) slot.tag = Number(a.tag);
  else i.ips.push({ ip: c.ip, prefix: c.prefix, tag: Number(a.tag) });
});
cmd(['if'], [opt(L('no', 'Negate')), seq(L('ip', 'IP'), L('address', 'Address'))], (_l, dev, a, s) => {
  if (a.no) intfOf(s, dev).ips = [];
});
cmd(['if'], [seq(L('vrf', 'VRF'), L('member', 'Member'), A('name', 'word', 'VRF'))], (_l, dev, a, s) => {
  intfOf(s, dev).vrf = a.name;
});
cmd(['if'], [seq(L('ip', 'IP'), L('router', 'Router'), L('ospf', 'OSPF'), A('tag', 'word', 'Process'), L('area', 'Area'), A('area', 'word', 'Area'))], (_l, dev, a, s) => {
  const g = gate(dev, 'ospf', 'OSPF');
  if (g) return g;
  const i = intfOf(s, dev);
  i.ospf = { tag: a.tag, area: areaDot(a.area), network: i.ospf?.network ?? 'broadcast' };
});
cmd(['if'], [opt(L('no', 'Negate')), seq(L('ip', 'IP'), L('ospf', 'OSPF'), L('network', 'Network'), L('point-to-point', 'Point-to-point'))], (_l, dev, a, s) => {
  const i = intfOf(s, dev);
  i.ospf = { tag: i.ospf?.tag ?? 'UNDERLAY', area: i.ospf?.area ?? '0.0.0.0', network: a.no ? 'broadcast' : 'point-to-point' };
});
cmd(['if'], [seq(L('fabric', 'Fabric'), L('forwarding', 'Forwarding'), L('mode', 'Mode'), L('anycast-gateway', 'Anycast gateway'))], (_l, dev, _a, s) => {
  const g = gate(dev, 'fabric forwarding', 'fabric forwarding');
  if (g) return g;
  intfOf(s, dev).anycastGateway = true;
});
cmd(['if'], [seq(L('ip', 'IP'), L('forward', 'IP forward'))], (_l, dev, _a, s) => {
  intfOf(s, dev).ipForward = true;
});
cmd(['if'], [seq(L('vpc', 'vPC'), L('peer-link', 'Peer-link'))], (_l, dev, _a, s) => {
  const g = gate(dev, 'vpc', 'vPC');
  if (g) return g;
  intfOf(s, dev).vpcPeerLink = true;
});
cmd(['if'], [seq(L('vpc', 'vPC'), A('id', 'num', 'vPC id'))], (_l, dev, a, s) => {
  const g = gate(dev, 'vpc', 'vPC');
  if (g) return g;
  intfOf(s, dev).vpcId = Number(a.id);
});
cmd(['if'], [seq(L('evpn', 'EVPN'), L('multisite', 'Multi-Site'), L('dci-tracking', 'DCI tracking'))], (_l, dev, _a, s) => {
  intfOf(s, dev).evpnMultisite = 'dci-tracking';
});
cmd(['if'], [seq(L('evpn', 'EVPN'), L('multisite', 'Multi-Site'), L('fabric-tracking', 'Fabric tracking'))], (_l, dev, _a, s) => {
  intfOf(s, dev).evpnMultisite = 'fabric-tracking';
});
cmd(['if'], [seq(L('ethernet-segment', 'Ethernet segment'))], (_l, _d, _a, s) => {
  s.mode = 'if-esi';
});
cmd(['if-esi'], [seq(L('esi', 'ESI'), A('esi', 'esi', 'ESI value'))], (_l, dev, a, s) => {
  intfOf(s, dev).esi = a.esi;
});

cmd(['if-nve'], [seq(L('source-interface', 'Source interface'), A('intf', 'intf', 'Loopback'))], (_l, dev, a, s) => {
  intfOf(s, dev).nveSource = a.intf;
});
cmd(['if-nve'], [seq(L('host-reachability', 'Host reachability'), L('protocol', 'Protocol'), L('bgp', 'BGP'))], (_l, dev, _a, s) => {
  intfOf(s, dev).nveHostReachBgp = true;
});
cmd(['if-nve'], [seq(L('multisite', 'Multi-Site'), L('border-gateway', 'Border gateway'), L('interface', 'Interface'), A('intf', 'intf', 'Loopback'))], (_l, dev, a, s) => {
  intfOf(s, dev).nveMultisiteIf = a.intf;
});
cmd(['if-nve'], [seq(L('member', 'Member'), L('vni', 'VNI'), A('vni', 'num', 'VNI'), L('associate-vrf', 'L3 VNI'))], (_l, dev, a, s) => {
  const i = intfOf(s, dev);
  i.nveMembers = i.nveMembers.filter((m) => m.vni !== Number(a.vni));
  i.nveMembers.push({ vni: Number(a.vni), associateVrf: true });
});
cmd(['if-nve'], [seq(L('member', 'Member'), L('vni', 'VNI'), A('vni', 'num', 'VNI'))], (_l, dev, a, s) => {
  const i = intfOf(s, dev);
  const vni = Number(a.vni);
  if (!i.nveMembers.some((m) => m.vni === vni)) i.nveMembers.push({ vni });
  s.mode = 'if-nve-vni';
  s.nveVni = vni;
});
cmd(['if-nve-vni'], [seq(L('ingress-replication', 'Ingress replication'), L('protocol', 'Protocol'), L('bgp', 'BGP'))], (_l, dev, _a, s) => {
  const m = intfOf(s, dev).nveMembers.find((x) => x.vni === s.nveVni);
  if (m) m.ingressReplicationBgp = true;
});
cmd(['if-nve-vni'], [seq(L('mcast-group', 'Multicast group'), A('ip', 'ip', 'Group'))], (_l, dev, a, s) => {
  const m = intfOf(s, dev).nveMembers.find((x) => x.vni === s.nveVni);
  if (m) m.mcastGroup = a.ip;
});
cmd(['if-nve-vni'], [seq(L('multisite', 'Multi-Site'), L('ingress-replication', 'Ingress replication'))], (_l, dev, _a, s) => {
  const m = intfOf(s, dev).nveMembers.find((x) => x.vni === s.nveVni);
  if (m) m.multisiteIngressReplication = true;
});

cmd(['config'], [seq(L('router', 'Routing process'), L('bgp', 'BGP'), A('asn', 'num', 'AS number'))], (_l, dev, a, s) => {
  const g = gate(dev, 'bgp', 'BGP');
  if (g) return g;
  ensureBgp(dev, Number(a.asn));
  s.mode = 'router';
  s.proto = 'bgp';
  s.afVrf = undefined;
});
cmd(['config'], [seq(L('router', 'Routing process'), L('ospf', 'OSPF'), A('tag', 'word', 'Process tag'))], (_l, dev, a, s) => {
  const g = gate(dev, 'ospf', 'OSPF');
  if (g) return g;
  if (!dev.config.ospf.some((p) => p.tag === a.tag)) dev.config.ospf.push({ tag: a.tag });
  s.mode = 'router';
  s.proto = 'ospf';
  s.ospfTag = a.tag;
});
cmd(['router'], [seq(L('router-id', 'Router ID'), A('ip', 'ip', 'Router ID'))], (_l, dev, a, s) => {
  if (s.proto === 'ospf') {
    const p = dev.config.ospf.find((x) => x.tag === s.ospfTag);
    if (p) p.routerId = a.ip;
  } else if (dev.config.bgp) dev.config.bgp.routerId = a.ip;
});
cmd(['router'], [seq(L('address-family', 'Address family'), L('ipv4', 'IPv4'), L('unicast', 'Unicast'))], (_l, dev, _a, s) => {
  if (!dev.config.bgp) return 'BGP feature is not enabled';
  ensureBgpAf(dev.config.bgp, 'ipv4');
  s.mode = 'router-af';
  s.af = 'ipv4';
});
cmd(['router'], [seq(L('address-family', 'Address family'), L('l2vpn', 'L2VPN'), L('evpn', 'EVPN'))], (_l, dev, _a, s) => {
  if (!dev.config.bgp) return 'BGP feature is not enabled';
  ensureBgpAf(dev.config.bgp, 'l2vpn');
  s.mode = 'router-af';
  s.af = 'l2vpn';
});
cmd(['router'], [seq(L('neighbor', 'Neighbor'), A('ip', 'ip', 'Neighbor'))], (_l, dev, a, s) => {
  if (!dev.config.bgp) return 'BGP feature is not enabled';
  if (!findNeighbor(dev.config.bgp, a.ip)) dev.config.bgp.neighbors.push({ address: a.ip, afs: {} });
  s.mode = 'nbr';
  s.neighbor = a.ip;
});
cmd(['router'], [seq(L('vrf', 'VRF'), A('name', 'word', 'VRF'))], (_l, dev, a, s) => {
  if (!dev.config.bgp) return;
  if (!dev.config.bgp.vrfs.some((v) => v.name === a.name)) dev.config.bgp.vrfs.push({ name: a.name, afs: {} });
  s.afVrf = a.name;
  s.mode = 'router';
});

cmd(['router-af'], [seq(L('retain', 'Retain'), L('route-target', 'RT'), L('all', 'All'))], (_l, dev, _a, s) => {
  const af = afOf(dev, s);
  if (af) af.retainRouteTargetAll = true;
});
cmd(['router-af'], [seq(L('maximum-paths', 'ECMP'), A('n', 'num', 'Paths'))], (_l, dev, a, s) => {
  const af = afOf(dev, s);
  if (af) af.maximumPaths = Number(a.n);
});
cmd(['router-af'], [seq(L('maximum-paths', 'ECMP'), L('ibgp', 'iBGP'), A('n', 'num', 'Paths'))], (_l, dev, a, s) => {
  const af = afOf(dev, s);
  if (af) af.maximumPathsIbgp = Number(a.n);
});
cmd(['router-af'], [seq(L('redistribute', 'Redistribute'), L('direct', 'Connected')), opt(L('route-map', 'Route-map'), A('map', 'word', 'Name'))], (_l, dev, a, s) => {
  const af = afOf(dev, s);
  if (af) af.redistributeDirect = { routeMap: a.map };
});
cmd(['router-af'], [seq(L('network', 'Network'), A('cidr', 'cidr', 'Prefix'))], (_l, dev, a, s) => {
  const af = afOf(dev, s);
  if (af && !af.networks.includes(a.cidr)) af.networks.push(a.cidr);
});
cmd(['router-af'], [seq(L('nexthop', 'Next-hop'), L('route-map', 'Route-map'), A('map', 'word', 'Name'))], (_l, dev, a, s) => {
  const af = afOf(dev, s);
  if (af) af.nextHopRouteMap = a.map;
});

cmd(['nbr'], [seq(L('remote-as', 'Remote AS'), A('asn', 'num', 'AS'))], (_l, dev, a, s) => {
  const n = needNbr(dev, s);
  if (typeof n === 'string') return n;
  n.remoteAs = Number(a.asn);
});
cmd(['nbr'], [seq(L('update-source', 'Update source'), A('intf', 'intf', 'Interface'))], (_l, dev, a, s) => {
  const n = needNbr(dev, s);
  if (typeof n === 'string') return n;
  n.updateSource = a.intf;
});
cmd(['nbr'], [seq(L('ebgp-multihop', 'eBGP multihop'), A('ttl', 'num', 'TTL'))], (_l, dev, a, s) => {
  const n = needNbr(dev, s);
  if (typeof n === 'string') return n;
  n.ebgpMultihop = Number(a.ttl);
});
cmd(['nbr'], [seq(L('peer-type', 'Peer type'), L('fabric-external', 'Fabric external'))], (_l, dev, _a, s) => {
  const n = needNbr(dev, s);
  if (typeof n === 'string') return n;
  n.peerType = 'fabric-external';
});
cmd(['nbr'], [seq(L('address-family', 'Address family'), L('ipv4', 'IPv4'), L('unicast', 'Unicast'))], (_l, dev, _a, s) => {
  const n = needNbr(dev, s);
  if (typeof n === 'string') return n;
  n.afs.ipv4 ??= {};
  s.mode = 'nbr-af';
  s.af = 'ipv4';
});
cmd(['nbr'], [seq(L('address-family', 'Address family'), L('l2vpn', 'L2VPN'), L('evpn', 'EVPN'))], (_l, dev, _a, s) => {
  const n = needNbr(dev, s);
  if (typeof n === 'string') return n;
  n.afs.l2vpn ??= {};
  s.mode = 'nbr-af';
  s.af = 'l2vpn';
});

function needNbr(dev: Device, s: Session): BgpNeighborCfg | string {
  if (!dev.config.bgp || !s.neighbor) return 'BGP feature is not enabled';
  return findNeighbor(dev.config.bgp, s.neighbor) ?? 'BGP feature is not enabled';
}

for (const which of ['extended', 'standard', 'both'] as const) {
  cmd(['nbr-af'], [seq(L('send-community', 'Send community'), L(which, which))], (_l, dev, _a, s) => {
    const af = nbrAf(dev, s);
    if (af) af.sendCommunity = which;
  });
}
cmd(['nbr-af'], [seq(L('route-reflector-client', 'Route reflector client'))], (_l, dev, _a, s) => {
  const af = nbrAf(dev, s);
  if (af) af.routeReflectorClient = true;
});
cmd(['nbr-af'], [seq(L('allowas-in', 'Allow AS in')), opt(A('n', 'num', 'Count'))], (_l, dev, a, s) => {
  const af = nbrAf(dev, s);
  if (af) af.allowAsIn = a.n ? Number(a.n) : 3;
});
cmd(['nbr-af'], [seq(L('disable-peer-as-check', 'Disable peer AS check'))], (_l, dev, _a, s) => {
  const af = nbrAf(dev, s);
  if (af) af.disablePeerAsCheck = true;
});
cmd(['nbr-af'], [seq(L('rewrite-evpn-rt-asn', 'Rewrite RT ASN'))], (_l, dev, _a, s) => {
  const af = nbrAf(dev, s);
  if (af) af.rewriteEvpnRtAsn = true;
});
cmd(['nbr-af'], [seq(L('route-map', 'Route-map'), A('map', 'word', 'Name'), L('in', 'Inbound'))], (_l, dev, a, s) => {
  const af = nbrAf(dev, s);
  if (af) af.routeMapIn = a.map;
});
cmd(['nbr-af'], [seq(L('route-map', 'Route-map'), A('map', 'word', 'Name'), L('out', 'Outbound'))], (_l, dev, a, s) => {
  const af = nbrAf(dev, s);
  if (af) af.routeMapOut = a.map;
});

cmd(['config'], [seq(L('evpn', 'EVPN'))], (_l, dev, _a, s) => {
  const g = gate(dev, 'nv overlay', 'NV overlay');
  if (g) return g;
  s.mode = 'evpn';
});
cmd(['evpn'], [seq(L('vni', 'VNI'), A('vni', 'num', 'VNI'), L('l2', 'L2'))], (_l, dev, a, s) => {
  const vni = Number(a.vni);
  if (!dev.config.evpnVnis.some((e) => e.vni === vni)) dev.config.evpnVnis.push({ vni, importRt: ['auto'], exportRt: ['auto'], rd: 'auto' });
  s.mode = 'evpn-vni';
  s.evpnVni = vni;
});
cmd(['evpn-vni'], [seq(L('rd', 'RD'), A('rd', 'word', 'auto or RD'))], (_l, dev, a, s) => {
  const e = dev.config.evpnVnis.find((x) => x.vni === s.evpnVni);
  if (e) e.rd = a.rd === 'auto' ? 'auto' : a.rd;
});
cmd(['evpn-vni'], [seq(L('route-target', 'RT'), L('import', 'Import'), A('value', 'word', 'auto or RT'))], (_l, dev, a, s) => {
  const e = dev.config.evpnVnis.find((x) => x.vni === s.evpnVni);
  if (!e) return;
  e.importRt = e.importRt.filter((x) => x !== 'auto');
  e.importRt.push(a.value === 'auto' ? 'auto' : a.value);
});
cmd(['evpn-vni'], [seq(L('route-target', 'RT'), L('export', 'Export'), A('value', 'word', 'auto or RT'))], (_l, dev, a, s) => {
  const e = dev.config.evpnVnis.find((x) => x.vni === s.evpnVni);
  if (!e) return;
  e.exportRt = e.exportRt.filter((x) => x !== 'auto');
  e.exportRt.push(a.value === 'auto' ? 'auto' : a.value);
});

cmd(['config'], [seq(L('vpc', 'vPC'), L('domain', 'Domain'), A('id', 'num', 'Domain'))], (_l, dev, a, s) => {
  const g = gate(dev, 'vpc', 'vPC');
  if (g) return g;
  dev.config.vpc ??= { domain: Number(a.id), rolePriority: 32667 };
  dev.config.vpc.domain = Number(a.id);
  s.mode = 'vpc';
});
cmd(['vpc'], [seq(L('peer-keepalive', 'Keepalive'), L('destination', 'Destination'), A('dest', 'ip', 'Destination')), opt(L('source', 'Source'), A('src', 'ip', 'Source'))], (_l, dev, a) => {
  if (!dev.config.vpc) return;
  dev.config.vpc.keepaliveDest = a.dest;
  if (a.src) dev.config.vpc.keepaliveSrc = a.src;
});
cmd(['vpc'], [seq(L('role', 'Role'), L('priority', 'Priority'), A('n', 'num', 'Priority'))], (_l, dev, a) => {
  if (dev.config.vpc) dev.config.vpc.rolePriority = Number(a.n);
});
cmd(['vpc'], [seq(L('peer-gateway', 'Peer gateway'))], (_l, dev) => {
  if (dev.config.vpc) dev.config.vpc.peerGateway = true;
});

cmd(['config'], [seq(L('route-map', 'Route-map'), A('name', 'word', 'Name'), L('permit', 'Permit'), A('seq', 'num', 'Sequence'))], (_l, dev, a, s) => {
  let rm = dev.config.routeMaps.find((r) => r.name === a.name);
  if (!rm) {
    rm = { name: a.name, entries: [] };
    dev.config.routeMaps.push(rm);
  }
  const seqN = Number(a.seq);
  if (!rm.entries.some((e) => e.seq === seqN)) rm.entries.push({ seq: seqN, action: 'permit' });
  s.mode = 'rmap';
  s.routeMap = a.name;
  s.routeSeq = seqN;
});
cmd(['rmap'], [seq(L('match', 'Match'), L('interface', 'Interface'), A('intf', 'intf', 'Interface'))], (_l, dev, a, s) => {
  const e = entry(dev, s);
  if (e) e.matchInterface = a.intf;
});
cmd(['rmap'], [seq(L('match', 'Match'), L('tag', 'Tag'), A('tag', 'num', 'Tag'))], (_l, dev, a, s) => {
  const e = entry(dev, s);
  if (e) e.matchTag = Number(a.tag);
});
cmd(['rmap'], [seq(L('set', 'Set'), L('ip', 'IP'), L('next-hop', 'Next-hop'), L('unchanged', 'Unchanged'))], (_l, dev, _a, s) => {
  const e = entry(dev, s);
  if (e) e.setNextHopUnchanged = true;
});

function entry(dev: Device, s: Session) {
  return dev.config.routeMaps.find((r) => r.name === s.routeMap)?.entries.find((e) => e.seq === s.routeSeq);
}

cmd(CONFIGISH.filter((m) => m !== 'exec'), [seq(L('exit', 'Exit'))], (_l, _d, _a, s) => {
  parent(s);
});
cmd(CONFIGISH.filter((m) => m !== 'exec'), [seq(L('end', 'End'))], (_l, _d, _a, s) => {
  s.mode = 'exec';
});

function hostExec(lab: Lab, dev: Device, line: string): string {
  const t = line.trim().split(/\s+/);
  const h = dev.host;
  if (!h) return '% Host has no address';
  if (t[0] === 'ping' && t[1]) return ping(lab, dev, t[1], undefined, t[2] ? Number(t[2]) : 5);
  if (t[0] === 'show' && t[1] === 'ip') return `${h.ip}/${h.prefix}\nGateway ${h.gateway}\nVLAN ${h.vlan}\nMAC ${h.mac}`;
  if (t[0] === 'show' && t[1] === 'arp') {
    const { resolveMac } = awaitless();
    const gw = resolveMac(lab, attached(lab, dev), h.vlan, h.gateway);
    return `Address         MAC\n${h.gateway.padEnd(16)}${gw ?? 'incomplete'}`;
  }
  if (t[0] === '?' || t[0] === 'help') return '  ping      Ping a host\n  show ip   Address\n  show arp  ARP cache';
  return caret(line.trim(), 0);
}

function attached(lab: Lab, host: Device): Device {
  for (const l of lab.links) {
    if (l.a.device === host.id) return lab.device(l.b.device)!;
    if (l.b.device === host.id) return lab.device(l.a.device)!;
  }
  return host;
}

function awaitless(): { resolveMac: typeof import('../sim/forward').resolveMac } {
  return { resolveMac: (_lab, sw, vlan, ip) => {
    const row = sw.op.l2macip.find((m) => m.vlan === vlan && m.ip === ip);
    if (row) return row.mac;
    if (sw.config.anycastGatewayMac) return sw.config.anycastGatewayMac;
    return sw.systemMac;
  } };
}

