import { useEffect, useRef, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import { completeLine, execLine, helpFor, newSession, promptOf, type Session } from '../cli/engine';
import type { Lab } from '../sim/lab';

const QUICK = [
  'show bgp l2vpn evpn summary',
  'show nve peers',
  'show mac address-table',
  'show ip route vrf TENANT',
  'show running-config',
];

interface TermApi {
  run: (line: string) => void;
  complete: () => void;
  help: () => void;
  history: (dir: 1 | -1) => void;
  setDraft: (value: string) => void;
}

export function DeviceTerminal({
  lab,
  deviceId,
  sessions,
  onChange,
}: {
  lab: Lab;
  deviceId: string;
  sessions: Map<string, Session>;
  onChange: () => void;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const api = useRef<TermApi | null>(null);
  const [draft, setDraft] = useState('');

  useEffect(() => {
    const el = hostRef.current;
    if (!el) return;
    const dev = lab.device(deviceId);
    if (!dev) return;
    if (!sessions.has(deviceId)) sessions.set(deviceId, newSession());
    const session = sessions.get(deviceId)!;
    const term = new Terminal({
      cursorBlink: true,
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
      fontSize: 12,
      theme: {
        background: '#0b1016',
        foreground: '#d5deE8',
        cursor: '#3dbe7a',
        selectionBackground: '#234056',
      },
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(el);
    fit.fit();
    const ro = new ResizeObserver(() => fit.fit());
    ro.observe(el);

    const prompt = () => promptOf(lab.device(deviceId)?.config.hostname || deviceId, session);
    const writeBlock = (text: string) => {
      if (!text) return;
      for (const line of text.split('\n')) term.writeln(line);
    };

    term.writeln('NX-OS EVPN Lab (simulator) — command syntax modeled on Cisco NX-OS 10.x');
    term.writeln('This is not Cisco software. Type ? for context help.');
    term.writeln('');
    term.write(prompt());

    let buf = '';
    const history: string[] = [];
    let hist = -1;

    const redraw = (next: string) => {
      term.write('\r\x1b[2K' + prompt() + next);
    };

    const run = (line: string) => {
      term.write('\r\n');
      if (line.trim()) {
        history.unshift(line);
        hist = -1;
        const out = execLine(lab, deviceId, line, session);
        writeBlock(out);
        const cmd = line.trim();
        if (!cmd.startsWith('show') && !cmd.startsWith('sh') && !cmd.startsWith('ping') && cmd !== '?' && !cmd.endsWith('?')) {
          lab.converge(24);
        }
        onChange();
      }
      buf = '';
      term.write(prompt());
    };

    api.current = {
      run,
      complete: () => {
        const res = completeLine(session, buf);
        if (res.output) {
          term.write('\r\n');
          writeBlock(res.output);
          term.write(prompt() + buf);
        } else if (res.buffer !== buf) {
          buf = res.buffer;
          redraw(buf);
        }
        setDraft(buf);
      },
      help: () => {
        const help = helpFor(session, buf + '?');
        term.write('?\r\n');
        writeBlock(help);
        term.write(prompt() + buf);
      },
      history: (dir) => {
        if (!history.length) return;
        if (dir > 0) hist = Math.min(history.length - 1, hist + 1);
        else hist = hist <= 0 ? -1 : hist - 1;
        buf = hist < 0 ? '' : (history[hist] ?? '');
        redraw(buf);
        setDraft(buf);
      },
      setDraft: (value) => {
        buf = value;
        redraw(buf);
      },
    };

    const disp = term.onData((data) => {
      if (data === '\r') {
        run(buf);
        return;
      }
      if (data === '\x7f') {
        if (!buf) return;
        buf = buf.slice(0, -1);
        term.write('\b \b');
        return;
      }
      if (data === '\x03') {
        term.write('^C\r\n');
        buf = '';
        term.write(prompt());
        return;
      }
      if (data === '\t') {
        const res = completeLine(session, buf);
        if (res.output) {
          term.write('\r\n');
          writeBlock(res.output);
          term.write(prompt() + buf);
        } else if (res.buffer !== buf) {
          buf = res.buffer;
          redraw(buf);
        }
        return;
      }
      if (data === '?') {
        term.write('?');
        const help = helpFor(session, buf + '?');
        term.write('\r\n');
        writeBlock(help);
        term.write(prompt() + buf);
        return;
      }
      if (data === '\x1b[A') {
        if (!history.length) return;
        hist = Math.min(history.length - 1, hist + 1);
        buf = history[hist] ?? '';
        redraw(buf);
        return;
      }
      if (data === '\x1b[B') {
        if (hist <= 0) {
          hist = -1;
          buf = '';
          redraw('');
          return;
        }
        hist -= 1;
        buf = history[hist] ?? '';
        redraw(buf);
        return;
      }
      if (data >= ' ' && data <= '~') {
        buf += data;
        term.write(data);
      }
    });

    return () => {
      api.current = null;
      disp.dispose();
      ro.disconnect();
      term.dispose();
    };
  }, [deviceId, lab, onChange, sessions]);

  const send = (line: string) => {
    api.current?.run(line);
    setDraft('');
  };

  return (
    <div className="term-shell">
      <div className="term" ref={hostRef} data-testid="terminal" />
      <div className="mobile-cli" data-testid="mobile-cli">
        <div className="chips">
          {QUICK.map((cmd) => (
            <button key={cmd} type="button" className="chip" data-testid={`chip-${cmd.split(' ')[1] ?? 'cmd'}`} onClick={() => send(cmd)}>
              {cmd}
            </button>
          ))}
        </div>
        <form
          className="cmd-row"
          onSubmit={(e) => {
            e.preventDefault();
            send(draft);
          }}
        >
          <button type="button" aria-label="Previous command" onClick={() => api.current?.history(1)}>↑</button>
          <button type="button" aria-label="Next command" onClick={() => api.current?.history(-1)}>↓</button>
          <input
            data-testid="command-input"
            aria-label="Command"
            value={draft}
            enterKeyHint="send"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            onChange={(e) => {
              setDraft(e.target.value);
              api.current?.setDraft(e.target.value);
            }}
          />
          <button type="button" aria-label="Tab complete" data-testid="tab-complete" onClick={() => api.current?.complete()}>Tab</button>
          <button type="button" aria-label="Help" data-testid="help-button" onClick={() => api.current?.help()}>?</button>
          <button type="submit" data-testid="send-command">Send</button>
        </form>
      </div>
    </div>
  );
}
