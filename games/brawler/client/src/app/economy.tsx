// Economy screens: market, season, tournaments (+ shared helpers used by Collection/Detail/Breed).
import { useEffect, useState } from 'react';
import { DEMO } from '../demo.ts';
import { fmt, toYocto, useArena, useWallet, type MatchView, type TournamentView } from '../near.ts';
import { useMonsters, type NftMonster } from '../nft.ts';
import { STAGE_IDS } from '../stages.ts';
import { useLobby } from './lobby.ts';
import { prepareFight } from './arena.tsx';
import { Ico, Portrait } from './ui.tsx';

export const errText = (e: unknown) => ((e as Error)?.message ?? String(e)).slice(0, 160);
export const when = (ms: number) => new Date(ms).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
const short = (a: string | null | undefined) => (a ? (a.length > 22 ? `${a.slice(0, 20)}…` : a) : '—');

// Async load with manual reload; keeps the old value while reloading.
export function useLoad<T>(fn: () => Promise<T>, deps: unknown[] = []): [T | null, () => void, string] {
  const [v, setV] = useState<T | null>(null), [err, setErr] = useState(''), [n, setN] = useState(0);
  useEffect(() => {
    let dead = false;
    fn().then((x) => { if (!dead) { setV(x); setErr(''); } }).catch((e) => { if (!dead) setErr(errText(e)); });
    return () => { dead = true; };
  }, [...deps, n]);
  return [v, () => setN((x) => x + 1), err];
}

// Run a wallet action with busy + message state.
export function useAct(after?: () => void) {
  const [msg, setMsg] = useState(''), [busy, setBusy] = useState(false);
  const run = async (f: () => Promise<unknown>, ok = 'Done.') => {
    setBusy(true); setMsg('');
    try { await f(); setMsg(ok); after?.(); } catch (e) { setMsg(errText(e)); } finally { setBusy(false); }
  };
  return { msg, busy, run };
}

// Monsters by id (names + dna for brackets, leaderboards, parents).
export function useMons(ids: string[]) {
  const api = useMonsters();
  const key = [...new Set(ids)].sort().join(',');
  const [m, setM] = useState<Record<string, NftMonster>>({});
  useEffect(() => {
    let dead = false;
    Promise.all(key ? key.split(',').map((id) => api.get(id).catch(() => null)) : []).then((r) => {
      if (!dead) setM(Object.fromEntries(r.filter((x): x is NftMonster => !!x).map((x) => [x.id, x])));
    });
    return () => { dead = true; };
  }, [key]);
  return m;
}

function useNow() {
  const [t, setT] = useState(Date.now());
  useEffect(() => { const i = setInterval(() => setT(Date.now()), 1000); return () => clearInterval(i); }, []);
  return t;
}
const left = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000)), d = Math.floor(s / 86400), h = Math.floor(s / 3600) % 24, m = Math.floor(s / 60) % 60;
  return d ? `${d}d ${h}h ${m}m` : `${h}h ${m}m ${s % 60}s`;
};

// A monster is free to fight/enter when nothing holds it.
export const isFree = (m: NftMonster, me: string) =>
  m.lockedUntil <= Date.now() && !m.price && (!m.rental || m.rental.untilMs <= Date.now() || m.rental.renter === me);

export function Badges({ m, me }: { m: NftMonster; me: string }) {
  const now = Date.now();
  const rented = m.rental && m.rental.untilMs > now ? m.rental : null;
  return (
    <span className="badges">
      {m.lockedUntil > now && <span className="chip warn row-ico"><Ico n="icon-lock" />In match</span>}
      {rented && (rented.renter === me
        ? <span className="chip gold row-ico"><Ico n="icon-timer" />Rented until {when(rented.untilMs)}</span>
        : <span className="chip warn row-ico"><Ico n="icon-timer" />Rented out</span>)}
      {m.price && <span className="chip row-ico"><Ico n="coin" />Listed</span>}
      {m.cooldownUntil > now && <span className="chip row-ico"><Ico n="egg-gold" />Breeding cooldown</span>}
      {m.titles.map((t) => <span key={t} className="chip gold row-ico"><Ico n="trophy" />{t}</span>)}
    </span>
  );
}

