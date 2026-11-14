import { useEffect, useRef, useState } from 'react';
import type { Monster } from '@/lib/genes.ts';
import { STAGES, type StageId } from '@/lib/stages.ts';
import { getAudio, toggleMute } from '@/lib/audio.ts';
import { DEMO_ROOMS, demoChat } from '@/lib/demo.ts';
import { useArena, useSignMatch } from '@/lib/near.ts';
import { startBotFight, startOnline, type ChatLine, type HostOpts, type Player, type RoomState } from '@/lib/session.ts';
import { monsters, recordResult } from '@/lib/store.ts';
import { usePlayable } from '@/hooks/useMons.ts';
import { asset, Ico } from '@/components/ui.tsx';
import { RoomLobby } from '@/components/rooms/RoomLobby.tsx';
import { go } from '@/lib/nav.ts';

export type FightSetup =
  | { kind: 'host'; mon: Monster; stage: StageId; opts: HostOpts }
  | { kind: 'join'; mon: Monster; code: string; stage: StageId; account: string; matchId: number | null }
  | { kind: 'match'; mon: Monster; stage: StageId; matchId: number; account: string }; // on-chain (tournament) match via relay `match` msg

let setup: FightSetup | null = null;
export const prepareFight = (s: FightSetup) => { setup = s; go('/fight'); };

const asPlayer = (m: Monster): Player => ({ name: m.name, dna: m.dna });

// Demo states for /fight/<state>?demo : waiting (host lobby) | challenger (guest lobby) | fight | victory | defeat | void
const DEMO_STAGE = (new URLSearchParams(location.search).get('stage') ?? 'ember') as StageId; // ?demo&stage=grove
const demoSetup = (): FightSetup => ({ kind: 'host', mon: monsters()[0], stage: DEMO_STAGE in STAGES ? DEMO_STAGE : 'ember', opts: { pub: true, view: true, bettable: true, matchId: 99, stake: '500000000000000000000000', account: '' } });
const demoRoom = (mon: Monster, seat: number): RoomState => {
  const me = { name: mon.name, dna: mon.dna, account: 'demo-player.testnet', connected: true }, rival = { ...DEMO_ROOMS[2].players[0], connected: true };
  return { code: 'DEMO', status: 'waiting', stage: 'ember', stake: '500000000000000000000000', matchId: 99, bettable: true, pub: true, view: true, seats: seat ? [rival, me] : [me, rival], spectators: 3 };
};

// Re-hosting from the end screen keeps the /fight path, so bump a key to remount (the fight effect is mount-only).
export function Arena({ demo }: { demo?: string }) {
  const [n, setN] = useState(0);
  return <Fight key={n} demo={demo} again={() => setN((x) => x + 1)} />;
}

const typing = (t: EventTarget | null) => t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));

