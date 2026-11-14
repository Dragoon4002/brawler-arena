import { useEffect, useRef, useState } from 'react';
import { lookOf } from '@/lib/genes.ts';
import { DEMO, DEMO_ROOMS, demoSettle } from '@/lib/demo.ts';
import { fmt, slip, toYocto, useArena, type FeedItem, type Limits, type LotView, type MatchView, type PositionView } from '@/lib/near.ts';
import { startBotFight, startSpectate } from '@/lib/session.ts';
import { errText, signed } from '@/lib/format.ts';
import { asset, Ico, Portrait } from '@/components/ui.tsx';
import { PriceChart } from './PriceChart.tsx';

type Player = { name: string; account: string; dna: any };

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
    const hooks = { status: setStatus, info: setSpec, started: () => { setStatus(''); setOver(null); }, over: (w: number | null, r: string) => setOver({ winner: w, reason: r }) };
    const demoRoom = DEMO && (DEMO_ROOMS.find((r) => r.code === code) ?? DEMO_ROOMS[0]);
    if (demoRoom) setSpec({ ...demoRoom, status: 'live' });
    const game = demoRoom ? startBotFight(canvas.current!, demoRoom.players.map((p) => ({ ...p })), demoRoom.stage, { ...hooks, result: (w: number) => hooks.over(w, 'ko') })
      : startSpectate(canvas.current!, code, hooks);
    return () => game.stop();
  }, [code]);

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