/* ---------- Market ---------- */
function MarketCard({ m, rent, me }: { m: NftMonster; rent: boolean; me: string }) {
  return (
    <a className="tile" href={`#/monster/${m.id}`}>
      <Portrait dna={m.dna} size={180} />
      <div className="tile-head"><h3>{m.name}</h3><span className="chip">Gen {m.gen}</span></div>
      <span className="tile-meta">{m.record.w}W {m.record.l}L · {m.record.ko} KOs</span>
      <span className="tile-meta" title={m.owner}>{m.owner === me ? 'Yours' : `Owner ${short(m.owner)}`}</span>
      {m.titles.length > 0 && <Badges m={{ ...m, price: undefined }} me={me} />}
      <b className="price row-ico"><Ico n="coin" />
        {rent && m.rentOffer ? `${fmt(m.rentOffer.pricePerDay)} NEAR / day, up to ${m.rentOffer.maxDays} days` : `${fmt(m.price)} NEAR`}
      </b>
    </a>
  );
}

export function Market() {
  const api = useMonsters();
  const me = useWallet().signedAccountId ?? '';
  const [tab, setTab] = useState<'sale' | 'rent'>('sale');
  const [sale, , e1] = useLoad(() => api.listings());
  const [rent, , e2] = useLoad(() => api.rentOffers());
  const list = tab === 'sale' ? sale : rent;
  return (
    <>
      <div><h1 className="row-ico"><Ico n="coin-stack" className="ico h" />Market</h1><p className="sub">Buy a monster outright, or rent one by the day to fight with.</p></div>
      <div className="row" role="tablist" aria-label="Market">
        <button role="tab" aria-selected={tab === 'sale'} className={`btn ${tab === 'sale' ? '' : 'ghost'}`} onClick={() => setTab('sale')}><span><Ico n="coin" />For sale</span></button>
        <button role="tab" aria-selected={tab === 'rent'} className={`btn ${tab === 'rent' ? '' : 'ghost'}`} onClick={() => setTab('rent')}><span><Ico n="icon-timer" />For rent</span></button>
      </div>
      {(e1 || e2) && <p className="note">{e1 || e2}</p>}
      {list === null ? <p>Loading the market…</p> : list.length === 0 ? (
        <section className="slab"><h3>Nothing {tab === 'sale' ? 'for sale' : 'for rent'} right now</h3><p className="sub">Owners list their monsters from the monster page.</p></section>
      ) : <div className="grid">{list.map((m) => <MarketCard key={m.id} m={m} rent={tab === 'rent'} me={me} />)}</div>}
    </>
  );
}

/* ---------- Season ---------- */
export function Season() {
  const api = useMonsters();
  const now = useNow();
  const [season] = useLoad(() => api.season());
  const [board] = useLoad(() => api.leaderboard());
  const mons = useMons((board ?? []).map(([id]) => id));
  return (
    <>
      <div><h1 className="row-ico"><Ico n="trophy" className="ico h" />Season</h1><p className="sub">Most wins when the clock runs out takes the title.</p></div>
      <section className="slab" aria-label="Current season">
        {season === null ? <p>Loading…</p> : !season.active ? <p>No season is running right now.</p> : (
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <h2>{season.name}</h2>
            <span className="chip gold row-ico"><Ico n="icon-timer" />{season.ends_ms > now ? `Ends in ${left(season.ends_ms - now)}` : 'Ended, awaiting results'}</span>
          </div>
        )}
      </section>
      <section className="slab" aria-label="Leaderboard">
        <h2 className="row-ico"><Ico n="icon-history" />Leaderboard</h2>
        {board === null ? <p className="sub">Loading…</p> : board.length === 0 ? <p className="sub">No wins yet this season.</p> : (
          <ol className="lb">
            {board.map(([id, wins], i) => {
              const m = mons[id];
              return (
                <li key={id}>
                  <a className="lb-row" href={`#/monster/${id}`}>
                    <b className={`rank r${i + 1}`}>{i + 1}</b>
                    {m ? <Portrait dna={m.dna} size={56} className="" /> : <span className="lb-ph" />}
                    <span className="lb-who"><b>{m?.name ?? `#${id}`}</b><small title={m?.owner}>{short(m?.owner)}</small></span>
                    <span className="chip row-ico"><Ico n="trophy" />{wins} wins</span>
                  </a>
                </li>
              );
            })}
          </ol>
        )}
      </section>
    </>
  );
}

/* ---------- Tournaments ---------- */
const STATUS_ICON = { open: 'icon-room-public', live: 'icon-live', done: 'trophy', cancelled: 'icon-close' } as const;

