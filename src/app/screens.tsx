import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { yoctoToNear } from 'near-api-js';
import { archetype, STAT_KEYS, type Dna, type Monster } from '../genes.ts';
import { history, monster, monsters } from '../store.ts';
import { ArenaBackdrop, Ico, Logo, MonsterCard, Portrait, STAGE_ICON, StageThumb, Stats, TYPE_ICON } from './ui.tsx';
import { STAGES, STAGE_IDS, type StageId } from '../stages.ts';
import { prepareFight } from './arena.tsx';
import { Claims, OnlineStart } from './rooms.tsx';
import { toYocto, fmt, useWallet } from '../near.ts';
import { useMonsters, type HistoryEntry, type NftMonster } from '../nft.ts';
import { Badges, isFree, useAct, useLoad, useMons, when } from './economy.tsx';
import { getAudio, setAudio } from '../audio.ts';
import { DEMO } from '../demo.ts';

const DEMO_NOTE = 'Demo collection stored in this browser. Monsters move on-chain to NEAR in the next build.';

/* ---------- Title ---------- */
// Side button; when its page is open it shows as active with a close (back to title) beside it.
function HubBtn({ href, label, icon, badge, active }: { href: string; label: string; icon: string; badge?: number; active?: boolean }) {
  return (
    <div className="hub-slot">
      <a className="hub-btn" href={href} aria-current={active ? 'page' : undefined}>
        <Ico n={icon} className="hub-btn-ico" />
        <span>{label}</span>
        {badge ? <b className="hub-badge">{badge}</b> : null}
      </a>
      {active && <a className="hub-close" href="#/" aria-label={`Close ${label}`}><Ico n="icon-close" /></a>}
    </div>
  );
}

// Which side a page's panel opens from (matches its button).
const PANEL_FROM: Record<string, 'left' | 'right' | 'bottom'> = { collection: 'left', breed: 'left', market: 'left', account: 'left', lobby: 'right', tournaments: 'right', season: 'right', play: 'bottom' };

// Native modal popup; closes on Esc, backdrop click or the X.
function HubDialog({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { ref.current?.showModal(); }, []);
  return (
    <dialog ref={ref} className="hub-dialog" aria-label={title} onClose={onClose} onClick={(e) => e.target === ref.current && ref.current?.close()}>
      <header><h2>{title}</h2><button type="button" className="hub-x" aria-label="Close" onClick={() => ref.current?.close()}><Ico n="icon-close" /></button></header>
      {children}
    </dialog>
  );
}

