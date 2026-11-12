// Online rooms: create (public/private, bettable, stake), join by code, public lobby, watch + bet.
import { useEffect, useRef, useState } from 'react';
import type { Monster } from '../genes.ts';
import { STAGES, type StageId } from '../stages.ts';
import { betWeightPct, fmt, toYocto, useArena, type BetView, type MatchView } from '../near.ts';
import { startSpectate } from '../game/session.ts';
import { monsters } from '../store.ts';
import { peekRoom, useLobby, type LobbyRoom } from './lobby.ts';
import { prepareFight } from './arena.tsx';
import { Portrait } from './ui.tsx';

type Arena = ReturnType<typeof useArena>;
const errText = (e: unknown) => ((e as Error)?.message ?? String(e)).slice(0, 160);

// Pay the on-chain stake if the room needs it, then go fight.
async function joinRoom(arena: Arena, code: string, mon: Monster, say: (t: string) => void) {
  say('Looking up room…');
  const r = await peekRoom(code);
  if (!r) return say('Room not found.');
  if (r.status !== 'waiting') return say('That fight already started. You can watch it from the lobby.');
  if (r.matchId !== null) {
    if (!arena.ready) return say('Betting contract not configured on this build.');
    if (!arena.account) { say('Connect your NEAR wallet to join a staked or bettable room.'); return arena.signIn(); }
    if (r.players[0]?.account === arena.account) return say('You are the host of that room.');
    say(r.stake === '0' ? 'Confirm the join in your wallet…' : `Confirm the ${fmt(r.stake)} NEAR stake in your wallet…`);
    await arena.joinMatch(r.matchId, r.stake);
  }
  prepareFight({ kind: 'join', mon, code: r.code, stage: r.stage, account: arena.account ?? '' });
}

/* ---------- Play screen: online start ---------- */
export function OnlineStart({ mon, stage }: { mon: Monster; stage: StageId }) {
  const arena = useArena();
  const [pub, setPub] = useState(true);
  const [bettable, setBettable] = useState(false);
  const [view, setView] = useState(true);
  const [stake, setStake] = useState('0');
  const [code, setCode] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const onChain = bettable || Number(stake) > 0;

  const create = async () => {
    setBusy(true); setMsg('');
    try {
      let matchId: number | null = null;
      const stakeY = Number(stake) > 0 ? toYocto(stake) : '0';
      if (onChain) {
        if (!arena.ready) throw new Error('Betting contract not configured on this build.');
        if (!arena.account) { setMsg('Connect your NEAR wallet first.'); await arena.signIn(); return; }
        setMsg('Confirm in your wallet…');
        matchId = await arena.createMatch(bettable, stakeY);
      }
      prepareFight({ kind: 'host', mon, stage, opts: { pub, view: pub || view, bettable, matchId, stake: stakeY, account: arena.account ?? '' } });
    } catch (e) { setMsg(errText(e)); } finally { setBusy(false); }
  };
  const join = async () => {
    setBusy(true);
    try { await joinRoom(arena, code, mon, setMsg); } catch (e) { setMsg(errText(e)); } finally { setBusy(false); }
  };

  return (
    <div className="split">
      <section className="slab" aria-label="Create a room" style={{ display: 'grid', gap: 16 }}>
        <h3>Create a room</h3>
        <div className="row" role="radiogroup" aria-label="Visibility">
          <button type="button" role="radio" aria-checked={pub} className={`chip ${pub ? 'gold' : ''}`} onClick={() => setPub(true)}>Public, listed in lobby</button>
          <button type="button" role="radio" aria-checked={!pub} className={`chip ${!pub ? 'gold' : ''}`} onClick={() => setPub(false)}>Private, code only</button>
        </div>
        {!pub && <label className="toggle"><input type="checkbox" checked={view} onChange={(e) => setView(e.target.checked)} /> Let anyone watch (listed in lobby as watch-only)</label>}
        <label className="toggle"><input type="checkbox" checked={bettable} onChange={(e) => setBettable(e.target.checked)} /> Let spectators bet on this fight</label>
        <label className="row">Your stake
          <input type="number" min="0" step="0.01" value={stake} onChange={(e) => setStake(e.target.value)} aria-label="Stake in NEAR" style={{ width: 130 }} /> NEAR
        </label>
        <p className="note">{onChain ? 'Your opponent matches the stake. Winner takes both, minus 0.1%. Needs a wallet signature.' : 'Friendly match, nothing on-chain.'}</p>
        <button className="btn big" disabled={busy} onClick={create}><span>{onChain ? 'Create and stake' : 'Create room'}</span></button>
      </section>
      <section className="slab" aria-label="Join a room" style={{ display: 'grid', gap: 16, alignContent: 'start' }}>
        <h3>Join by code</h3>
        <input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="Room code" maxLength={4} aria-label="Room code" />
        <button className="btn alt" disabled={busy || code.length !== 4} onClick={join}><span>Join</span></button>
        <a className="btn ghost" href="#/lobby"><span>Browse public lobby</span></a>
        {msg && <p className="note" role="status">{msg}</p>}
      </section>
    </div>
  );
}

