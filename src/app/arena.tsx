// Full-screen fight. The Play screen stores the setup here, then routes to #/fight.
import { useEffect, useRef, useState } from 'react';
import { startLocal, startOnline, type Player } from '../game/session.ts';
import { recordResult } from '../store.ts';
import type { Monster } from '../genes.ts';

export type FightSetup =
  | { kind: 'local'; mons: [Monster, Monster] }
  | { kind: 'host'; mon: Monster }
  | { kind: 'join'; mon: Monster; code: string };

let setup: FightSetup | null = null;
export const prepareFight = (s: FightSetup) => { setup = s; location.hash = '#/fight'; };

const asPlayer = (m: Monster): Player => ({ name: m.name, dna: m.dna });

export function Arena() {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [status, setStatus] = useState('');
  const [live, setLive] = useState(false);

  useEffect(() => {
    const s = setup;
    if (!s) { location.hash = '#/play'; return; }
    const back = (e: KeyboardEvent) => { if (e.code === 'Escape') location.hash = '#/play'; };
    addEventListener('keydown', back);
    const hooks = {
      status: setStatus,
      started: () => setLive(true),
      result: (winner: number, kos: number[], seat: number) => {
        if (s.kind === 'local') s.mons.forEach((m, i) => recordResult(m.id, winner === i, kos[i], s.mons[1 - i].name, 'local'));
        else recordResult(s.mon.id, winner === seat, kos[seat], 'online rival', 'online');
      },
    };
    const game = s.kind === 'local'
      ? startLocal(canvas.current!, [asPlayer(s.mons[0]), asPlayer(s.mons[1])], hooks)
      : startOnline(canvas.current!, s.kind === 'host' ? { t: 'host' } : { t: 'join', code: s.code }, asPlayer(s.mon), hooks);
    return () => { removeEventListener('keydown', back); game.stop(); };
  }, []);

  const code = status.match(/Room ([A-Z]{4})/)?.[1];
  return (
    <div className="arena">
      <canvas ref={canvas} />
      {!live && (
        <div className="arena-overlay">
          <div className="slab" role="status">
            {code ? <><p className="sub">Share this room code</p><div className="code">{code}</div><p>Waiting for an opponent to join.</p></> : <p>{status || 'Loading…'}</p>}
            <a className="btn ghost" href="#/play"><span>Back</span></a>
          </div>
        </div>
      )}
    </div>
  );
}