function Fight({ demo, again }: { demo?: string; again: () => void }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const arena = useArena();
  const sign = useSignMatch();
  const [status, setStatus] = useState('');
  const [live, setLive] = useState(false);
  const [room, setRoom] = useState<{ code: string; matchId: number | null; bettable: boolean; seat: number } | null>(null);
  const [names, setNames] = useState<string[]>([]);
  const [over, setOver] = useState<{ winner: number | null; reason: string; seat: number } | null>(null);
  const [claimMsg, setClaimMsg] = useState('');
  const [settled, setSettled] = useState(false);
  const [muted, setMuted] = useState(getAudio().muted);
  const [rs, setRs] = useState<RoomState | null>(null);
  const [chat, setChat] = useState<ChatLine[]>([]);
  const [closed, setClosed] = useState(''); // room closed before the fight
  const { free, local } = usePlayable();
  // rematch: asked = we pressed R, wants = opponent did, gone = opponent/socket gone (R hosts a new room)
  const [rm, setRm] = useState({ asked: false, wants: false, gone: false });
  const onR = useRef<(() => void) | null>(null);
  const ctl = useRef<ReturnType<typeof startOnline> | null>(null);
  const bots = useRef<{ stop(): void } | null>(null);
  const [s] = useState(() => (demo ? demoSetup() : setup));
  const [mine, setMine] = useState(s?.mon);

  useEffect(() => {
    if (!s) { go('/play'); return; }
    if (demo && s.kind === 'host') {
      const seat = demo === 'challenger' ? 1 : 0;
      setRoom({ code: 'DEMO', matchId: 99, bettable: true, seat });
      if (demo === 'waiting' || demo === 'challenger') {
        const r = demoRoom(s.mon, seat);
        setRs(r); setChat(demoChat(r.seats[0].name, r.seats[1].name));
        return () => bots.current?.stop();
      }
      setLive(true); setSettled(true);
      if (demo !== 'fight') setOver({ winner: demo === 'void' ? null : demo === 'victory' ? 0 : 1, reason: demo === 'void' ? 'both left' : 'ko', seat: 0 });
      const players = [asPlayer(s.mon), asPlayer(monsters()[1] ?? s.mon)];
      setNames(players.map((p) => p.name));
      const g = startBotFight(canvas.current!, players, s.stage);
      return () => g.stop();
    }
    let seat = -1;
    const back = (e: KeyboardEvent) => {
      if (typing(e.target)) return;
      if (e.code === 'Escape') go('/lobby');
      if (e.code === 'KeyM') setMuted(toggleMute().muted);
      if (e.code === 'KeyR') onR.current?.();
    };
    addEventListener('keydown', back);
    const hooks = {
      status: setStatus,
      room: (r: { code: string; matchId: number | null; bettable: boolean; seat: number }) => { seat = r.seat; setRoom(r); },
      started: (players: Player[]) => { setNames(players.map((p) => p.name)); setLive(true); setOver(null); setRm((x) => ({ ...x, asked: false, wants: false })); },
      rematch: () => setRm((x) => ({ ...x, wants: true })),
      left: () => setRm((x) => ({ ...x, gone: true })),
      gone: setClosed,
      roomstate: setRs,
      chat: (l: ChatLine) => setChat((c) => [...c, l].slice(-200)),
      chatlog: setChat,
      over: (winner: number | null, reason: string) => setTimeout(() => setOver({ winner, reason, seat }), reason === 'ko' ? 1000 : 0),
      result: (winner: number, kos: number[], st: number) => recordResult(monRef.current.id, winner === st, kos[st], 'online rival', 'online'),
    };
    const game = startOnline(canvas.current!, s.kind === 'host' ? { t: 'host', ...s.opts } : s.kind === 'match' ? { t: 'match', matchId: s.matchId, account: s.account } : { t: 'join', code: s.code, account: s.account, matchId: s.matchId }, asPlayer(s.mon), s.stage, hooks, sign);
    ctl.current = game;
    return () => { removeEventListener('keydown', back); game.stop(); };
  }, []);

  const monRef = useRef(s?.mon as Monster);
  monRef.current = mine ?? monRef.current;
  useEffect(() => { if (closed) { const t = setTimeout(() => { go('/lobby'); }, 4000); return () => clearTimeout(t); } }, [closed]);

  const cancel = async () => {
    if (room?.matchId != null && s?.kind === 'host' && !rs?.seats[1]) {
      try { await arena.cancelMatch(room.matchId); } catch { /* user closed wallet; stake can still be reclaimed later */ }
    }
    go('/lobby');
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

  // Room lobby actions. Demo has no server, so it applies them locally (and Start runs a bot fight).
  const patch = (p: Partial<RoomState>) => setRs((r) => (r ? { ...r, ...p } : r));
  const pickMon = (m: Monster) => {
    setMine(m); ctl.current?.set({ name: m.name, dna: m.dna });
    if (room) setRs((r) => r && { ...r, seats: r.seats.map((x, i) => (i === room.seat ? { ...x, name: m.name, dna: m.dna } : x)) });
  };
  const pickStage = (stage: StageId) => { ctl.current?.set({ stage }); patch({ stage }); };
  const say = (text: string) => {
    if (ctl.current) ctl.current.chat(text);
    else setChat((c) => [...c, { from: mine?.name ?? 'You', seat: room?.seat ?? 0, text, ts: Date.now() }]);
  };
  const start = () => {
    if (ctl.current) return ctl.current.begin();
    if (!rs) return;
    setLive(true);
    bots.current = startBotFight(canvas.current!, rs.seats.map((x) => ({ name: x.name, dna: x.dna })), rs.stage);
  };
  const hostOpts = s?.kind === 'host' ? s.opts : null;
  const lobbyRs: RoomState | null = rs ?? (room && s ? { // until the server's first roomstate
    code: room.code, status: 'waiting', stage: s.stage, stake: hostOpts?.stake ?? '0', matchId: room.matchId, bettable: room.bettable,
    pub: !!hostOpts?.pub, view: true, seats: room.seat ? [] : [{ name: s.mon.name, dna: s.mon.dna, account: '', connected: true }], spectators: 0,
  } : null);
  // Staked rooms lock the on-chain monster from create/join; only casual browser monsters can swap in.
  const locked = room?.matchId != null && !!s && 'owner' in s.mon;
  const options = room?.matchId != null ? local : [...free, ...local];
  const canRematch = !!over && !!s && room?.matchId == null; // staked/on-chain: stakes need a new on-chain match
  const gone = rm.gone || over?.reason === 'opponent left' || over?.reason === 'no-show';
  const rematch = () => {
    if (!canRematch || !s) return;
    if (gone) {
      prepareFight(s.kind === 'host' ? s : { kind: 'host', mon: s.mon, stage: s.stage, opts: { pub: true, view: true, bettable: false, matchId: null, stake: '0', account: s.account } });
      return again();
    }
    if (rm.asked) return;
    ctl.current?.rematch();
    setRm((x) => ({ ...x, asked: true }));
  };
  onR.current = rematch;
  return (
    <div className="arena">
      <canvas ref={canvas} aria-label="Fight arena" />
      <button type="button" className="chip sound-toggle row-ico" aria-pressed={muted} onClick={() => setMuted(toggleMute().muted)}>
        <Ico n={muted ? 'icon-sound-off' : 'icon-sound-on'} />{muted ? 'Sound off (M)' : 'Sound on (M)'}
      </button>

      {!live && !over && s && mine && (closed ? (
        <div className="arena-overlay">
          <div className="slab" role="alert"><p>{closed} Back to the lobby…</p><a className="btn" href="/lobby"><span><Ico n="icon-lobby" />Lobby now</span></a></div>
        </div>
      ) : room && lobbyRs ? (
        <RoomLobby rs={lobbyRs} seat={room.seat} mine={mine} options={options} locked={locked} status={status} chat={chat}
          leaveLabel={room.matchId != null && s.kind === 'host' && !lobbyRs.seats[1] ? 'Cancel and refund' : 'Leave'}
          onPick={pickMon} onStage={pickStage} onStart={start} onChat={say} onLeave={cancel} />
      ) : (
        <div className="arena-overlay">
          <div className="slab" role="status"><p>{status || 'Loading…'}</p><button className="btn ghost" onClick={cancel}><span><Ico n="icon-back" />Back</span></button></div>
        </div>
      ))}

      {over && (
        <div className="arena-overlay">
          <div className="slab waiting" role="status">
            <img className="title-img" src={asset(over.winner === null ? 'title-void' : over.winner === over.seat ? 'title-victory' : 'title-defeat')} alt={over.winner === null ? 'Match void' : over.winner === over.seat ? 'Victory' : 'Defeat'} />
            <p>{over.winner === null ? `No result (${over.reason}). Stakes and bets are refunded.` : <><b>{names[over.winner] ?? 'Winner'}</b> wins {over.reason === 'ko' ? 'by three knockouts' : `by ${over.reason}`}.</>}</p>
            {room?.matchId != null && s?.kind !== 'match' && (over.winner === over.seat || over.winner === null) && (
              <>
                {!settled && <p className="note">Posting the result on-chain…</p>}
                <button className="btn big" disabled={!settled} onClick={claim}><span><Ico n="icon-claim" />{over.winner === null ? 'Claim refund' : 'Claim winnings'}</span></button>
                {claimMsg && <p className="note">{claimMsg}</p>}
              </>
            )}
            {canRematch && !gone && rm.wants && !rm.asked && <p className="note">Opponent wants a rematch — press R</p>}
            <div className="row" style={{ justifyContent: 'center' }}>
              {canRematch && (
                <button className="btn" disabled={rm.asked && !gone} onClick={rematch}>
                  <span><Ico n="icon-refresh" />{gone ? 'New room (R)' : rm.asked ? 'Waiting for opponent… (R)' : 'Rematch (R)'}</span>
                </button>
              )}
              <a className="btn alt" href="/lobby"><span><Ico n="icon-lobby" />Back to lobby (Esc)</span></a>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