// Title hub. Menu pages (lobby, collection, …) open inside it as a panel that grows from their button.
export function Title({ page, children }: { page?: string; children?: React.ReactNode }) {
  const list = useMemo(monsters, []);
  const { signedAccountId } = useWallet();
  const [i, setI] = useState(0);
  const [stage, setStage] = useState<StageId>('ember');
  const [pop, setPop] = useState<'mon' | 'map' | null>(null);
  const m = list[i];
  const wins = list.reduce((s, x) => s + x.record.w, 0), kos = list.reduce((s, x) => s + x.record.ko, 0);
  const step = (d: number) => setI((i + d + list.length) % list.length);
  return (
    <div className={`hub ${children ? 'open' : ''}`}>
      <ArenaBackdrop id={stage} className="hub-bg" />
      <header className="hub-top">
        <a href="#/" aria-label="Home"><Logo className="hub-logo" /></a>
        <div className="hub-counters">
          <span className="hub-count" title="Total wins"><Ico n="trophy" /><i>Wins</i>{wins}</span>
          <span className="hub-count" title="Total knockouts"><Ico n="ko" /><i>KOs</i>{kos}</span>
          <a className="hub-count wallet" href="#/account"><Ico n="icon-wallet" />{signedAccountId || 'Connect wallet'}</a>
          {DEMO && <a className="hub-count demo" href="/">Demo mode · exit</a>}
        </div>
      </header>

      <nav className="hub-side left" aria-label="Monsters">
        <HubBtn href="#/collection" label="Monsters" icon="icon-monster" badge={list.length} active={page === 'collection'} />
        <HubBtn href="#/breed" label="Breed" icon="icon-breed" active={page === 'breed'} />
        <HubBtn href="#/market" label="Market" icon="coin-stack" active={page === 'market'} />
        <HubBtn href="#/account" label="Account" icon="icon-wallet" active={page === 'account'} />
      </nav>

      <section className="hub-hero" aria-label="Your monster" inert={!!children}>
        <div className="hub-tags">
          <span className="hub-tag gen"><Ico n="dna" />Gen {m.gen}</span>
          <span className="hub-tag rec"><Ico n="trophy" />{m.record.w}W · {m.record.l}L</span>
          <span className="hub-tag"><Ico n={TYPE_ICON[archetype(m.dna)]} />{archetype(m.dna)}</span>
        </div>
        <button type="button" className="hub-mon" aria-label={`Choose monster, current ${m.name}`} onClick={() => setPop('mon')}>
          <Portrait key={m.id} dna={m.dna} size={420} className="" />
        </button>
        <div className="hub-name">
          {list.length > 1 && <button type="button" className="hub-arrow" onClick={() => step(-1)} aria-label="Previous monster">◀</button>}
          <button type="button" className="hub-plate" onClick={() => setPop('mon')}><h1>{m.name}</h1><small>Change monster</small></button>
          {list.length > 1 && <button type="button" className="hub-arrow" onClick={() => step(1)} aria-label="Next monster">▶</button>}
        </div>
      </section>

      <nav className="hub-side right" aria-label="Online">
        <HubBtn href="#/lobby" label="Lobby" icon="icon-lobby" active={page === 'lobby'} />
        <HubBtn href="#/tournaments" label="Cups" icon="trophy" active={page === 'tournaments'} />
        <HubBtn href="#/season" label="Season" icon="icon-history" active={page === 'season'} />
      </nav>

      {children && (
        <main key={page} className={`hub-panel from-${PANEL_FROM[page ?? ''] ?? 'bottom'}`}>
          {!PANEL_FROM[page ?? ''] || page === 'play' ? <a className="hub-close panel-x" href="#/" aria-label="Back to title"><Ico n="icon-close" /></a> : null}
          <div className="page">{children}</div>
        </main>
      )}

      <footer className="hub-bottom" inert={!!children}>
        {/* ponytail: arena pick here only changes the backdrop; Play still has its own picker */}
        <button type="button" className="hub-event" onClick={() => setPop('map')}>
          <StageThumb id={stage} className="hub-event-thumb" />
          <small>Arena · tap to change</small>
          <b>{STAGES[stage].name}</b>
          <span>{STAGES[stage].blurb}</span>
        </button>
        <a className="hub-play" href="#/play"><span><Ico n="icon-play" />Play</span></a>
      </footer>

      {pop === 'mon' && (
        <HubDialog title="Choose your monster" onClose={() => setPop(null)}>
          <div className="hub-pick">
            {list.map((x, j) => (
              <button key={x.id} type="button" className="hub-card" aria-pressed={j === i} onClick={() => { setI(j); setPop(null); }}>
                <Portrait dna={x.dna} size={220} className="" />
                <b>{x.name}</b>
                <span className="row-ico"><Ico n={TYPE_ICON[archetype(x.dna)]} />Gen {x.gen} · {archetype(x.dna)} · {x.record.w}W {x.record.l}L</span>
              </button>
            ))}
          </div>
          <a className="hub-link row-ico" href="#/collection"><Ico n="icon-monster" />Manage collection</a>
        </HubDialog>
      )}
      {pop === 'map' && (
        <HubDialog title="Choose arena" onClose={() => setPop(null)}>
          <div className="hub-pick maps">
            {STAGE_IDS.map((id) => (
              <button key={id} type="button" className="hub-card" aria-pressed={id === stage} onClick={() => { setStage(id); setPop(null); }}>
                <StageThumb id={id} className="hub-card-thumb" />
                <b className="row-ico"><Ico n={STAGE_ICON[id]} />{STAGES[id].name}</b>
                <span>{STAGES[id].blurb}</span>
              </button>
            ))}
          </div>
        </HubDialog>
      )}
    </div>
  );
}

