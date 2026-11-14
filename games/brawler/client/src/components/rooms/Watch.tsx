import { useEffect, useRef, useState } from 'react';
import { lookOf } from '@/lib/genes.ts';
import { DEMO, DEMO_ROOMS, demoChat, demoSettle } from '@/lib/demo.ts';
import { fmt, slip, toYocto, useArena, type FeedItem, type Limits, type LotView, type MatchView, type PositionView } from '@/lib/near.ts';
import { startBotFight, startSpectate, type ChatLine, type RoomState } from '@/lib/session.ts';
import { errText, signed } from '@/lib/format.ts';
import { asset, Ico, Portrait } from '@/components/ui.tsx';
import { Chat } from './Chat.tsx';
import { PriceChart } from './PriceChart.tsx';

type Player = { name: string; account: string; dna: any };

const col = (p?: Player) => (p?.dna ? lookOf(p.dna).body : 'var(--ember)'); // fighter's HUD colour
const tint = (p?: Player) => ({ '--c': col(p) } as React.CSSProperties);

export function Watch({ code }: { code: string }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const arena = useArena();
  const [spec, setSpec] = useState<any>(null);
  const [rs, setRs] = useState<RoomState | null>(null);
  const [chat, setChat] = useState<ChatLine[]>([]);
  const send = useRef<(t: string) => void>(() => {});
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
  const [msg, setMsg] = useState('');
  const [side, setSide] = useState(0);
  const [amount, setAmount] = useState('0.1');
  const [quote, setQuote] = useState<string | null>(null);
  const [pops, setPops] = useState<FeedItem[]>([]); // new bets, shown over the fight for a few seconds
  const seen = useRef<number | null>(null); // newest feed id already shown (null until first poll, so old bets don't flood in)

  useEffect(() => {
    const hooks = {
      status: setStatus, info: setSpec, started: () => { setStatus(''); setOver(null); }, over: (w: number | null, r: string) => setOver({ winner: w, reason: r }),
      roomstate: setRs, chatlog: setChat, chat: (l: ChatLine) => setChat((c) => [...c, l].slice(-200)),
    };
    const demoRoom = DEMO && (DEMO_ROOMS.find((r) => r.code === code) ?? DEMO_ROOMS[0]);
    if (demoRoom) {
      const players = [...demoRoom.players, DEMO_ROOMS[0].players[1]].slice(0, 2).map((p) => ({ ...p }));
      setSpec({ ...demoRoom, players, status: 'live' }); setChat(demoChat(players[0].name, players[1].name));
      send.current = (text) => setChat((c) => [...c, { from: arena.account ?? 'Spectator', seat: -1, text, ts: Date.now() }]);
      const g = startBotFight(canvas.current!, players, demoRoom.stage, { ...hooks, result: (w: number) => hooks.over(w, 'ko') });
      return () => g.stop();
    }
    const g = startSpectate(canvas.current!, code, hooks, arena.account);
    send.current = g.chat;
    return () => g.stop();
  }, [code]);

  const matchId: number | null = spec?.matchId ?? rs?.matchId ?? null;
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

  // roomstate may know the challenger before the spec does (waiting rooms)
  const players: Player[] = (rs?.seats.length ?? 0) > (spec?.players?.length ?? 0) ? rs!.seats : spec?.players ?? [];
  const name = (i?: number) => (i === undefined ? '' : players[i]?.name ?? '?');
  const mine = !!arena.account && players.some((p) => p.account === arena.account);
  const bettable = !!(spec?.bettable ?? rs?.bettable);
  const canTrade = bettable && match?.status === 'live' && !over && !mine;
  const bps = match?.price_bps ?? 5000, p0 = bps / 1e4;
  const series = hist.length ? hist.map(([, b]) => b / 1e4) : [0.5];
  if (match?.status === 'live') series.push(p0); // extend the line to now
  const shares = (pos?.shares ?? ['0', '0']).map((s) => BigInt(s));
  const cost = pos ? BigInt(pos.paid) : 0n; // in the market (after fees), locked until the result
  const settledW = match?.status === 'settled' ? match.winner : null;
  const value = settledW !== null ? shares[settledW] // final: winning shares pay 1 NEAR each
    : match?.status === 'refund' ? (cost > 0n ? cost : 0n)
    : (shares[0] * BigInt(bps) + shares[1] * BigInt(10000 - bps)) / 10000n; // marked at the current price

  const yocto = (a: string) => { try { const y = BigInt(toYocto(a.trim())); return y > 0n ? y : null; } catch { return null; } };
  useEffect(() => { // live quote for the bet window
    const y = yocto(amount);
    if (matchId === null || !canTrade || !y) return setQuote(null);
    let dead = false;
    const t = setTimeout(() => arena.quoteBuy(matchId, side, y.toString()).then((q) => !dead && setQuote(q), () => !dead && setQuote(null)), 250);
    return () => { dead = true; clearTimeout(t); };
  }, [matchId, side, amount, canTrade, bps]);

  // mirrors contract `buy` checks so wallet opens only for landable trade
  const trade = async () => {
    if (!arena.account) { setMsg('Connect your wallet, then trade.'); return arena.signIn(); }
    const y = yocto(amount);
    if (!y) return setMsg('Enter an amount in NEAR, like 0.5.');
    if (limits && y < BigInt(limits.min_bet)) return setMsg(`Minimum trade is ${fmt(limits.min_bet)} NEAR.`);
    if (limits && y > BigInt(limits.max_bet)) return setMsg(`Maximum trade is ${fmt(limits.max_bet)} NEAR.`);
    try {
      const q = await arena.quoteBuy(matchId!, side, y.toString());
      setMsg(`Confirm in your wallet: ≈${fmt(q)} ${name(side)} shares.`);
      await arena.buy(matchId!, side, y.toString(), slip(q), { card: side, dir: 'long' });
      setMsg(`Bought ${fmt(q)} ${name(side)} shares.`); setTick((t) => t + 1);
    } catch (e) { setMsg(errText(e)); }
  };
  const claim = async () => {
    try { setMsg('Claiming…'); await arena.claim(matchId!); setMsg('Added to your balance.'); setTick((t) => t + 1); } catch (e) { setMsg(errText(e)); }
  };

  const market = bettable && matchId !== null;
  const note = !spec && !rs ? null : !market ? 'Betting needs a staked room with spectator bets on. This one is chat only.'
    : mine ? 'You are fighting in this match, so its market is hidden from you.' : !arena.ready ? 'Betting contract not configured on this build.' : null;
  const verb = (f: FeedItem) => f.kind === 'buy' ? `backed ${name(f.side)}` : f.kind === 'payout' ? 'collected winnings' : 'got a refund';
  const who = (f: FeedItem) => (f.who === arena.account ? 'You' : f.who.replace(/\.testnet$/, ''));
  const pct = [Math.round(p0 * 100), 100 - Math.round(p0 * 100)];
  const colors = { '--c0': col(players[0]), '--c1': col(players[1]) } as React.CSSProperties;

  return (
    <div className="watch" style={colors}>
      <header className="watch-top">
        <a className="btn ghost watch-back" href="/lobby"><span><Ico n="icon-back" />Lobby</span></a>
        <div className="wwin" aria-label="Who will win?">
          <h1>Who will win?</h1>
          <div className="wwin-row">
            {[0, 1].map((i) => (
              <div key={i} className={`wwin-side s${i}`} style={tint(players[i])}>
                <span className="wwin-pic">{players[i]?.dna && <Portrait dna={players[i].dna} size={64} flip={i === 1} />}</span>
                <b>{players[i]?.name ?? 'Open seat'}</b>
                {market && <span className="wwin-pct">{pct[i]}%</span>}
              </div>
            ))}
            {market
              ? <div className="odds-bar" role="img" aria-label={`Market odds: ${name(0)} ${pct[0]}%, ${name(1)} ${pct[1]}%`}><span style={{ width: `${pct[0]}%` }} /></div>
              : <span className="wwin-vs" aria-hidden="true">VS</span>}
          </div>
        </div>
        <div className="watch-chips">
          {spec?.status === 'live' && !over && <img className="tag-img" src={asset('tag-live')} alt="Live" />}
          {(rs?.spectators ?? spec?.watchers ?? 0) > 0 && <span className="chip row-ico"><Ico n="icon-watch" />{rs?.spectators ?? spec?.watchers} watching</span>}
        </div>
      </header>

      <main className="watch-stage">
        <div className="watch-canvas"><canvas ref={canvas} aria-label="Fight arena" /></div>
        {[0, 1].map((s) => pops.some((f) => (f.side ?? 0) === s) && ( // new bets pop up over the fight, on the backed fighter's side
          <ul key={s} className={`bet-pops ${s ? 'right' : 'left'}`} aria-live="polite" aria-label="New bets">
            {pops.filter((f) => (f.side ?? 0) === s).map((f) => (
              <li key={f.id} className="bet-pop" style={tint(f.side === undefined ? undefined : players[f.side])}><b>{who(f)}</b> {verb(f)} <b>{fmt(f.near)} NEAR</b></li>
            ))}
          </ul>
        ))}
        {status && <div className="watch-status" role="status"><p>{status}</p></div>}
      </main>

      <aside className="watch-side">
        {note ? <section className="slab bet"><h3 className="row-ico"><Ico n="icon-bet" />Betting</h3><p className="note">{note}</p></section> : spec && (
          <section className="slab bet" aria-label="Place a bet">
            <h3 className="row-ico"><Ico n="icon-bet" />Place a bet</h3>
            <fieldset className="side-pick" disabled={!canTrade}>
              <legend className="note">Back a fighter</legend>
              {[0, 1].map((i) => (
                <label key={i} style={tint(players[i])}>
                  <input type="radio" name="side" checked={side === i} onChange={() => setSide(i)} />
                  <b>{name(i)}</b><span>{pct[i]}¢</span>
                </label>
              ))}
            </fieldset>
            <label className="bet-amt"><span>Amount</span><input type="number" min="0.01" step="0.01" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} disabled={!canTrade} /><b>NEAR</b></label>
            <p className="note bet-quote" aria-live="polite">{quote ? <>≈ <b>{fmt(quote)}</b> shares · pays <b>{fmt(quote)} NEAR</b> if {name(side)} wins</> : canTrade ? 'Enter an amount to see the quote.' : over ? 'Betting closed.' : 'Market opens when the fight goes live.'}</p>
            <button type="button" className="btn" disabled={!canTrade} onClick={trade}><span><Ico n="coin" />Buy {name(side)}</span></button>
            {msg && <p className="note" role="status">{msg}</p>}
            <PriceChart pts={series} />
            <p className="note">{fmt(match?.collateral)} NEAR in pool · {match?.kos ?? 0} KO{match?.kos === 1 ? '' : 's'} · winning shares pay 1 NEAR each.</p>
            {over && <b>{over.winner === null ? 'Match void, positions refunded.' : `${name(over.winner)} wins${over.reason === 'ko' ? '' : ` by ${over.reason}`}.`}</b>}
            {over && match?.status === 'live' && <p className="note">Waiting for the referee to post the result on-chain…</p>}
            {due > 0n && <button className="btn big" onClick={claim}><span><Ico n="icon-claim" />Claim {fmt(due)} NEAR</span></button>}
            {DEMO && !over && ( // demo bots rarely finish a fight; end it here to see settlement and payouts
              <span className="row demo-end">End fight:
                {[0, 1, null].map((w) => <button key={String(w)} className="chip" onClick={() => setOver({ winner: w, reason: 'ko' })}>{w === null ? 'Void' : `${name(w)} wins`}</button>)}
              </span>
            )}
            {lots.length > 0 && (
              <div className="bet-pos" aria-label="Your position">
                <h4>Your bets</h4>
                {lots.map((l) => {
                  const sh = BigInt(l.shares), paid = BigInt(l.cost);
                  return (
                    <div key={l.id} className="bet-pos-row" style={tint(players[l.card])}>
                      <b>{name(l.card)}</b>
                      <span>{fmt(paid)} in · {fmt(sh)} shares</span>
                      {settledW === null ? <span>pays {fmt(sh)}</span> : settledW === l.side ? <b className="pnl-up">Won {fmt(sh)}</b> : <b className="pnl-down">Lost</b>}
                    </div>
                  );
                })}
                {pos && <span>Total: in {fmt(cost > 0n ? cost : 0n)} · {match?.status === 'live' ? 'worth' : 'final'} {fmt(value)} · <b className={value - cost >= 0n ? 'pnl-up' : 'pnl-down'}>{signed(value - cost)} NEAR</b></span>}
              </div>
            )}
          </section>
        )}
        <Chat lines={chat} onSend={(t) => send.current(t)} />
      </aside>
    </div>
  );
}