/* ---------- Lobby ---------- */
function RoomCard({ r, onJoin }: { r: LobbyRoom; onJoin: () => void }) {
  const [a, b] = r.players;
  return (
    <article className="tile room-card">
      <div className="room-vs">
        <div><Portrait dna={a.dna} size={110} /><b>{a.name}</b></div>
        <span className="vs">vs</span>
        {b ? <div><Portrait dna={b.dna} size={110} flip /><b>{b.name}</b></div> : <div className="ghost-slot small"><span>?</span><b>Open seat</b></div>}
      </div>
      <div className="row">
        <span className={`chip ${r.status === 'live' ? 'gold' : ''}`}>{r.status === 'live' ? 'Live' : 'Waiting'}</span>
        {!r.pub && <span className="chip">Private, watch only</span>}
        <span className="chip">{STAGES[r.stage].name}</span>
        {r.stake !== '0' && <span className="chip">Stake {fmt(r.stake)} NEAR</span>}
        {r.bettable && <span className="chip">Bets open</span>}
        {r.watchers > 0 && <span className="chip">{r.watchers} watching</span>}
      </div>
      <div className="row">
        {r.status === 'waiting' && r.pub && <button className="btn" onClick={onJoin}><span>Join fight</span></button>}
        <a className="btn alt" href={`#/watch/${r.code}`}><span>{r.bettable ? 'Watch and bet' : 'Watch'}</span></a>
      </div>
    </article>
  );
}

export function Lobby() {
  const { rooms, err } = useLobby();
  const arena = useArena();
  const [msg, setMsg] = useState('');
  const mon = monsters()[0];
  const join = (code: string) => joinRoom(arena, code, mon, setMsg).catch((e) => setMsg(errText(e)));
  const live = rooms?.filter((r) => r.status === 'live') ?? [];
  const open = rooms?.filter((r) => r.status === 'waiting') ?? [];
  return (
    <>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <div><h1>Lobby</h1><p className="sub">Join an open seat with {mon.name}, or watch any fight for free and back a side.</p></div>
        <a className="btn" href="#/play"><span>Create a room</span></a>
      </div>
      {msg && <p className="note" role="status">{msg}</p>}
      {err && <p className="note">{err}</p>}
      {rooms === null ? <p>Connecting to the arena…</p> : rooms.length === 0 ? (
        <section className="slab"><h3>No public rooms right now</h3><p className="sub">Create one and it shows up here for everyone.</p></section>
      ) : (
        <>
          {live.length > 0 && <><h2>Live now</h2><div className="grid rooms">{live.map((r) => <RoomCard key={r.code} r={r} onJoin={() => join(r.code)} />)}</div></>}
          {open.length > 0 && <><h2>Open seats</h2><div className="grid rooms">{open.map((r) => <RoomCard key={r.code} r={r} onJoin={() => join(r.code)} />)}</div></>}
        </>
      )}
    </>
  );
}

