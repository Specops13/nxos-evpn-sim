import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { EXAMPLES } from '../sim/examples';
import { Lab } from '../sim/lab';
import type { Device, Role, TopologyFile } from '../sim/types';
import { DeviceTerminal } from './Terminal';
import type { Session } from '../cli/engine';
import { distance, fitContent, midpoint, viewAfterPinch, worldPoint, type CanvasView, type Vec } from './canvasMath';

const STORE = 'nxos-evpn-lab-v1';
const ROLES: Role[] = ['super-spine', 'spine', 'leaf', 'border-gateway', 'host'];

const ROLE_COLOR: Record<Role, string> = {
  'super-spine': '#e2b340',
  spine: '#4c8dff',
  leaf: '#3dbe7a',
  'border-gateway': '#b07cff',
  host: '#9aa8b8',
};

type Tab = 'topology' | 'cli' | 'devices';

function loadInitial(): Lab {
  try {
    const raw = localStorage.getItem(STORE);
    if (raw) {
      const file = JSON.parse(raw) as TopologyFile;
      const lab = Lab.fromJSON(file);
      lab.converge(48);
      return lab;
    }
  } catch {
    /* fall through to the built-in clos */
  }
  const lab = EXAMPLES[0].build();
  lab.converge(48);
  return lab;
}

function nextIntf(lab: Lab, dev: Device): string {
  if (dev.role === 'host') {
    for (const name of ['eth0', 'eth1', 'eth2']) {
      const used = lab.links.some(
        (l) => (l.a.device === dev.id && l.a.intf === name) || (l.b.device === dev.id && l.b.intf === name),
      );
      if (!used) return name;
    }
    return 'eth0';
  }
  for (let n = 1; n <= 48; n++) {
    const name = `Ethernet1/${n}`;
    const used = lab.links.some(
      (l) => (l.a.device === dev.id && l.a.intf === name) || (l.b.device === dev.id && l.b.intf === name),
    );
    if (!used) return name;
  }
  return 'Ethernet1/1';
}

function bgpCounts(dev: Device): string {
  if (dev.role === 'host') return dev.host ? `${dev.host.ip}` : 'host';
  const peers = dev.op.bgpPeers;
  if (!peers.length) return dev.role;
  const up = peers.filter((p) => p.state === 'Established').length;
  const nve = dev.op.nvePeers.filter((p) => p.state === 'Up').length;
  return `BGP ${up}/${peers.length}${nve ? ` · NVE ${nve}` : ''}`;
}

function newDeviceId(lab: Lab, role: Role): string {
  const n = lab.devices.filter((d) => d.role === role).length + 1;
  const id = `${role === 'border-gateway' ? 'bgw' : role === 'super-spine' ? 'ss' : role}${n}`;
  return lab.device(id) ? `${id}-${lab.devices.length}` : id;
}