function TCard({ t }: { t: TournamentView }) {
  return (
    <a className="tile" href={`#/tournament/${t.id}`}>
      <div className="tile-head"><h3>Tournament #{t.id}</h3><span className={`chip row-ico ${t.status === 'live' ? 'gold' : ''}`}><Ico n={STATUS_ICON[t.status]} />{t.status}</span></div>
      <span className="tile-meta row-ico"><Ico n="icon-monster" />{t.entrants.length} / {t.size} entered</span>
      <span className="tile-meta row-ico"><Ico n="coin" />Entry {fmt(t.entry_fee)} NEAR, pot {fmt(t.pot)} NEAR</span>
      {t.bettable && <span className="tile-meta row-ico"><Ico n="icon-bet" />Bets open</span>}
    </a>
  );
}

function CreateTournament({ done }: { done: (id: number) => void }) {
  const arena = useArena();
  const [size, setSize] = useState(4), [fee, setFee] = useState('0.1'), [bet, setBet] = useState(true);
  const { msg, busy, run } = useAct();
  return (
    <section className="slab" aria-label="Create tournament" style={{ display: 'grid', gap: 14 }}>
      <h3 className="row-ico"><Ico n="trophy" />Create a tournament</h3>
      <div className="row">
        <label className="row">Players <select value={size} onChange={(e) => setSize(+e.target.value)}><option value={4}>4</option><option value={8}>8</option></select></label>
        <label className="row">Entry fee <input type="number" min="0" step="0.05" value={fee} onChange={(e) => setFee(e.target.value)} style={{ width: 110 }} aria-label="Entry fee in NEAR" /> NEAR</label>
      </div>
      <label className="toggle"><input type="checkbox" checked={bet} onChange={(e) => setBet(e.target.checked)} /> Let spectators bet on matches</label>
      <button className="btn" disabled={busy || !(Number(fee) >= 0)} onClick={() => run(async () => done(await arena.createTournament(size, toYocto(fee || '0'), bet)), 'Created.')}><span><Ico n="icon-check" />Create</span></button>
      {msg && <p className="note" role="status">{msg}</p>}
    </section>
  );
}

export function Tournaments() {
  const arena = useArena();
  const me = useWallet().signedAccountId ?? '';
  const [list, reload, err] = useLoad(() => arena.listTournaments());
  const [cfg] = useLoad(() => arena.config().catch(() => null));
  const isOwner = DEMO || (!!me && cfg?.owner === me);
  const group = (f: (t: TournamentView) => boolean) => (list ?? []).filter(f);
  const sections: [string, string, TournamentView[]][] = [
    ['Open for entries', 'icon-room-public', group((t) => t.status === 'open')],
    ['Live now', 'icon-live', group((t) => t.status === 'live')],
    ['Finished', 'trophy', group((t) => t.status === 'done' || t.status === 'cancelled')],
  ];
  return (
    <>
      <div><h1 className="row-ico"><Ico n="trophy" className="ico h" />Tournaments</h1><p className="sub">Enter a monster, win the bracket, take the pot. Monsters are locked while a tournament runs.</p></div>
      {isOwner && <CreateTournament done={(id) => { reload(); location.hash = `#/tournament/${id}`; }} />}
      {err && <p className="note">{err}</p>}
      {list === null ? <p>Loading tournaments…</p> : list.length === 0 ? <section className="slab"><h3>No tournaments yet</h3></section> : sections.map(([title, ico, ts]) => ts.length > 0 && (
        <section key={title} style={{ display: 'grid', gap: 14 }}>
          <h2 className="row-ico"><Ico n={ico} />{title}</h2>
          <div className="grid">{ts.map((t) => <TCard key={t.id} t={t} />)}</div>
        </section>
      ))}
    </>
  );
}

/* ---------- Tournament page ---------- */
interface SlotInfo { acct: string | null; mon: string | null }
function Slot({ s, mons, win, lose, me }: { s: SlotInfo; mons: Record<string, NftMonster>; win: boolean; lose: boolean; me: string }) {
  const m = s.mon ? mons[s.mon] : undefined;
  return (
    <div className={`slot ${win ? 'win' : ''} ${lose ? 'lose' : ''}`}>
      {m ? <Portrait dna={m.dna} size={44} className="" /> : <span className="lb-ph" />}
      <span className="lb-who"><b>{m?.name ?? (s.acct ? `#${s.mon}` : 'TBD')}</b><small title={s.acct ?? ''}>{s.acct === me ? 'You' : short(s.acct)}</small></span>
      {win && <Ico n="trophy" />}
    </div>
  );
}

