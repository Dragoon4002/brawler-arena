// Full-screen fight. The Play/Lobby screens store the setup here, then route to #/fight.
import { useEffect, useRef, useState } from 'react';
import { startBotFight, startLocal, startOnline, type HostOpts, type Player } from '../game/session.ts';
import { monsters } from '../store.ts';
import { recordResult } from '../store.ts';
import type { Monster } from '../genes.ts';
import { STAGES, type StageId } from '../stages.ts';
import { getAudio, toggleMute } from '../audio.ts';
import { fmt, useArena, useSignMatch } from '../near.ts';
import { asset, Ico, Portrait, STAGE_ICON } from './ui.tsx';

export type FightSetup =
  | { kind: 'local'; mons: [Monster, Monster]; stage: StageId }
  | { kind: 'host'; mon: Monster; stage: StageId; opts: HostOpts }
  | { kind: 'join'; mon: Monster; code: string; stage: StageId; account: string; matchId: number | null }
  | { kind: 'match'; mon: Monster; stage: StageId; matchId: number; account: string }; // on-chain (tournament) match via relay `match` msg

let setup: FightSetup | null = null;
export const prepareFight = (s: FightSetup) => { setup = s; location.hash = '#/fight'; };

const asPlayer = (m: Monster): Player => ({ name: m.name, dna: m.dna });

// Demo states for #/fight/<state>?demo : waiting | fight | victory | defeat | void
const demoSetup = (): FightSetup => ({ kind: 'host', mon: monsters()[0], stage: 'ember', opts: { pub: true, view: true, bettable: true, matchId: 99, stake: '500000000000000000000000', account: '' } });