export function App() {
  const labRef = useRef<Lab | null>(null);
  if (!labRef.current) labRef.current = loadInitial();
  const lab = labRef.current;
  const sessions = useRef(new Map<string, Session>());
  const [rev, setRev] = useState(0);
  const [selected, setSelected] = useState<string>(lab.devices[0]?.id ?? '');
  const [selectedLink, setSelectedLink] = useState<string | null>(null);
  const [linkFrom, setLinkFrom] = useState<string | null>(null);
  const [linkTo, setLinkTo] = useState<string | null>(null);
  const [aIntf, setAIntf] = useState('');
  const [bIntf, setBIntf] = useState('');
  const [tab, setTab] = useState<Tab>('topology');
  const [placeRole, setPlaceRole] = useState<Role | null>(null);
  const [view, setView] = useState<CanvasView>({ x: 0, y: 0, scale: 1 });
  const viewRef = useRef(view);
  viewRef.current = view;
  const drag = useRef<{ id: string; dx: number; dy: number } | null>(null);
  const panDrag = useRef<{ last: Vec; pointerId: number } | null>(null);
  const pinch = useRef<{ start: CanvasView; startDist: number; startMid: Vec } | null>(null);
  const pointers = useRef(new Map<number, Vec>());
  const moved = useRef(false);
  const longTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  const persist = useCallback(() => {
    localStorage.setItem(STORE, JSON.stringify(lab.toJSON()));
  }, [lab]);

  const bump = useCallback(() => {
    persist();
    setRev((n) => n + 1);
  }, [persist]);

  useEffect(() => {
    if (window.matchMedia('(max-width: 767px)').matches) setView(fitContent(lab.devices));
  }, [lab]);

  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === 'hidden') persist();
    };
    document.addEventListener('visibilitychange', onHide);
    const vv = window.visualViewport;
    const onVv = () => {
      if (!vv) return;
      const inset = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
      document.documentElement.style.setProperty('--kb', `${inset}px`);
    };
    vv?.addEventListener('resize', onVv);
    vv?.addEventListener('scroll', onVv);
    return () => {
      document.removeEventListener('visibilitychange', onHide);
      vv?.removeEventListener('resize', onVv);
      vv?.removeEventListener('scroll', onVv);
    };
  }, [persist]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Delete' && e.key !== 'Backspace') return;
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (selectedLink) {
        lab.removeLink(selectedLink);
        setSelectedLink(null);
        lab.converge(16);
        bump();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [bump, lab, selectedLink]);

  const replaceLab = (next: Lab) => {
    next.converge(56);
    labRef.current = next;
    sessions.current.clear();
    setSelected(next.devices.find((d) => d.role === 'leaf')?.id ?? next.devices[0]?.id ?? '');
    setSelectedLink(null);
    setLinkFrom(null);
    setPlaceRole(null);
    localStorage.setItem(STORE, JSON.stringify(next.toJSON()));
    setRev((n) => n + 1);
  };

  const svgPoint = (e: React.PointerEvent): Vec => {
    const svg = svgRef.current!;
    const pt = svg.createSVGPoint();
    pt.x = e.clientX;
    pt.y = e.clientY;
    const ctm = svg.getScreenCTM();
    if (!ctm) return { x: 0, y: 0 };
    const p = pt.matrixTransform(ctm.inverse());
    return { x: p.x, y: p.y };
  };

  const world = (e: React.PointerEvent): Vec => worldPoint(svgPoint(e), viewRef.current);

  const clearLong = () => {
    if (longTimer.current) {
      clearTimeout(longTimer.current);
      longTimer.current = null;
    }
  };

  const spawn = (role: Role, at?: Vec) => {
    const unique = newDeviceId(lab, role);
    lab.addDevice({
      id: unique,
      role,
      x: at?.x ?? 80 + (lab.devices.length % 6) * 40,
      y: at?.y ?? 80 + (lab.devices.length % 4) * 30,
    });
    if (role === 'host') {
      const dev = lab.device(unique)!;
      const n = lab.devices.filter((d) => d.role === 'host').length;
      dev.host = { mac: dev.systemMac, ip: `10.10.10.${20 + n}`, prefix: 24, vlan: 10, gateway: '10.10.10.1' };
    }
    setSelected(unique);
    setPlaceRole(null);
    bump();
  };

  const onDeviceDown = (e: React.PointerEvent, id: string) => {
    e.stopPropagation();
    if (e.pointerType === 'touch') e.preventDefault();
    setSelected(id);
    setSelectedLink(null);
    moved.current = false;
    if (linkFrom && linkFrom !== id) {
      const a = lab.device(linkFrom);
      const b = lab.device(id);
      if (a && b) {
        setAIntf(nextIntf(lab, a));
        setBIntf(nextIntf(lab, b));
        setLinkTo(id);
      }
      return;
    }
    const dev = lab.device(id)!;
    const p = world(e);
    drag.current = { id, dx: p.x - dev.x, dy: p.y - dev.y };
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    clearLong();
    longTimer.current = setTimeout(() => {
      setLinkFrom(id);
      setLinkTo(null);
      drag.current = null;
      longTimer.current = null;
    }, 550);
  };

  const onCanvasDown = (e: React.PointerEvent) => {
    if (e.target !== svgRef.current && (e.target as Element).tagName !== 'svg') {
      const hit = (e.target as Element).closest?.('[data-device]');
      if (hit) return;
    }
    const p = svgPoint(e);
    pointers.current.set(e.pointerId, p);
    if (pointers.current.size === 2) {
      const pts = [...pointers.current.values()];
      pinch.current = {
        start: viewRef.current,
        startDist: distance(pts[0], pts[1]),
        startMid: midpoint(pts[0], pts[1]),
      };
      panDrag.current = null;
      drag.current = null;
      return;
    }
    panDrag.current = e.pointerType === 'touch' ? { last: p, pointerId: e.pointerId } : null;
    moved.current = false;
  };

  const onCanvasMove = (e: React.PointerEvent) => {
    if (pointers.current.has(e.pointerId)) pointers.current.set(e.pointerId, svgPoint(e));
    if (pointers.current.size >= 2 && pinch.current) {
      const pts = [...pointers.current.values()];
      const mid = midpoint(pts[0], pts[1]);
      const dist = distance(pts[0], pts[1]);
      setView(viewAfterPinch(pinch.current.start, pinch.current.startMid, mid, pinch.current.startDist, dist));
      moved.current = true;
      clearLong();
      return;
    }
    if (drag.current) {
      const dev = lab.device(drag.current.id);
      if (!dev) return;
      const p = world(e);
      const nx = Math.max(8, p.x - drag.current.dx);
      const ny = Math.max(8, p.y - drag.current.dy);
      if (Math.hypot(nx - dev.x, ny - dev.y) > 4) {
        moved.current = true;
        clearLong();
      }
      dev.x = nx;
      dev.y = ny;
      setRev((n) => n + 1);
      return;
    }
    if (panDrag.current && panDrag.current.pointerId === e.pointerId) {
      const p = svgPoint(e);
      const dx = p.x - panDrag.current.last.x;
      const dy = p.y - panDrag.current.last.y;
      if (Math.hypot(dx, dy) > 3) moved.current = true;
      panDrag.current.last = p;
      setView((v) => ({ ...v, x: v.x + dx, y: v.y + dy }));
    }
  };

  const onCanvasUp = (e: React.PointerEvent) => {
    const wasNode = !!drag.current;
    const didMove = moved.current;
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) pinch.current = null;
    if (panDrag.current?.pointerId === e.pointerId) panDrag.current = null;
    clearLong();
    if (drag.current) {
      drag.current = null;
      if (didMove) bump();
    }
    if (!wasNode && !didMove && placeRole && pointers.current.size === 0) {
      spawn(placeRole, world(e));
    }
  };

  const commitLink = () => {
    if (!linkFrom || !linkTo) return;
    lab.addLink(linkFrom, aIntf, linkTo, bIntf);
    setLinkFrom(null);
    setLinkTo(null);
    lab.converge(24);
    bump();
  };

  const exportJson = () => {
    const blob = new Blob([JSON.stringify(lab.toJSON(), null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${lab.name.replace(/\s+/g, '-').toLowerCase()}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const importJson = (file: File) => {
    file.text().then((text) => {
      const parsed = JSON.parse(text) as TopologyFile;
      replaceLab(Lab.fromJSON(parsed));
    });
  };

  const selectedDev = lab.device(selected);
  const established = useMemo(() => {
    void rev;
    return lab.devices.reduce((n, d) => n + d.op.bgpPeers.filter((p) => p.state === 'Established').length, 0);
  }, [lab, rev]);
  const peerTotal = useMemo(() => {
    void rev;
    return lab.devices.reduce((n, d) => n + d.op.bgpPeers.length, 0);
  }, [lab, rev]);

  return (
    <div className="app" data-tab={tab} data-testid="app">
      <header className="topbar">
        <div className="brand">
          <strong>NX-OS EVPN Lab</strong>
          <span>BGP EVPN / VXLAN fabric simulator · NX-OS 10.x syntax</span>
        </div>
        <div className="stats">
          {lab.name} · tick <b>{lab.tick}</b> · BGP <b>{established}/{peerTotal}</b> Established
        </div>
      </header>
      <aside className="side" data-testid="devices-pane">
        <h2>Examples</h2>
        {EXAMPLES.map((ex) => (
          <button key={ex.id} className="btn" data-testid={`example-${ex.id}`} onClick={() => replaceLab(ex.build())}>
            {ex.name}
            <small>{ex.blurb}</small>
          </button>
        ))}
        <h2>Add device</h2>
        {ROLES.map((role) => (
          <button key={role} className="btn" onClick={() => spawn(role)}>
            <span style={{ color: ROLE_COLOR[role] }}>{role}</span>
          </button>
        ))}
        <h2>Topology</h2>
        <button className={`btn ${linkFrom ? 'active' : ''}`} data-testid="link-mode" onClick={() => { setLinkFrom(selected || null); setLinkTo(null); }}>
          {linkFrom ? `Link from ${linkFrom}… click the other device` : 'Draw link from selected device'}
        </button>
        <div className="row">
          <button className="btn" onClick={() => { lab.converge(56); bump(); }}>Converge</button>
          <button className="btn" onClick={() => { lab.step(); bump(); }}>Step</button>
        </div>
        <div className="row">
          <button className="btn" onClick={exportJson}>Export</button>
          <label className="btn" style={{ textAlign: 'center' }}>
            Import
            <input
              type="file"
              accept="application/json"
              hidden
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) importJson(f);
                e.target.value = '';
              }}
            />
          </label>
        </div>
        <button
          className="btn"
          onClick={() => {
            localStorage.removeItem(STORE);
            replaceLab(EXAMPLES[0].build());
          }}
        >
          Reset saved lab
        </button>
        {selectedDev?.host && (
          <div className="host-form">
            <h2>Host {selectedDev.config.hostname}</h2>
            <label>MAC</label>
            <input value={selectedDev.host.mac} onChange={(e) => { selectedDev.host!.mac = e.target.value; bump(); }} />
            <label>IP</label>
            <input value={selectedDev.host.ip} onChange={(e) => { selectedDev.host!.ip = e.target.value; bump(); }} />
            <label>Prefix</label>
            <input value={String(selectedDev.host.prefix)} onChange={(e) => { selectedDev.host!.prefix = Number(e.target.value) || 24; bump(); }} />
            <label>VLAN</label>
            <input value={String(selectedDev.host.vlan)} onChange={(e) => { selectedDev.host!.vlan = Number(e.target.value) || 1; bump(); }} />
            <label>Gateway</label>
            <input value={selectedDev.host.gateway} onChange={(e) => { selectedDev.host!.gateway = e.target.value; lab.converge(8); bump(); }} />
          </div>
        )}
      </aside>
      <div className="canvas-wrap">
        <div className="mobile-palette" data-testid="add-palette">
          {ROLES.map((role) => (
            <button
              key={role}
              type="button"
              className={placeRole === role ? 'active' : ''}
              data-testid={`add-${role}`}
              onClick={() => setPlaceRole((cur) => (cur === role ? null : role))}
            >
              {role === 'border-gateway' ? 'border' : role === 'super-spine' ? 'super' : role}
            </button>
          ))}
          <button type="button" className={linkFrom ? 'active' : ''} data-testid="link-mode-mobile" onClick={() => { setLinkFrom(selected || null); setLinkTo(null); setTab('topology'); }}>
            Link
          </button>
        </div>
        {placeRole && <p className="place-hint" data-testid="place-hint">Tap the canvas to place a {placeRole}</p>}
        {linkFrom && !linkTo && <p className="place-hint">Link from {linkFrom}. Tap the other device.</p>}
        <svg
          ref={svgRef}
          data-testid="topology-canvas"
          viewBox="0 0 1600 900"
          onPointerDown={onCanvasDown}
          onPointerMove={onCanvasMove}
          onPointerUp={onCanvasUp}
          onPointerCancel={onCanvasUp}
          onClick={() => setSelectedLink(null)}
        >
          <g transform={`translate(${view.x} ${view.y}) scale(${view.scale})`}>
            {lab.links.map((l) => {
              const a = lab.device(l.a.device);
              const b = lab.device(l.b.device);
              if (!a || !b) return null;
              const x1 = a.x + 74;
              const y1 = a.y + 28;
              const x2 = b.x + 74;
              const y2 = b.y + 28;
              const mx = (x1 + x2) / 2;
              const my = (y1 + y2) / 2;
              return (
                <g key={l.id} onClick={(ev) => { ev.stopPropagation(); setSelectedLink(l.id); }}>
                  <line className={selectedLink === l.id ? 'link selected' : 'link'} x1={x1} y1={y1} x2={x2} y2={y2} />
                  <text className="link-label" x={(x1 + mx) / 2} y={(y1 + my) / 2 - 4}>{l.a.intf.replace('Ethernet', 'Eth')}</text>
                  <text className="link-label" x={(x2 + mx) / 2} y={(y2 + my) / 2 - 4}>{l.b.intf.replace('Ethernet', 'Eth')}</text>
                </g>
              );
            })}
            {lab.devices.map((d) => (
              <g
                key={d.id}
                className={selected === d.id ? 'node selected' : 'node'}
                data-testid={`device-${d.id}`}
                data-device={d.id}
                transform={`translate(${d.x} ${d.y})`}
                onPointerDown={(ev) => onDeviceDown(ev, d.id)}
              >
                <rect className="card" width="148" height="56" rx="8" />
                <rect width="6" height="56" rx="3" fill={ROLE_COLOR[d.role]} />
                <text x="16" y="22" fill="#f4f7fb" fontSize="13" fontWeight="650">{d.config.hostname}</text>
                <text x="16" y="40" fill="#9fb0c3" fontSize="11">{bgpCounts(d)}</text>
              </g>
            ))}
          </g>
        </svg>
        {linkFrom && linkTo && (
          <div className="modal-back">
            <div className="modal">
              <h3>Link {linkFrom} — {linkTo}</h3>
              <label>{linkFrom} interface</label>
              <input value={aIntf} onChange={(e) => setAIntf(e.target.value)} />
              <label>{linkTo} interface</label>
              <input value={bIntf} onChange={(e) => setBIntf(e.target.value)} />
              <div className="row" style={{ marginTop: 12 }}>
                <button className="btn" onClick={commitLink}>Create</button>
                <button className="btn" onClick={() => { setLinkFrom(null); setLinkTo(null); }}>Cancel</button>
              </div>
            </div>
          </div>
        )}
      </div>
      <section className="cli-pane" data-testid="cli-pane">
        <div className="cli-head">
          <label className="device-select">
            <span className="sr">Active device</span>
            <select
              data-testid="device-select"
              value={selected}
              onChange={(e) => setSelected(e.target.value)}
            >
              {lab.devices.map((d) => (
                <option key={d.id} value={d.id}>{d.config.hostname}</option>
              ))}
            </select>
          </label>
          <strong className="cli-title">{selectedDev ? selectedDev.config.hostname : 'No device'}</strong>
          <span>{selectedDev ? `${selectedDev.role} · ${selectedDev.systemMac}` : 'Select a device'}</span>
        </div>
        {selectedDev && (
          <DeviceTerminal key={selectedDev.id + ':' + revReset(lab)} lab={lab} deviceId={selectedDev.id} sessions={sessions.current} onChange={bump} />
        )}
      </section>
      <nav className="tabbar" data-testid="tabbar">
        <button type="button" data-testid="tab-topology" className={tab === 'topology' ? 'active' : ''} onClick={() => setTab('topology')}>Topology</button>
        <button type="button" data-testid="tab-cli" className={tab === 'cli' ? 'active' : ''} onClick={() => setTab('cli')}>CLI</button>
        <button type="button" data-testid="tab-devices" className={tab === 'devices' ? 'active' : ''} onClick={() => setTab('devices')}>Devices</button>
      </nav>
    </div>
  );
}

function revReset(lab: Lab): string {
  return lab.name + ':' + lab.devices.map((d) => d.id).join(',');
}