/* ---------- Play ---------- */
function Picker({ groups, value, onPick, label }: { groups: [string, Monster[]][]; value: string; onPick: (id: string) => void; label: string }) {
  return (
    <section className="slab" aria-label={label}>
      <h3>{label}</h3>
      {groups.map(([title, list]) => list.length > 0 && (
        <div key={title}>
          <p className="sub" style={{ marginTop: 14 }}>{title}</p>
          <div className="grid" style={{ marginTop: 8, gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 170px), 1fr))' }}>
            {list.map((m) => (
              <button key={m.id} type="button" className="tile" aria-pressed={m.id === value} onClick={() => onPick(m.id)}>
                <Portrait dna={m.dna} size={140} />
                <b>{m.name}</b>
                <span className="tile-meta">{archetype(m.dna)}</span>
              </button>
            ))}
          </div>
        </div>
      ))}
    </section>
  );
}

export function Play() {
  const api = useMonsters();
  const me = useWallet().signedAccountId ?? '';
  const [chain] = useLoad(() => api.mine().catch(() => []), [me]);
  const local = useMemo(monsters, []);
  const free = (chain ?? []).filter((m) => isFree(m, me));
  const list: Monster[] = [...free, ...local];
  const groups: [string, Monster[]][] = [['On-chain monsters (locked in staked/bettable matches)', free], ['Browser monsters (casual only)', local]];
  const [mode, setMode] = useState<'local' | 'online'>('online');
  const [p1, setP1] = useState(''), [p2, setP2] = useState('');
  const [stage, setStage] = useState<StageId>('ember');
  const get = (id: string, alt = 0): Monster | undefined => list.find((m) => m.id === id) ?? list[alt] ?? list[0];
  const a = get(p1), b = get(p2, 1);
  return (
    <>
      <div><h1 className="row-ico"><Ico n="icon-play" className="ico h" />Fight</h1><p className="sub">Pick a mode and the monster you will send in.</p></div>
      <div className="row" role="tablist" aria-label="Mode">
        <button role="tab" aria-selected={mode === 'online'} className={`btn ${mode === 'online' ? '' : 'ghost'}`} onClick={() => setMode('online')}><span><Ico n="icon-lobby" />Online</span></button>
        <button role="tab" aria-selected={mode === 'local'} className={`btn ${mode === 'local' ? '' : 'ghost'}`} onClick={() => setMode('local')}><span><Ico n="icon-play" />Same keyboard</span></button>
      </div>
      <Picker groups={groups} value={a?.id ?? ''} onPick={setP1} label={mode === 'local' ? 'Player 1 monster (WASD)' : 'Your monster'} />
      {!a && <p className="note">No monsters available.</p>}
      {mode === 'local' && <Picker groups={groups} value={b?.id ?? ''} onPick={setP2} label="Player 2 monster (arrows)" />}
      <section className="slab" aria-label="Arena">
        <h3>Arena</h3>
        <p className="sub">{mode === 'online' ? 'The host picks the arena.' : 'Where the fight happens.'}</p>
        <div className="grid" style={{ marginTop: 14, gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 260px), 1fr))' }}>
          {STAGE_IDS.map((id) => (
            <button key={id} type="button" className="tile" aria-pressed={id === stage} onClick={() => setStage(id)}>
              <StageThumb id={id} className="portrait" />
              <b className="row-ico"><Ico n={STAGE_ICON[id]} />{STAGES[id].name}</b>
              <span className="tile-meta">{STAGES[id].blurb}</span>
            </button>
          ))}
        </div>
      </section>
      {!a || !b ? null : mode === 'local' ? (
        <section className="slab row" aria-label="Start">
          <button className="btn big" onClick={() => prepareFight({ kind: 'local', mons: [a, b], stage })}><span><Ico n="icon-play" />Start fight</span></button>
        </section>
      ) : <OnlineStart mon={a} stage={stage} />}
      <p className="note">Controls: move with WASD, Space to jump, Z light, X heavy, C dodge. Player 2 uses arrows and Num0 to Num3. Gamepads work too.</p>
    </>
  );
}