export function Arena({ demo }: { demo?: string }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const arena = useArena();
  const sign = useSignMatch();
  const [status, setStatus] = useState('');
  const [live, setLive] = useState(false);
  const [room, setRoom] = useState<{ code: string; matchId: number | null; bettable: boolean; seat: number } | null>(null);
  const [over, setOver] = useState<{ winner: number | null; reason: string; seat: number } | null>(null);
  const [claimMsg, setClaimMsg] = useState('');
  const [settled, setSettled] = useState(false);
  const [muted, setMuted] = useState(getAudio().muted);
  const s = demo ? demoSetup() : setup;

  useEffect(() => {
    if (!s) { location.hash = '#/play'; return; }
    if (demo && s.kind === 'host') {
      setRoom({ code: 'DEMO', matchId: 99, bettable: true, seat: 0 });
      if (demo === 'waiting') return;
      setLive(true); setSettled(true);
      if (demo !== 'fight') setOver({ winner: demo === 'void' ? null : demo === 'victory' ? 0 : 1, reason: demo === 'void' ? 'both left' : 'ko', seat: 0 });
      const g = startBotFight(canvas.current!, [asPlayer(s.mon), asPlayer(monsters()[1] ?? s.mon)], s.stage);
      return () => g.stop();
    }
    let seat = -1;
    const back = (e: KeyboardEvent) => {
      if (e.code === 'Escape') location.hash = '#/play';
      if (e.code === 'KeyM') setMuted(toggleMute().muted);
    };
    addEventListener('keydown', back);
    const hooks = {
      status: setStatus,
      room: (r: { code: string; matchId: number | null; bettable: boolean; seat: number }) => { seat = r.seat; setRoom(r); },
      started: () => setLive(true),
      over: (winner: number | null, reason: string) => setTimeout(() => setOver({ winner, reason, seat }), reason === 'ko' ? 1800 : 0),
      result: (winner: number, kos: number[], st: number) => {
        if (s.kind === 'local') s.mons.forEach((m, i) => recordResult(m.id, winner === i, kos[i], s.mons[1 - i].name, 'local'));
        else recordResult(s.mon.id, winner === st, kos[st], 'online rival', 'online');
      },
    };
    const game = s.kind === 'local'
      ? startLocal(canvas.current!, [asPlayer(s.mons[0]), asPlayer(s.mons[1])], s.stage, hooks)
      : startOnline(canvas.current!, s.kind === 'host' ? { t: 'host', ...s.opts } : s.kind === 'match' ? { t: 'match', matchId: s.matchId, account: s.account } : { t: 'join', code: s.code, account: s.account, matchId: s.matchId }, asPlayer(s.mon), s.stage, hooks, sign);
    return () => { removeEventListener('keydown', back); game.stop(); };
  }, []);

  const cancel = async () => {
    if (room?.matchId != null && s?.kind === 'host') {
      try { await arena.cancelMatch(room.matchId); } catch { /* user closed wallet; stake can still be reclaimed later */ }
    }
    location.hash = '#/play';
  };
  useEffect(() => { // wait for the referee's on-chain result before offering the claim
    if (!over || room?.matchId == null) return;
    const t = setInterval(async () => {
      const m = await arena.getMatch(room.matchId!).catch(() => null);
      if (m && (m.status === 'settled' || m.status === 'refund')) { setSettled(true); clearInterval(t); }
    }, 2000);
    return () => clearInterval(t);
  }, [over, room?.matchId]);
  const claim = async () => {
    if (room?.matchId == null) return;
    setClaimMsg('Claiming…');
    try { await arena.claim(room.matchId); setClaimMsg('Sent to your wallet.'); }
    catch (e) { setClaimMsg((e as Error).message.slice(0, 120)); }
  };

  const hostOpts = s?.kind === 'host' ? s.opts : null;
  return (
    <div className="arena">
      <canvas ref={canvas} aria-label="Fight arena" />
      <button type="button" className="chip sound-toggle row-ico" aria-pressed={muted} onClick={() => setMuted(toggleMute().muted)}>
        <Ico n={muted ? 'icon-sound-off' : 'icon-sound-on'} />{muted ? 'Sound off (M)' : 'Sound on (M)'}
      </button>

      {!live && !over && s && s.kind !== 'local' && (
        <div className="arena-overlay">
          <div className="slab waiting" role="status">
            {room ? (
              <>
                <img className="title-img" src={asset('title-ready')} alt="Waiting room" />
                <div className="versus">
                  <div><Portrait dna={s.mon.dna} size={150} /><b>{s.mon.name}</b></div>
                  <span className="vs">vs</span>
                  <div className="ghost-slot" aria-label="Opponent not joined yet"><span>?</span><b>Waiting…</b></div>
                </div>
                <p className="sub">Room code</p>
                <div className="code">{room.code}</div>
                <div className="row" style={{ justifyContent: 'center' }}>
                  <span className="chip row-ico"><Ico n={hostOpts?.pub ? 'icon-room-public' : 'icon-room-private'} />{hostOpts?.pub ? 'Public' : 'Private'}</span>
                  {room.bettable && <span className="chip gold row-ico"><Ico n="icon-bet" />Open for bets</span>}
                  {hostOpts && hostOpts.stake !== '0' && <span className="chip row-ico"><Ico n="coin" />Stake {fmt(hostOpts.stake)} NEAR</span>}
                  <span className="chip row-ico"><Ico n={STAGE_ICON[s.stage]} />{STAGES[s.stage].name}</span>
                </div>
                <p className="note">{hostOpts?.pub ? 'Listed in the lobby. ' : 'Share the code with your opponent. '}The fight starts when they join.</p>
              </>
            ) : <p>{status || 'Loading…'}</p>}
            <button className="btn ghost" onClick={cancel}><span><Ico n="icon-back" />{room?.matchId != null && s.kind === 'host' ? 'Cancel and refund' : 'Back'}</span></button>
          </div>
        </div>
      )}

      {over && (
        <div className="arena-overlay">
          <div className="slab waiting" role="status">
            <img className="title-img" src={asset(over.winner === null ? 'title-void' : over.winner === over.seat ? 'title-victory' : 'title-defeat')} alt={over.winner === null ? 'Match void' : over.winner === over.seat ? 'Victory' : 'Defeat'} />
            <p>{over.winner === null ? `No result (${over.reason}). Stakes and bets are refunded.` : over.reason === 'ko' ? 'Three knockouts.' : `Won by ${over.reason}.`}</p>
            {room?.matchId != null && s?.kind !== 'match' && (over.winner === over.seat || over.winner === null) && (
              <>
                {!settled && <p className="note">Posting the result on-chain…</p>}
                <button className="btn big" disabled={!settled} onClick={claim}><span><Ico n="icon-claim" />{over.winner === null ? 'Claim refund' : 'Claim winnings'}</span></button>
                {claimMsg && <p className="note">{claimMsg}</p>}
              </>
            )}
            <div className="row" style={{ justifyContent: 'center' }}>
              <a className="btn alt" href="#/lobby"><span><Ico n="icon-lobby" />Lobby</span></a>
              <a className="btn ghost" href="#/play"><span><Ico n="icon-refresh" />Play again</span></a>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