/* ---------- Watch + bet ---------- */
export function Watch({ code }: { code: string }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const arena = useArena();
  const [spec, setSpec] = useState<any>(null);
  const [status, setStatus] = useState('Connecting…');
  const [over, setOver] = useState<{ winner: number | null; reason: string } | null>(null);
  const [match, setMatch] = useState<MatchView | null>(null);
  const [bet, setBet] = useState<BetView | null>(null);
  const [side, setSide] = useState(0);
  const [amount, setAmount] = useState('0.1');
  const [msg, setMsg] = useState('');
  const dlg = useRef<HTMLDialogElement>(null);
  const asked = useRef(false);

  useEffect(() => {
    const game = startSpectate(canvas.current!, code, { status: setStatus, info: setSpec, started: () => setStatus(''), over: (w, r) => setOver({ winner: w, reason: r }) });
    return () => game.stop();
  }, [code]);

  // Poll pool + my bet from the contract.
  const matchId: number | null = spec?.matchId ?? null;
  useEffect(() => {
    if (matchId === null || !arena.ready) return;
    let dead = false;
    const poll = async () => {
      try {
        const m = await arena.getMatch(matchId);
        if (!dead) setMatch(m);
        if (arena.account && !dead) setBet(await arena.getBet(matchId, arena.account));
      } catch { /* RPC hiccup; next poll */ }
    };
    poll();
    const t = setInterval(poll, 2500);
    return () => { dead = true; clearInterval(t); };
  }, [matchId, arena.account]);

  const players: { name: string; account: string }[] = spec?.players ?? [];
  const mine = !!arena.account && players.some((p) => p.account === arena.account);
  const canBet = spec?.bettable && match?.status === 'live' && !over && !mine;
  const pool = match ? match.pool.map((p) => BigInt(p)) : [0n, 0n];
  const total = pool[0] + pool[1];
  const share = (i: number) => (total ? Number((pool[i] * 1000n) / total) / 10 : 50);

  useEffect(() => { // pop the bet dialog once, as soon as betting is possible
    if (canBet && !asked.current) { asked.current = true; dlg.current?.showModal(); }
  }, [canBet]);

  const place = async () => {
    setMsg('');
    if (!arena.account) { await arena.signIn(); return; }
    if (bet && bet.side !== side) return setMsg('You already backed the other side.');
    try { setMsg('Confirm in your wallet…'); await arena.placeBet(matchId!, side, toYocto(amount)); setMsg('Bet placed.'); }
    catch (e) { setMsg(errText(e)); }
  };
  const claim = async () => {
    try { setMsg('Claiming…'); await arena.claim(matchId!); setMsg('Sent to your wallet.'); } catch (e) { setMsg(errText(e)); }
  };

  return (
    <div className="arena">
      <canvas ref={canvas} aria-label="Fight arena" />
      {status && <div className="arena-overlay"><div className="slab" role="status"><p>{status}</p><a className="btn ghost" href="#/lobby"><span>Back to lobby</span></a></div></div>}
      <a className="chip watch-back" href="#/lobby">Lobby</a>
      <dialog ref={dlg} className="slab bet-dialog" aria-label="Place a bet">
        <form method="dialog" style={{ display: 'grid', gap: 14 }} onSubmit={(e) => { e.preventDefault(); place().then(() => dlg.current?.close()); }}>
          <h2>Back a fighter</h2>
          <p className="sub">Watching is free. Bet on who wins; winners split the other side's pool.</p>
          <div className="dialog-pick" role="radiogroup" aria-label="Fighter">
            {[0, 1].map((i) => (
              <button key={i} type="button" role="radio" aria-checked={side === i} className="tile" aria-pressed={side === i} onClick={() => setSide(i)}>
                {spec && <Portrait dna={spec.players[i]?.dna ?? spec.players[0].dna} size={110} flip={i === 1} />}
                <b>{players[i]?.name ?? '?'}</b>
                <span className="tile-meta">{fmt(pool[i])} NEAR backed</span>
              </button>
            ))}
          </div>
          <label className="row">Amount <input type="number" min="0.01" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} style={{ width: 130 }} aria-label="Bet in NEAR" /> NEAR</label>
          <p className="note">Bets placed now count at {betWeightPct(match?.kos ?? 0)}% weight ({match?.kos ?? 0} KOs so far). Fee 0.1%.</p>
          <div className="row">
            <button type="submit" className="btn big" disabled={!canBet}><span>{arena.account ? 'Place bet' : 'Connect wallet'}</span></button>
            <button type="button" className="btn ghost" onClick={() => dlg.current?.close()}><span>Just watch</span></button>
          </div>
          {msg && <p className="note" role="status">{msg}</p>}
        </form>
      </dialog>
      {spec && (
        <aside className="slab bet-panel" aria-label="Betting">
          <h3>{players[0]?.name ?? '?'} vs {players[1]?.name ?? '?'}</h3>
          {!spec.bettable ? <p className="note">Betting is off for this fight.</p> : mine ? <p className="note">You are fighting in this match, so its bets are hidden from you.</p> : (
            <>
              <div className="pool-bar" role="img" aria-label={`Pool split ${share(0)} to ${share(1)} percent`}>
                <span style={{ width: `${share(0)}%` }} />
              </div>
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <span>{players[0]?.name}: {fmt(pool[0])} NEAR</span><span>{players[1]?.name}: {fmt(pool[1])} NEAR</span>
              </div>
              {canBet && <button className="btn" onClick={() => dlg.current?.showModal()}><span>Place a bet</span></button>}
              {bet && <p>Your bet: {fmt(bet.amount)} NEAR on {players[bet.side]?.name}{bet.claimed ? ', claimed' : ''}</p>}
              {bet && !bet.claimed && (match?.status === 'settled' || match?.status === 'refund') && (
                <button className="btn big" onClick={claim}><span>{match.status === 'refund' ? 'Claim refund' : 'Claim winnings'}</span></button>
              )}
              {over && match?.status === 'live' && <p className="note">Waiting for the referee to post the result on-chain…</p>}
            </>
          )}
          {over && <p><b>{over.winner === null ? 'Match void, bets refunded.' : `${players[over.winner]?.name} wins${over.reason === 'ko' ? '' : ` by ${over.reason}`}.`}</b></p>}
          {msg && <p className="note" role="status">{msg}</p>}
        </aside>
      )}
    </div>
  );
}

