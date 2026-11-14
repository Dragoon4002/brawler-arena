// Online rooms: create (public/private, bettable, stake), join by code, public lobby, watch + trade fighter shares.
import { useEffect, useRef, useState } from 'react';
import { lookOf, type Monster } from '../genes.ts';
import { STAGES, type StageId } from '../stages.ts';
import { fmt, slip, toYocto, useArena, type FeedItem, type Limits, type LotView, type MatchView, type PositionView } from '../near.ts';
import { startBotFight, startSpectate } from '../game/session.ts';
import { DEMO, DEMO_ROOMS, demoSettle } from '../demo.ts';
import { monsters } from '../store.ts';
import { peekRoom, useLobby, type LobbyRoom } from './lobby.ts';
import { prepareFight } from './arena.tsx';
import { asset, Ico, Portrait, STAGE_ICON } from './ui.tsx';

type Arena = ReturnType<typeof useArena>;
const errText = (e: unknown) => ((e as Error)?.message ?? String(e)).slice(0, 160);

// Pay the on-chain stake if the room needs it, then go fight.
// On-chain monsters (NftMonster has `owner`) are locked in the match; local demo-store monsters aren't.
export const BUSY = 'Monster busy or unavailable. Stake refunded.';
export const chainId = (m: Monster) => ('owner' in m ? m.id : undefined);