const roundName = (r: number, n: number) => (r === n - 1 ? 'Final' : r === n - 2 && n > 2 ? 'Semifinals' : `Round ${r + 1}`);

export function TournamentPage({ id }: { id: number }) {
  const arena = useArena(), api = useMonsters();
  const me = useWallet().signedAccountId ?? '';
  const { rooms } = useLobby();
  const [data, reload, err] = useLoad(async () => {
    const t = await arena.getTournament(id);
    if (!t) return null;
    const ids = t.rounds.flat().filter((x): x is number => x != null);
    const ms = (await Promise.all(ids.map((i) => arena.getMatch(i).catch(() => null)))).filter((x): x is MatchView => !!x);
    return { t, ms: Object.fromEntries(ms.map((m) => [m.id, m])) as Record<number, MatchView> };
  }, [id]);
  useEffect(() => { const i = setInterval(reload, 10_000); return () => clearInterval(i); }, []);
  const [mine, reloadMine] = useLoad(() => api.mine(), [me]);
  const t = data?.t;
  const mons = useMons([...(t?.entrants.map((e) => e.monster) ?? []), ...Object.values(data?.ms ?? {}).flatMap((m) => m.monsters.filter((x): x is string => !!x))]);
  const [pick, setPick] = useState('');
  const act = useAct(reload);
  const [note, setNote] = useState('');

  if (!data) return <>{err ? <p className="note">{err}</p> : <p>Loading tournament…</p>}<a className="navlink row-ico" href="#/tournaments"><Ico n="icon-back" />All tournaments</a></>;
  if (!t) return <section className="slab"><h2>Tournament not found</h2><a className="btn ghost" href="#/tournaments"><span><Ico n="icon-back" />Back</span></a></section>;

  const entered = t.entrants.some((e) => e.account === me);
  const free = (mine ?? []).filter((m) => isFree(m, me));
  const chosen = pick || free[0]?.id || '';
  const myLive = Object.values(data.ms).find((m) => m.status === 'live' && (m.host === me || m.guest === me));
  // Seat = on-chain order; the relay pairs both players by matchId, same arena for both (derived from the id).
  const play = (mv: MatchView) => {
    const mon = mons[mv.monsters[mv.host === me ? 0 : 1] ?? ''];
    if (!mon) return setNote('Your monster is still loading, try again.');
    prepareFight({ kind: 'match', mon, stage: STAGE_IDS[mv.id % STAGE_IDS.length], matchId: mv.id, account: me });
  };
  const watchHref = (mv: MatchView) => { const r = rooms?.find((x) => x.matchId === mv.id); return r ? `#/watch/${r.code}` : DEMO ? '#/watch/LIVE' : ''; };
  const myIdx = t.entrants.findIndex((e) => e.account === me);
  const canClaim = !t.claimed?.[myIdx] && ((t.status === 'done' && t.champion === me) || (t.status === 'cancelled' && entered));
  const stale = t.status === 'open' && Date.now() - t.created_ms > 24 * 3600_000;

  return (
    <>
      <a className="navlink row-ico" href="#/tournaments"><Ico n="icon-back" />All tournaments</a>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <div><h1 className="row-ico"><Ico n="trophy" className="ico h" />Tournament #{t.id}</h1>
          <p className="sub">{t.size} players, entry {fmt(t.entry_fee)} NEAR, pot {fmt(t.pot)} NEAR{t.bettable ? ', bets open' : ''}</p></div>
        <span className={`chip row-ico ${t.status === 'live' ? 'gold' : ''}`}><Ico n={STATUS_ICON[t.status]} />{t.status}</span>
      </div>
      {t.champion && <section className="slab"><h2 className="row-ico"><Ico n="trophy" />Champion: {short(t.champion)}{t.champion === me ? ' (you)' : ''}</h2></section>}

      {myLive && (
        <section className="slab" aria-label="Your match" style={{ display: 'grid', gap: 12 }}>
          <h3 className="row-ico"><Ico n="icon-live" />Your match is live</h3>
          <button className="btn big" onClick={() => play(myLive)}><span><Ico n="icon-play" />Play my match</span></button>
        </section>
      )}

      {t.status === 'open' && !entered && (
        <section className="slab" aria-label="Enter" style={{ display: 'grid', gap: 14 }}>
          <h3 className="row-ico"><Ico n="icon-monster" />Enter a monster ({t.entrants.length} / {t.size})</h3>
          {!me ? <button className="btn" onClick={() => arena.signIn()}><span><Ico n="icon-wallet" />Connect wallet to enter</span></button>
            : mine === null ? <p className="sub">Loading your monsters…</p>
            : free.length === 0 ? <p className="sub">No free monster. Hatch, buy or rent one first (rented out, listed and busy monsters cannot enter).</p> : (
              <>
                <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 140px), 1fr))' }}>
                  {free.map((m) => (
                    <button key={m.id} type="button" className="tile" aria-pressed={m.id === chosen} onClick={() => setPick(m.id)}>
                      <Portrait dna={m.dna} size={110} /><b>{m.name}</b><span className="tile-meta">Gen {m.gen}, {m.record.w}W {m.record.l}L</span>
                    </button>
                  ))}
                </div>
                <button className="btn big" disabled={act.busy || !chosen} onClick={() => act.run(async () => {
                  const ok = (await arena.enterTournament(t.id, chosen, t.entry_fee)) === true || DEMO; // demo returns null
                  reloadMine();
                  const now = await arena.getTournament(t.id);
                  if (!ok || !now?.entrants.some((x) => x.account === me)) throw new Error('Monster busy or unavailable. Fee refunded.');
                }, 'Entered. Good luck!')}><span><Ico n="coin" />Enter for {fmt(t.entry_fee)} NEAR</span></button>
              </>
            )}
        </section>
      )}
      {t.status === 'open' && entered && <p className="note">You are in. The bracket starts as soon as {t.size} players have entered.</p>}

      <section className="slab" aria-label="Bracket">
        <h2 className="row-ico"><Ico n="icon-lobby" />Bracket</h2>
        <div className="bracket">
          {t.rounds.map((ids, r) => (
            <div key={r} className="round">
              <h4>{roundName(r, t.rounds.length)}</h4>
              {ids.map((mid, i) => {
                const mv = mid != null ? data.ms[mid] : undefined;
                const e = (n: number): SlotInfo => ({ acct: t.entrants[n]?.account ?? null, mon: t.entrants[n]?.monster ?? null });
                const s: [SlotInfo, SlotInfo] = mv ? [{ acct: mv.host, mon: mv.monsters[0] }, { acct: mv.guest, mon: mv.monsters[1] }]
                  : r === 0 ? [e(2 * i), e(2 * i + 1)] : [{ acct: null, mon: null }, { acct: null, mon: null }];
                const w = mv?.status === 'settled' && mv.winner != null ? mv.winner : -1;
                const href = mv?.status === 'live' ? watchHref(mv) : '';
                return (
                  <div key={i} className="bmatch">
                    <Slot s={s[0]} mons={mons} win={w === 0} lose={w === 1} me={me} />
                    <Slot s={s[1]} mons={mons} win={w === 1} lose={w === 0} me={me} />
                    {mv && (
                      <div className="bfoot">
                        <span className="chip">{mv.status === 'live' ? 'Live' : mv.status === 'settled' ? 'Done' : mv.status}</span>
                        {mv.status === 'live' && (mv.host === me || mv.guest === me
                          ? <button className="btn" onClick={() => play(mv)}><span><Ico n="icon-play" />Play</span></button>
                          : href ? <a className="btn alt" href={href}><span><Ico n={t.bettable ? 'icon-bet' : 'icon-watch'} />{t.bettable ? 'Watch and bet' : 'Watch'}</span></a>
                            : <span className="tile-meta">Not streaming yet</span>)}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </section>

      {(canClaim || stale) && (
        <section className="slab row" aria-label="Payouts">
          {canClaim && <button className="btn big" disabled={act.busy} onClick={() => act.run(() => arena.claimTournament(t.id), t.status === 'done' ? 'Prize sent to your wallet.' : 'Refund sent to your wallet.')}><span><Ico n="icon-claim" />{t.status === 'done' ? 'Claim prize' : 'Claim refund'}</span></button>}
          {stale && <button className="btn ghost" disabled={act.busy} onClick={() => act.run(() => arena.cancelTournament(t.id), 'Cancelled. Entrants can claim refunds.')}><span><Ico n="icon-close" />Cancel (not filled in 24 h)</span></button>}
        </section>
      )}
      {(act.msg || note || err) && <p className="note" role="status">{act.msg || note || err}</p>}
    </>
  );
}