/* ---------- Account: claimable winnings ---------- */
export function Claims() {
  const arena = useArena();
  const [rows, setRows] = useState<{ m: MatchView; amt: string; act: 'claim' | 'cancel' | 'expire' }[] | null>(null);
  const [msg, setMsg] = useState('');
  const load = async () => {
    if (!arena.ready || !arena.account) return setRows([]);
    try {
      const list = await arena.listMatches(0, 50);
      const out = [];
      const me = arena.account, stale = (ms: number) => Date.now() - ms > 2 * 3600_000;
      for (const m of list) {
        if (m.status === 'open' && m.host === me) out.push({ m, amt: m.stake, act: 'cancel' as const });
        else if (m.status === 'live' && stale(m.started_ms) && (m.host === me || m.guest === me || await arena.getBet(m.id, me))) out.push({ m, amt: '0', act: 'expire' as const });
        else if (m.status === 'settled' || m.status === 'refund') {
          const amt = await arena.claimable(m.id, me);
          if (BigInt(amt) > 0n) out.push({ m, amt, act: 'claim' as const });
        }
      }
      setRows(out);
    } catch (e) { setMsg(errText(e)); setRows([]); }
  };
  useEffect(() => { load(); }, [arena.account]);
  if (!arena.account) return null;
  return (
    <section className="slab">
      <h2>Winnings and stakes</h2>
      {rows === null ? <p className="sub">Checking the arena contract…</p> : rows.length === 0 ? <p className="sub">Nothing to claim right now.</p> : (
        <ul style={{ listStyle: 'none', padding: 0, margin: '12px 0 0', display: 'grid', gap: 8 }}>
          {rows.map(({ m, amt, act }) => (
            <li key={m.id} className="row" style={{ justifyContent: 'space-between' }}>
              <span>Match #{m.id}: {act === 'expire' ? 'no result after 2 h, release for refund' : act === 'cancel' ? `unjoined room, ${fmt(amt)} NEAR stake` : `${fmt(amt)} NEAR${m.status === 'refund' ? ' refund' : ''}`}</span>
              <button className="btn" onClick={async () => {
                try { await (act === 'cancel' ? arena.cancelMatch(m.id) : act === 'expire' ? arena.expire(m.id) : arena.claim(m.id)); load(); }
                catch (e) { setMsg(errText(e)); }
              }}><span>{act === 'cancel' ? 'Cancel and refund' : act === 'expire' ? 'Release' : 'Claim'}</span></button>
            </li>
          ))}
        </ul>
      )}
      {msg && <p className="note">{msg}</p>}
    </section>
  );
}
