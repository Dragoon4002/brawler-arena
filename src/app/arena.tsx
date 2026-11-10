// Full-screen fight. The Play screen stores the setup here, then routes to #/fight.
import { useEffect, useRef, useState } from 'react';
import { startLocal, startOnline, type Player } from '../game/session.ts';
import { recordResult } from '../store.ts';
import type { Monster } from '../genes.ts';
import type { StageId } from '../stages.ts';
import { getAudio, toggleMute } from '../audio.ts';

export type FightSetup =
  | { kind: 'local'; mons: [Monster, Monster]; stage: StageId }
  | { kind: 'host'; mon: Monster; stage: StageId }
  | { kind: 'join'; mon: Monster; code: string; stage: StageId };

let setup: FightSetup | null = null;
export const prepareFight = (s: FightSetup) => { setup = s; location.hash = '#/fight'; };

const asPlayer = (m: Monster): Player => ({ name: m.name, dna: m.dna });

export function Arena() {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [status, setStatus] = useState('');
  const [live, setLive] = useState(false);
  const [muted, setMuted] = useState(getAudio().muted);

  useEffect(() => {
    const s = setup;
    if (!s) { location.hash = '#/play'; return; }
    const back = (e: KeyboardEvent) => {
      if (e.code === 'Escape') location.hash = '#/play';
      if (e.code === 'KeyM') setMuted(toggleMute().muted);
    };
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
      ? startLocal(canvas.current!, [asPlayer(s.mons[0]), asPlayer(s.mons[1])], s.stage, hooks)
      : startOnline(canvas.current!, s.kind === 'host' ? { t: 'host' } : { t: 'join', code: s.code }, asPlayer(s.mon), s.stage, hooks);
    return () => { removeEventListener('keydown', back); game.stop(); };
  }, []);

  const code = status.match(/Room ([A-Z]{4})/)?.[1];
  return (
    <div className="arena">
      <canvas ref={canvas} />
      <button type="button" className="chip sound-toggle" aria-pressed={muted} onClick={() => setMuted(toggleMute().muted)}>
        {muted ? 'Sound off (M)' : 'Sound on (M)'}
      </button>
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