async function joinRoom(arena: Arena, code: string, mon: Monster, say: (t: string) => void) {
  say('Looking up room…');
  const r = await peekRoom(code);
  if (!r) return say('Room not found.');
  if (r.status !== 'waiting') return say('That fight already started. You can watch it from the lobby.');
  if (r.matchId !== null) {
    if (!arena.ready) return say('Betting contract not configured on this build.');
    if (!arena.account) { say('Connect your NEAR wallet to join a staked or bettable room.'); return arena.signIn(); }
    if (r.players[0]?.account === arena.account) return say('You are the host of that room.');
    say(r.stake === '0' ? 'Confirm the join in your wallet…' : `Confirm in your wallet: ${fmt(r.stake)} NEAR stake from your balance…`);
    if ((await arena.joinMatch(r.matchId, r.stake, chainId(mon))) !== true && !DEMO) return say(BUSY); // demo returns null
  }
  prepareFight({ kind: 'join', mon, code: r.code, stage: r.stage, account: arena.account ?? '', matchId: r.matchId });
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
        matchId = await arena.createMatch(bettable, stakeY, chainId(mon));
        if (typeof matchId !== 'number' || !Number.isInteger(matchId)) { setMsg(BUSY); return; }
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
        <h3 className="row-ico"><Ico n="icon-room-public" />Create a room</h3>
        <div className="row" role="radiogroup" aria-label="Visibility">
          <button type="button" role="radio" aria-checked={pub} className={`chip row-ico ${pub ? 'gold' : ''}`} onClick={() => setPub(true)}><Ico n="icon-room-public" />Public, listed in lobby</button>
          <button type="button" role="radio" aria-checked={!pub} className={`chip row-ico ${!pub ? 'gold' : ''}`} onClick={() => setPub(false)}><Ico n="icon-room-private" />Private, code only</button>
        </div>
        {!pub && <label className="toggle"><input type="checkbox" checked={view} onChange={(e) => setView(e.target.checked)} /> Let anyone watch (listed in lobby as watch-only)</label>}
        <label className="toggle"><input type="checkbox" checked={bettable} onChange={(e) => setBettable(e.target.checked)} /> Let spectators bet on this fight</label>
        <label className="row"><Ico n="coin-stack" />Your stake
          <input type="number" min="0" step="0.01" value={stake} onChange={(e) => setStake(e.target.value)} aria-label="Stake in NEAR" style={{ width: 130 }} /> NEAR
        </label>
        <p className="note">{onChain ? 'Your opponent matches the stake. Winner takes both, minus 0.1%. Needs a wallet signature.' : 'Friendly match, nothing on-chain.'}</p>
        <button className="btn big" disabled={busy} onClick={create}><span><Ico n={onChain ? 'coin' : 'icon-check'} />{onChain ? 'Create and stake' : 'Create room'}</span></button>
      </section>
      <section className="slab" aria-label="Join a room" style={{ display: 'grid', gap: 16, alignContent: 'start' }}>
        <h3 className="row-ico"><Ico n="icon-room-private" />Join by code</h3>
        <input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="Room code" maxLength={4} aria-label="Room code" />
        <button className="btn alt" disabled={busy || code.length !== 4} onClick={join}><span><Ico n="icon-check" />Join</span></button>
        <a className="btn ghost" href="#/lobby"><span><Ico n="icon-lobby" />Browse public lobby</span></a>
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
        {r.status === 'live' ? <img className="tag-img" src={asset('tag-live')} alt="Live" /> : <span className="chip row-ico"><Ico n="icon-timer" />Waiting</span>}
        {!r.pub && <span className="chip row-ico"><Ico n="icon-lock" />Private, watch only</span>}
        <span className="chip row-ico"><Ico n={STAGE_ICON[r.stage]} />{STAGES[r.stage].name}</span>
        {r.stake !== '0' && <span className="chip row-ico"><Ico n="coin" />Stake {fmt(r.stake)} NEAR</span>}
        {r.bettable && <span className="chip row-ico"><Ico n="icon-bet" />Bets open</span>}
        {r.watchers > 0 && <span className="chip row-ico"><Ico n="icon-watch" />{r.watchers} watching</span>}
      </div>
      <div className="row">
        {r.status === 'waiting' && r.pub && <button className="btn" onClick={onJoin}><span><Ico n="icon-play" />Join fight</span></button>}
        <a className="btn alt" href={`#/watch/${r.code}`}><span><Ico n={r.bettable ? 'icon-bet' : 'icon-watch'} />{r.bettable ? 'Watch and bet' : 'Watch'}</span></a>
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
        <div><h1 className="row-ico"><Ico n="icon-lobby" className="ico h" />Lobby</h1><p className="sub">Join an open seat with {mon.name}, or watch any fight for free and back a side.</p></div>
        <a className="btn" href="#/play"><span><Ico n="icon-room-public" />Create a room</span></a>
      </div>
      {msg && <p className="note" role="status">{msg}</p>}
      {err && <p className="note">{err}</p>}
      {rooms === null ? <p>Connecting to the arena…</p> : rooms.length === 0 ? (
        <section className="slab"><h3>No public rooms right now</h3><p className="sub">Create one and it shows up here for everyone.</p></section>
      ) : (
        <>
          {live.length > 0 && <><h2 className="row-ico"><Ico n="icon-live" />Live now</h2><div className="grid rooms">{live.map((r) => <RoomCard key={r.code} r={r} onJoin={() => join(r.code)} />)}</div></>}
          {open.length > 0 && <><h2 className="row-ico"><Ico n="icon-room-public" />Open seats</h2><div className="grid rooms">{open.map((r) => <RoomCard key={r.code} r={r} onJoin={() => join(r.code)} />)}</div></>}
        </>
      )}
    </>
  );
}

/* ---------- Watch + trade ---------- */
type Player = { name: string; account: string; dna: any };
const signed = (y: bigint) => `${y >= 0n ? '+' : '−'}${fmt(y >= 0n ? y : -y)}`;

// Fighter's price over time (0..1). Centre line = even odds; green above, red below.
export function PriceChart({ pts }: { pts: number[] }) {
  const W = 300, H = 150, p = pts.length > 1 ? pts : [pts[0] ?? 0.5, pts[0] ?? 0.5];
  const dev = Math.max(0.05, ...p.map((v) => Math.abs(v - 0.5)));
  const x = (i: number) => (i / (p.length - 1)) * W, y = (v: number) => H / 2 - ((v - 0.5) / dev) * (H / 2 - 8);
  let up = '', down = '';
  for (let i = 1; i < p.length; i++) {
    const [a, b] = [p[i - 1], p[i]];
    const seg = (x0: number, v0: number, x1: number, v1: number) => {
      const d = `M${x0.toFixed(1)} ${y(v0).toFixed(1)}L${x1.toFixed(1)} ${y(v1).toFixed(1)}`;
      if (v0 + v1 >= 1) up += d; else down += d;
    };
    if ((a - 0.5) * (b - 0.5) < 0) { // crosses even: split so each half gets its colour
      const t = (0.5 - a) / (b - a), xm = x(i - 1) + t * (x(i) - x(i - 1));
      seg(x(i - 1), a, xm, 0.5); seg(xm, 0.5, x(i), b);
    } else seg(x(i - 1), a, x(i), b);
  }
  return (
    <svg className="perp-chart" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label={`Price now ${Math.round(p[p.length - 1] * 100)}%`}>
      <line x1="0" y1={H / 2} x2={W} y2={H / 2} className="even" />
      <path d={up} className="up" /><path d={down} className="down" />
    </svg>
  );
}