/* ---------- Collection ---------- */
const SORTS = { newest: (a: Monster, b: Monster) => b.born - a.born, wins: (a: Monster, b: Monster) => b.record.w - a.record.w, gen: (a: Monster, b: Monster) => b.gen - a.gen };
export function Collection() {
  const api = useMonsters();
  const { signedAccountId, signIn } = useWallet();
  const me = signedAccountId ?? '';
  const [sort, setSort] = useState<keyof typeof SORTS>('newest');
  const [all, reload, err] = useLoad(() => api.mine(), [me]);
  const [claimed, reloadClaimed] = useLoad(() => api.startersClaimed().catch(() => true), [me]);
  const act = useAct(() => { reload(); reloadClaimed(); });
  const list = useMemo(() => [...(all ?? [])].sort(SORTS[sort]), [all, sort]);
  const empty = all !== null && !all.some((m) => m.owner === me);
  return (
    <>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <div><h1 className="row-ico"><Ico n="icon-monster" className="ico h" />My monsters</h1><p className="sub">{all ? `${list.length} in your stable.` : 'Loading your stable…'} Genes decide how each one fights.</p></div>
        <label className="row">Sort by
          <select value={sort} onChange={(e) => setSort(e.target.value as keyof typeof SORTS)}>
            <option value="newest">Newest</option><option value="wins">Most wins</option><option value="gen">Generation</option>
          </select>
        </label>
      </div>
      {err && <p className="note">{err}</p>}
      {!me && <section className="slab" style={{ display: 'grid', gap: 12, justifyItems: 'start' }}><h3>Connect your wallet</h3><p className="sub">Sign in to see and claim your monsters.</p><button className="btn big" onClick={() => signIn()}><span><Ico n="icon-wallet" />Connect wallet</span></button></section>}
      {me && empty && claimed === false && (
        <section className="slab" style={{ display: 'grid', gap: 12, justifyItems: 'start' }}>
          <h2 className="row-ico"><Ico n="egg-gold" />Start your stable</h2>
          <p className="sub">Every account gets three free first-generation monsters.</p>
          <button className="btn big" disabled={act.busy} onClick={() => (me ? act.run(() => api.hatchStarters(), 'Hatched!') : signIn())}><span><Ico n="egg-hatch" />Claim 3 starter monsters</span></button>
          {act.msg && <p className="note" role="status">{act.msg}</p>}
        </section>
      )}
      {me && all !== null && !all.length && claimed !== false && <section className="slab"><h3>No monsters yet</h3><p className="sub">Buy or rent one from the <a href="#/market">market</a>.</p></section>}
      <div className="grid">{list.map((m) => <MonsterCard key={m.id} m={m} href={`#/monster/${m.id}`} extra={<Badges m={m} me={me} />} />)}</div>
      {DEMO && <p className="note">{DEMO_NOTE}</p>}
    </>
  );
}

/* ---------- Detail ---------- */
const GENE_NAMES: Record<string, string[]> = {
  horn: ['Curved horns', 'Spike horns', 'Ram curls', 'Crest horn'],
  tail: ['Spiked tail', 'Club tail', 'Leaf fin'],
  pattern: ['Plain hide', 'Stripes', 'Spots'],
  eye: ['Bright eyes', 'Fierce brow', 'Sleepy lids', 'Cyclops'],
};
const geneRows = (d: Dna) => [
  ['Horns', GENE_NAMES.horn[d.horn]], ['Tail', GENE_NAMES.tail[d.tail]], ['Hide', GENE_NAMES.pattern[d.pattern]],
  ['Eyes', GENE_NAMES.eye[d.eye]], ['Colour', `hue ${d.hue}, accent ${d.accent}`], ['Size', `${d.size}%`],
];

function Trade({ m, me, reload }: { m: NftMonster; me: string; reload: () => void }) {
  const api = useMonsters();
  const { signIn } = useWallet();
  const act = useAct(reload);
  const [price, setPrice] = useState('1'), [rate, setRate] = useState('0.1'), [maxDays, setMaxDays] = useState('7'), [days, setDays] = useState('1');
  const now = Date.now();
  const rented = !!m.rental && m.rental.untilMs > now;
  const held = m.lockedUntil > now || rented; // in a match or rented out: owner can't list/offer
  const d = Math.min(Math.max(1, Math.floor(+days) || 1), m.rentOffer?.maxDays ?? 1);
  const gate = (f: () => Promise<unknown>, ok: string) => (me ? act.run(f, ok) : signIn());
  const owner = me !== '' && m.owner === me;
  if (!owner && !m.price && !(m.rentOffer && !rented)) return null;
  return (
    <section className="slab" aria-label="Trade" style={{ display: 'grid', gap: 14 }}>
      <h2 className="row-ico"><Ico n="coin-stack" />{owner ? 'Sell or rent out' : 'Get this monster'}</h2>
      {owner ? (
        <>
          {held && <p className="note">Busy right now (in a match or rented out), so it cannot be listed or offered.</p>}
          <div className="row">
            {m.price ? (
              <><span className="chip gold row-ico"><Ico n="coin" />Listed at {fmt(m.price)} NEAR</span>
                <button className="btn ghost" disabled={act.busy} onClick={() => act.run(() => api.delist(m.id), 'Listing removed.')}><span><Ico n="icon-close" />Delist</span></button></>
            ) : (
              <><label className="row">Price <input type="number" min="0" step="0.1" value={price} onChange={(e) => setPrice(e.target.value)} aria-label="Sale price in NEAR" style={{ width: 100 }} /> NEAR</label>
                <button className="btn" disabled={act.busy || held || !(+price > 0)} onClick={() => act.run(() => api.list(m.id, toYocto(price)), 'Listed for sale.')}><span><Ico n="coin" />List for sale</span></button></>
            )}
          </div>
          <div className="row">
            {m.rentOffer ? (
              <><span className="chip gold row-ico"><Ico n="icon-timer" />Rent {fmt(m.rentOffer.pricePerDay)} NEAR/day, max {m.rentOffer.maxDays} days</span>
                <button className="btn ghost" disabled={act.busy} onClick={() => act.run(() => api.cancelRent(m.id), 'Offer cancelled.')}><span><Ico n="icon-close" />Cancel offer</span></button></>
            ) : (
              <><label className="row">Per day <input type="number" min="0" step="0.01" value={rate} onChange={(e) => setRate(e.target.value)} aria-label="Rent per day in NEAR" style={{ width: 90 }} /> NEAR</label>
                <label className="row">Max days <input type="number" min="1" step="1" value={maxDays} onChange={(e) => setMaxDays(e.target.value)} aria-label="Maximum rental days" style={{ width: 70 }} /></label>
                <button className="btn alt" disabled={act.busy || held || !(+rate > 0) || !(+maxDays >= 1)} onClick={() => act.run(() => api.offerRent(m.id, toYocto(rate), Math.floor(+maxDays)), 'Rent offer published.')}><span><Ico n="icon-timer" />Offer for rent</span></button></>
            )}
          </div>
        </>
      ) : (
        <>
          {m.price && <div className="row"><b className="row-ico"><Ico n="coin" />{fmt(m.price)} NEAR</b>
            <button className="btn big" disabled={act.busy} onClick={() => gate(() => api.buy(m.id, m.price!), 'Bought! It is yours now.')}><span><Ico n="coin" />Buy</span></button></div>}
          {m.rentOffer && !rented && !m.price && (
            <div className="row">
              <label className="row">Days <input type="number" min="1" max={m.rentOffer.maxDays} step="1" value={days} onChange={(e) => setDays(e.target.value)} aria-label="Days to rent" style={{ width: 70 }} /> (max {m.rentOffer.maxDays})</label>
              <b className="row-ico"><Ico n="coin" />{fmt((BigInt(m.rentOffer.pricePerDay) * BigInt(d)).toString())} NEAR total</b>
              <button className="btn alt" disabled={act.busy || m.lockedUntil > now} onClick={() => gate(() => api.rent(m.id, d, (BigInt(m.rentOffer!.pricePerDay) * BigInt(d)).toString()), 'Rented. You can fight with it now.')}><span><Ico n="icon-timer" />Rent for {d} day{d > 1 ? 's' : ''}</span></button>
            </div>
          )}
        </>
      )}
      {act.msg && <p className="note" role="status">{act.msg}</p>}
    </section>
  );
}