const col = (p?: Player) => (p?.dna ? lookOf(p.dna).body : 'var(--ember)'); // fighter's HUD colour
const tint = (p?: Player) => ({ '--c': col(p) } as React.CSSProperties);

// One chart for both fighters: the line is fighter 0's odds; above even it's their colour, below it's the rival's.
function MarketCard({ players, p0, pts, trade, canTrade, msg }: {
  players: Player[]; p0: number; pts: number[]; trade: (side: number, amount: string, card: number) => void; canTrade: boolean; msg: string;
}) {
  const [amount, setAmount] = useState('0.1');
  const style = { '--c0': col(players[0]), '--c1': col(players[1]) } as React.CSSProperties;
  return (
    <article className="perp-card perp-one" style={style} aria-label="Fight market">
      <header className="perp-vs">
        {[0, 1].map((i) => (
          <div key={i} className={`perp-side s${i}`} style={tint(players[i])}>
            <span className="perp-pic">{players[i]?.dna && <Portrait dna={players[i].dna} size={72} flip={i === 1} />}</span>
            <div className="perp-who"><h2>{players[i]?.name ?? '?'}</h2><span title={players[i]?.account}>{players[i]?.account || 'no wallet'}</span></div>
            <b className="perp-odds">{Math.round((i ? 1 - p0 : p0) * 100)}%</b>
          </div>
        ))}
      </header>
      <div className="perp-chart-wrap">
        <PriceChart pts={pts} />
        <span className="perp-axis top" style={tint(players[0])}>{players[0]?.name} favoured</span>
        <span className="perp-axis bottom" style={tint(players[1])}>{players[1]?.name} favoured</span>
      </div>
      <form className="perp-trade" noValidate onSubmit={(e) => e.preventDefault()}>
        <label className="perp-amt"><input type="number" min="0.01" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} aria-label="Amount in NEAR" /> NEAR</label>
        <button type="button" className="btn" disabled={!canTrade} onClick={() => trade(0, amount, 0)}><span>Back {players[0]?.name}</span></button>
        <button type="button" className="btn alt" disabled={!canTrade} onClick={() => trade(1, amount, 0)}><span>Back {players[1]?.name}</span></button>
      </form>
      <p className="note">Bets lock until the fight ends, then settle automatically: winning shares pay 1 NEAR each.</p>
      {msg && <p className="note" role="status">{msg}</p>}
    </article>
  );
}

export function Watch({ code }: { code: string }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const arena = useArena();
  const [spec, setSpec] = useState<any>(null);
  const [status, setStatus] = useState('Connecting…');
  const [over, setOver] = useState<{ winner: number | null; reason: string } | null>(null);
  const [match, setMatch] = useState<MatchView | null>(null);
  const [pos, setPos] = useState<PositionView | null>(null);
  const [due, setDue] = useState(0n);
  const [hist, setHist] = useState<[number, number][]>([]);
  const [feed, setFeed] = useState<FeedItem[]>([]);
  const [lots, setLots] = useState<LotView[]>([]);
  const [limits, setLimits] = useState<Limits | null>(null);
  const [tick, setTick] = useState(0); // bump to re-poll right away (after a trade)
  const [msg, setMsg] = useState<{ card: number; text: string }>({ card: -1, text: '' });
  const [open, setOpen] = useState(false); // bets overlay over the fight
  const [pops, setPops] = useState<FeedItem[]>([]); // new bets, shown over the fight for a few seconds
  const seen = useRef<number | null>(null); // newest feed id already shown (null until first poll, so old bets don't flood in)

  useEffect(() => {
    const hooks = { status: setStatus, info: setSpec, started: () => setStatus(''), over: (w: number | null, r: string) => setOver({ winner: w, reason: r }) };
    const demoRoom = DEMO && (DEMO_ROOMS.find((r) => r.code === code) ?? DEMO_ROOMS[0]);
    if (demoRoom) setSpec({ ...demoRoom, status: 'live' });
    const game = demoRoom ? startBotFight(canvas.current!, demoRoom.players.map((p) => ({ ...p })), demoRoom.stage, { ...hooks, result: (w: number) => hooks.over(w, 'ko') })
      : startSpectate(canvas.current!, code, hooks);
    return () => game.stop();
  }, [code]);

  // Poll market, price history, bet feed and my position from the contract.
  const matchId: number | null = spec?.matchId ?? null;
  useEffect(() => { if (DEMO && over) demoSettle(matchId, over.winner); }, [over]); // demo: the fight result settles the in-browser market
  useEffect(() => {
    if (matchId === null || !arena.ready) return;
    let dead = false;
    const me = arena.account;
    const poll = async () => {
      try {
        const [m, h, f, p, l, d] = await Promise.all([arena.getMatch(matchId), arena.getPrices(matchId), arena.getFeed(matchId), me ? arena.getPosition(matchId, me) : null,
          me ? arena.getLots(matchId, me) : [], me ? arena.claimable(matchId, me) : '0']);
        if (!dead) { setMatch(m); setHist(h); setFeed(f); setPos(p); setLots(l); setDue(BigInt(d)); }
      } catch { /* RPC hiccup; next poll */ }
    };
    poll();
    const t = setInterval(poll, 2500);
    return () => { dead = true; clearInterval(t); };
  }, [matchId, arena.account, tick, over]);
  useEffect(() => { if (matchId !== null && arena.ready) arena.config().then(setLimits, () => {}); }, [matchId]);
  useEffect(() => {
    if (!feed.length) return;
    const last = seen.current;
    seen.current = Math.max(last ?? -1, ...feed.map((f) => f.id));
    if (last === null) return;
    const fresh = feed.filter((f) => f.id > last).reverse(); // oldest first
    if (!fresh.length) return;
    setPops((p) => [...p, ...fresh].slice(-6));
    fresh.forEach((f) => setTimeout(() => setPops((p) => p.filter((x) => x.id !== f.id)), 4000));
  }, [feed]);

  const players: Player[] = spec?.players ?? [];
  const name = (i?: number) => (i === undefined ? '' : players[i]?.name ?? '?');
  const mine = !!arena.account && players.some((p) => p.account === arena.account);
  const canTrade = !!spec?.bettable && match?.status === 'live' && !over && !mine;
  const bps = match?.price_bps ?? 5000, p0 = bps / 1e4;
  const series = hist.length ? hist.map(([, b]) => b / 1e4) : [0.5];
  if (match?.status === 'live') series.push(p0); // extend the line to now
  const shares = (pos?.shares ?? ['0', '0']).map((s) => BigInt(s));
  const cost = pos ? BigInt(pos.paid) : 0n; // in the market (after fees), locked until the result
  const settledW = match?.status === 'settled' ? match.winner : null;
  const value = settledW !== null ? shares[settledW] // final: winning shares pay 1 NEAR each
    : match?.status === 'refund' ? (cost > 0n ? cost : 0n)
    : (shares[0] * BigInt(bps) + shares[1] * BigInt(10000 - bps)) / 10000n; // marked at the current price
  const say = (card: number, text: string) => setMsg({ card, text });

  // mirrors contract `buy` checks so wallet opens only for landable trade
  const trade = async (side: number, amount: string, card: number) => { // card = the one clicked, for its status line
    if (!arena.account) { say(card, 'Connect your wallet, then trade.'); return arena.signIn(); }
    let y: bigint;
    try { y = BigInt(toYocto(amount.trim())); } catch { return say(card, 'Enter an amount in NEAR, like 0.5.'); }
    if (limits && y < BigInt(limits.min_bet)) return say(card, `Minimum trade is ${fmt(limits.min_bet)} NEAR.`);
    if (limits && y > BigInt(limits.max_bet)) return say(card, `Maximum trade is ${fmt(limits.max_bet)} NEAR.`);
    if (y <= 0n) return say(card, 'Enter an amount above 0.');
    try {
      const q = await arena.quoteBuy(matchId!, side, y.toString());
      say(card, `Confirm in your wallet: ≈${fmt(q)} ${name(side)} shares.`);
      await arena.buy(matchId!, side, y.toString(), slip(q), { card: side, dir: 'long' });
      say(card, `Bought ${fmt(q)} ${name(side)} shares.`); setTick((t) => t + 1);
    } catch (e) { say(card, errText(e)); }
  };
  const label = (l: LotView) => (l.dir === 'long' ? `Backed ${name(l.card)}` : `Short ${name(l.card)}`);
  const claim = async () => {
    try { say(-1, 'Claiming…'); await arena.claim(matchId!); say(-1, 'Added to your balance.'); setTick((t) => t + 1); } catch (e) { say(-1, errText(e)); }
  };

  const note = !spec ? null : !spec.bettable ? 'Betting is off for this fight.' : mine ? 'You are fighting in this match, so its market is hidden from you.'
    : !arena.ready ? 'Betting contract not configured on this build.' : matchId === null ? "This room has no on-chain match, so it can't be traded." : null;
  const verb = (f: FeedItem) => f.kind === 'buy' ? `backed ${name(f.side)}` : f.kind === 'payout' ? 'collected winnings' : 'got a refund';
  const who = (f: FeedItem) => (f.who === arena.account ? 'You' : f.who.replace(/\.testnet$/, ''));
  const held = lots;

  return (
    <div className="arena">
      <canvas ref={canvas} aria-label="Fight arena" />
      <a className="chip watch-back row-ico" href="#/lobby"><Ico n="icon-back" />Lobby</a>
      {[0, 1].map((s) => pops.some((f) => (f.side ?? 0) === s) && ( // new bets pop up over the fight, on the backed fighter's side
        <ul key={s} className={`bet-pops ${s ? 'right' : 'left'}`} aria-live="polite" aria-label="New bets">
          {pops.filter((f) => (f.side ?? 0) === s).map((f) => (
            <li key={f.id} className="bet-pop" style={tint(f.side === undefined ? undefined : players[f.side])}><b>{who(f)}</b> {verb(f)} <b>{fmt(f.near)} NEAR</b></li>
          ))}
        </ul>
      ))}
      {spec && <button className="chip perp-toggle row-ico" aria-expanded={open} aria-controls="bets" onClick={() => setOpen(!open)}><Ico n="icon-bet" />{open ? 'Close bets' : 'Open bets'}</button>}
      {spec && open && (
        <section id="bets" className="perp-frame" aria-label="Fighter markets">
          {note ? <p className="perp-sum note">{note}</p> : (
            <>
              <MarketCard players={players} p0={p0} pts={series} trade={trade} canTrade={canTrade} msg={msg.card === 0 ? msg.text : ''} />
              <div className="perp-sum">
                <div className="perp-stats">
                  <span className="row-ico"><img className="tag-img" src={asset(over ? 'tag-bet-placed' : 'tag-live')} alt={over ? '' : 'Live'} />{fmt(match?.collateral)} NEAR in pool · {match?.kos ?? 0} KO{match?.kos === 1 ? '' : 's'}</span>
                  {over && <b>{over.winner === null ? 'Match void, positions refunded.' : `${name(over.winner)} wins${over.reason === 'ko' ? '' : ` by ${over.reason}`}.`}</b>}
                  {over && match?.status === 'live' && <span className="note">Waiting for the referee to post the result on-chain…</span>}
                  {due > 0n && <button className="btn big" onClick={claim}><span><Ico n="icon-claim" />Claim {fmt(due)} NEAR</span></button>}
                  {msg.card === -1 && msg.text && <span className="note" role="status">{msg.text}</span>}
                  {DEMO && !over && ( // demo bots rarely finish a fight; end it here to see settlement and payouts
                    <span className="row perp-demo-end">End fight:
                      {[0, 1, null].map((w) => <button key={String(w)} className="chip" onClick={() => setOver({ winner: w, reason: 'ko' })}>{w === null ? 'Void' : `${name(w)} wins`}</button>)}
                    </span>
                  )}
                </div>
                <div className="perp-pos" aria-label="Your position">
                  <h3>Your position</h3>
                  {held.length === 0 ? <p className="note">{arena.account ? 'No open position. Go Long or Short above.' : 'Connect your wallet to trade.'}</p> : held.map((l) => {
                    const sh = BigInt(l.shares), paid = BigInt(l.cost), worth = (sh * BigInt(l.side ? 10000 - bps : bps)) / 10000n;
                    const pays = `If ${name(l.card)} ${l.dir === 'long' ? 'wins' : 'loses'}`;
                    return (
                      <div key={l.id} className="perp-pos-row" style={tint(players[l.card])}>
                        <b className="perp-pos-name">{label(l)}</b>
                        <span>{paid > 0n && `${fmt(paid)} NEAR in · `}{fmt(sh)} {name(l.side)} shares{match?.status === 'live' && ` · worth ≈${fmt(worth)}`}</span>
                        {settledW === null ? <span>{pays}: <b>{fmt(sh)} NEAR</b>{paid > 0n && <> <b className={sh - paid >= 0n ? 'pnl-up' : 'pnl-down'}>({signed(sh - paid)})</b></>}</span>
                          : settledW === l.side ? <b className="pnl-up">Won {fmt(sh)} NEAR</b> : <b className="pnl-down">Lost, pays nothing</b>}
                      </div>
                    );
                  })}
                  {pos && <span>Total: in {fmt(cost > 0n ? cost : 0n)} · {match?.status === 'live' ? 'worth' : 'final'} {fmt(value)} · <b className={value - cost >= 0n ? 'pnl-up' : 'pnl-down'}>{signed(value - cost)} NEAR</b></span>}
                </div>
              </div>
            </>
          )}
        </section>
      )}
      {status && <div className="arena-overlay"><div className="slab" role="status"><p>{status}</p><a className="btn ghost" href="#/lobby"><span><Ico n="icon-back" />Back to lobby</span></a></div></div>}
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
        else if (m.status === 'live' && stale(m.started_ms) && (m.host === me || m.guest === me || await arena.getPosition(m.id, me))) out.push({ m, amt: '0', act: 'expire' as const });
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
      <h2 className="row-ico"><Ico n="icon-claim" />Winnings and stakes</h2>
      {rows === null ? <p className="sub">Checking the arena contract…</p> : rows.length === 0 ? <p className="sub">Nothing to claim right now.</p> : (
        <ul style={{ listStyle: 'none', padding: 0, margin: '12px 0 0', display: 'grid', gap: 8 }}>
          {rows.map(({ m, amt, act }) => (
            <li key={m.id} className="row" style={{ justifyContent: 'space-between' }}>
              <span>Match #{m.id}: {act === 'expire' ? 'no result after 2 h, release for refund' : act === 'cancel' ? `unjoined room, ${fmt(amt)} NEAR stake` : `${fmt(amt)} NEAR${m.status === 'refund' ? ' refund' : ''}`}</span>
              <button className="btn" onClick={async () => {
                try { await (act === 'cancel' ? arena.cancelMatch(m.id) : act === 'expire' ? arena.expire(m.id) : arena.claim(m.id)); load(); }
                catch (e) { setMsg(errText(e)); }
              }}><span><Ico n={act === 'claim' ? 'icon-claim' : 'icon-refresh'} />{act === 'cancel' ? 'Cancel and refund' : act === 'expire' ? 'Release' : 'Claim'}</span></button>
            </li>
          ))}
        </ul>
      )}
      {msg && <p className="note">{msg}</p>}
    </section>
  );
}