function History({ rows }: { rows: HistoryEntry[] }) {
  const vs = useMons(rows.map((h) => h.vs ?? '').filter(Boolean));
  return rows.length === 0 ? <p className="sub">No fights recorded yet.</p> : (
    <ul className="hist">
      {rows.map((h) => (
        <li key={h.match_id}>
          <span className={`chip row-ico ${h.won ? 'gold' : h.won === false ? 'warn' : ''}`}><Ico n={h.won ? 'trophy' : h.won === false ? 'skull' : 'icon-refresh'} />{h.won ? 'Won' : h.won === false ? 'Lost' : 'Void'}</span>
          <span>vs {h.vs ? <a href={`#/monster/${h.vs}`}>{vs[h.vs]?.name ?? `#${h.vs}`}</a> : 'unknown'}</span>
          <span className="row-ico"><Ico n="ko" />{h.kos}</span>
          {h.tournament != null && <a className="chip row-ico" href={`#/tournament/${h.tournament}`}><Ico n="trophy" />Tournament #{h.tournament}</a>}
          <small>{when(h.ms)}</small>
        </li>
      ))}
    </ul>
  );
}

export function Detail({ id }: { id: string }) {
  const api = useMonsters();
  const me = useWallet().signedAccountId ?? '';
  const [data, reload, err] = useLoad(async () => ({ m: await api.get(id) }), [id]);
  const [hist] = useLoad(() => api.history(id).catch(() => [] as HistoryEntry[]), [id]);
  const m = data?.m;
  const parents = useMons(m?.parents ?? []);
  if (!data) return <p>{err || 'Loading monster…'}</p>;
  if (!m) return <div className="slab"><h2>Monster not found</h2><a className="btn ghost" href="#/collection"><span><Ico n="icon-back" />Back</span></a></div>;
  return (
    <>
      <a className="navlink row-ico" href="#/collection"><Ico n="icon-back" />Back to collection</a>
      <div className="split">
        <div className="slab" style={{ display: 'grid', justifyItems: 'center', gap: 12 }}>
          <Portrait dna={m.dna} size={340} />
          <h1>{m.name}</h1>
          <div className="row"><span className="chip gold row-ico"><Ico n={TYPE_ICON[archetype(m.dna)]} />{archetype(m.dna)}</span><span className="chip row-ico"><Ico n="dna" />Gen {m.gen}</span></div>
          <Badges m={m} me={me} />
        </div>
        <div style={{ display: 'grid', gap: 20 }}>
          <Trade m={m} me={me} reload={reload} />
          <section className="slab"><h2 className="row-ico"><Ico n="icon-play" />Fight stats</h2><div style={{ marginTop: 14 }}><Stats dna={m.dna} /></div></section>
          <section className="slab">
            <h2 className="row-ico"><Ico n="trophy" />Career</h2>
            <dl className="kv" style={{ marginTop: 14 }}>
              <dt>Record</dt><dd className="row-ico"><Ico n="trophy" />{m.record.w} wins, {m.record.l} losses</dd>
              <dt>Knockouts</dt><dd className="row-ico"><Ico n="ko" />{m.record.ko}</dd>
              <dt>Owner</dt><dd style={{ overflowWrap: 'anywhere' }}>{m.owner === me ? 'You' : m.owner}</dd>
              <dt>Hatched</dt><dd>{new Date(m.born).toLocaleDateString()}</dd>
            </dl>
          </section>
          <section className="slab">
            <h2 className="row-ico"><Ico n="icon-history" />Fight history</h2>
            <div style={{ marginTop: 12 }}>{hist === null ? <p className="sub">Loading…</p> : <History rows={hist} />}</div>
          </section>
          <section className="slab">
            <h2 className="row-ico"><Ico n="dna" />Genes</h2>
            <dl className="kv" style={{ marginTop: 14 }}>{geneRows(m.dna).map(([k, v]) => <Fragment key={k}><dt>{k}</dt><dd>{v}</dd></Fragment>)}</dl>
          </section>
          <section className="slab">
            <h2 className="row-ico"><Ico n="egg-gold" />Lineage</h2>
            <p className="sub">{m.parents ? 'Parents' : 'A wild first-generation monster.'}</p>
            <div className="row" style={{ marginTop: 10 }}>{(m.parents ?? []).map((p) => <a key={p} className="chip" href={`#/monster/${p}`}>{parents[p]?.name ?? `#${p}`}</a>)}</div>
          </section>
          <div className="row">
            <a className="btn" href="#/play"><span><Ico n="icon-play" />Fight</span></a>
            <a className="btn alt" href="#/breed"><span><Ico n="icon-breed" />Breed</span></a>
          </div>
        </div>
      </div>
    </>
  );
}

/* ---------- Breed ---------- */
export function Breed() {
  const api = useMonsters();
  const me = useWallet().signedAccountId ?? '';
  const [all, reload, err] = useLoad(() => api.mine(), [me]);
  const [cfg] = useLoad(() => api.config().catch(() => null));
  const [sel, setSel] = useState<string[]>([]);
  const [born, setBorn] = useState<NftMonster | null>(null);
  const act = useAct(reload);
  const now = Date.now();
  const list = (all ?? []).filter((m) => m.owner === me); // rented-in monsters can't breed
  const why = (m: NftMonster) => (m.lockedUntil > now ? 'In match' : m.rental && m.rental.untilMs > now ? 'Rented out' : m.cooldownUntil > now ? 'Breeding cooldown' : '');
  const toggle = (id: string) => setSel((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id].slice(-2)));
  const [a, b] = sel.map((id) => list.find((m) => m.id === id)).filter(Boolean) as NftMonster[];
  const hatch = () => act.run(async () => { const c = await api.breed(a.id, b.id); setBorn(c); setSel([]); }, '');
  return (
    <>
      <div><h1 className="row-ico"><Ico n="icon-breed" className="ico h" />Breed</h1><p className="sub">Pick two parents. The egg inherits a mix of their genes, and sometimes a mutation. Each parent then rests for an hour.</p></div>
      {born && (
        <section className="slab reveal" style={{ display: 'grid', justifyItems: 'center', gap: 10, textAlign: 'center' }} aria-live="polite">
          <Ico n="egg-hatch" className="ico egg-big" />
          <h2>{born.name} hatched</h2>
          <Portrait dna={born.dna} size={260} />
          <p>Generation {born.gen}.</p>
          <a className="btn" href={`#/monster/${born.id}`}><span><Ico n="icon-monster" />Meet {born.name}</span></a>
        </section>
      )}
      {a && b && (
        <section className="slab" aria-label="Inheritance preview">
          <h2 className="row-ico"><Ico n="egg-purple" className="ico h" />{a.name} and {b.name}</h2>
          <dl className="kv" style={{ marginTop: 12 }}>
            {STAT_KEYS.map((k) => <Fragment key={k}><dt>{k}</dt><dd>{Math.min(a.dna[k], b.dna[k])} to {Math.max(a.dna[k], b.dna[k])}</dd></Fragment>)}
            <dt>Horns</dt><dd>{GENE_NAMES.horn[a.dna.horn]} or {GENE_NAMES.horn[b.dna.horn]}</dd>
            <dt>Tail</dt><dd>{GENE_NAMES.tail[a.dna.tail]} or {GENE_NAMES.tail[b.dna.tail]}</dd>
            <dt>Fee</dt><dd className="row-ico"><Ico n="coin" />{cfg ? `${fmt(cfg.breed_fee)} NEAR + storage` : '…'}</dd>
          </dl>
          <div className="row" style={{ marginTop: 16 }}><button className="btn big" disabled={act.busy} onClick={hatch}><span><Ico n="egg-teal" />{act.busy ? 'Hatching…' : 'Hatch egg'}</span></button></div>
        </section>
      )}
      {(act.msg || err) && <p className="note" role="status">{act.msg || err}</p>}
      {all === null ? <p>Loading your monsters…</p> : list.length < 2 && <p className="note">You need two monsters of your own to breed.</p>}
      <div className="grid">{list.map((m) => <MonsterCard key={m.id} m={m} selected={sel.includes(m.id)} disabled={!!why(m)} onClick={() => toggle(m.id)} extra={why(m) ? <span className="chip warn">{why(m)}</span> : undefined} />)}</div>
      {DEMO && <p className="note">{DEMO_NOTE}</p>}
    </>
  );
}

/* ---------- Account ---------- */
export function Account() {
  const { signedAccountId, signIn, signOut, getBalance, loading, network } = useWallet();
  const [bal, setBal] = useState<string>('');
  useEffect(() => {
    if (!signedAccountId) return setBal('');
    getBalance(signedAccountId).then((y: bigint) => setBal(Number(yoctoToNear(y)).toFixed(3))).catch(() => setBal('unavailable'));
  }, [signedAccountId, getBalance]);
  const log = history();
  const wins = log.filter((l) => l.won).length;
  const api = useMonsters();
  const [owed, setOwed] = useState('0');
  useEffect(() => { if (signedAccountId) api.owed().then(setOwed).catch(() => {}); }, [signedAccountId]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <>
      <div><h1 className="row-ico"><Ico n="icon-wallet" className="ico h" />Account</h1><p className="sub">Your NEAR account owns your monsters. Network: {network}.</p></div>
      <div className="split">
        <section className="slab" style={{ display: 'grid', gap: 14 }}>
          {loading ? <p>Checking wallet…</p> : signedAccountId ? (
            <>
              <h2 style={{ overflowWrap: 'anywhere' }}>{signedAccountId}</h2>
              <dl className="kv"><dt>Balance</dt><dd className="row-ico"><Ico n="coin" />{bal ? `${bal} NEAR` : 'loading…'}</dd><dt>Monsters</dt><dd className="row-ico"><Ico n="icon-monster" />{monsters().length}</dd></dl>
              {owed !== '0' && <button className="btn" onClick={() => api.withdrawOwed().then(() => setOwed('0'))}><span><Ico n="coin" />Withdraw {fmt(owed)} NEAR from failed payouts</span></button>}
              <button className="btn ghost" onClick={() => signOut()}><span><Ico n="icon-close" />Disconnect</span></button>
            </>
          ) : (
            <>
              <h2>Connect a wallet</h2>
              <p className="sub">Sign in once. Fights never ask for a signature.</p>
              <button className="btn" onClick={() => signIn()}><span><Ico n="icon-wallet" />Connect NEAR wallet</span></button>
            </>
          )}
        </section>
        <section className="slab">
          <h2 className="row-ico"><Ico n="icon-history" />Recent fights</h2>
          <p className="sub">{log.length ? `${wins} wins from ${log.length} fights` : 'No fights yet.'}</p>
          <ul style={{ listStyle: 'none', padding: 0, margin: '12px 0 0', display: 'grid', gap: 8 }}>
            {log.slice(0, 10).map((l) => (
              <li key={l.at} className="row" style={{ justifyContent: 'space-between' }}>
                <span>{monster(l.mine)?.name ?? 'Unknown'} vs {l.vs}</span>
                <span className={`chip row-ico ${l.won ? 'gold' : ''}`}><Ico n={l.won ? 'trophy' : 'skull'} />{l.won ? 'Won' : 'Lost'}</span>
              </li>
            ))}
          </ul>
        </section>
      </div>
      <Claims />
      <SoundSettings />
    </>
  );
}

function SoundSettings() {
  const [a, setA] = useState(getAudio);
  const set = (p: Parameters<typeof setAudio>[0]) => setA({ ...setAudio(p) });
  return (
    <section className="slab" style={{ display: 'grid', gap: 12 }} aria-label="Sound">
      <h2 className="row-ico"><Ico n={a.muted ? 'icon-sound-off' : 'icon-sound-on'} />Sound</h2>
      <label className="row">Music
        <input type="range" min={0} max={1} step={0.05} value={a.music} onChange={(e) => set({ music: +e.target.value })} style={{ flex: 1, minHeight: 0, padding: 0 }} />
      </label>
      <label className="row">Effects
        <input type="range" min={0} max={1} step={0.05} value={a.sfx} onChange={(e) => set({ sfx: +e.target.value })} style={{ flex: 1, minHeight: 0, padding: 0 }} />
      </label>
      <label className="row"><input type="checkbox" checked={a.muted} onChange={(e) => set({ muted: e.target.checked })} style={{ minHeight: 0 }} /> Mute everything (M in a fight)</label>
    </section>
  );
}
