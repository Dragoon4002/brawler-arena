import { Fragment, useEffect, useMemo, useState } from 'react';
import { useNearWallet } from 'near-connect-hooks';
import { yoctoToNear } from 'near-api-js';
import { archetype, STAT_KEYS, type Dna, type Monster } from '../genes.ts';
import { breedPair, children, history, monster, monsters } from '../store.ts';
import { Logo, MonsterCard, Portrait, StageThumb, Stats } from './ui.tsx';
import { STAGES, STAGE_IDS, type StageId } from '../stages.ts';
import { prepareFight } from './arena.tsx';
import { Claims, OnlineStart } from './rooms.tsx';
import { getAudio, setAudio } from '../audio.ts';

const DEMO_NOTE = 'Demo collection stored in this browser. Monsters move on-chain to NEAR in the next build.';

/* ---------- Title ---------- */
export function Title() {
  const [a, b] = monsters();
  return (
    <div className="title">
      <div />
      <section className="wrap title-stage">
        <div className="title-copy">
          <Logo className="logo-big" />
          <p>Raise a monster, win its fights, breed its heirs. Every career is yours to keep.</p>
          <div className="title-actions">
            <a className="btn big" href="#/play"><span>Fight</span></a>
            <a className="btn alt" href="#/collection"><span>My monsters</span></a>
            <div className="row">
              <a className="btn ghost" href="#/breed"><span>Breed</span></a>
              <a className="btn ghost" href="#/account"><span>Account</span></a>
            </div>
          </div>
        </div>
        <div className="title-art">
          <StageThumb id="ember" className="title-arena" />
          <div className="title-duo">
            <Portrait dna={a.dna} size={240} className="" />
            <Portrait dna={b.dna} size={240} flip className="" />
          </div>
        </div>
      </section>
    </div>
  );
}

/* ---------- Play ---------- */
function Picker({ list, value, onPick, label }: { list: Monster[]; value: string; onPick: (id: string) => void; label: string }) {
  return (
    <section className="slab" aria-label={label}>
      <h3>{label}</h3>
      <div className="grid" style={{ marginTop: 14, gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 170px), 1fr))' }}>
        {list.map((m) => (
          <button key={m.id} type="button" className="tile" aria-pressed={m.id === value} onClick={() => onPick(m.id)}>
            <Portrait dna={m.dna} size={140} />
            <b>{m.name}</b>
            <span className="tile-meta">{archetype(m.dna)}</span>
          </button>
        ))}
      </div>
    </section>
  );
}

export function Play() {
  const list = useMemo(monsters, []);
  const [mode, setMode] = useState<'local' | 'online'>('online');
  const [p1, setP1] = useState(list[0].id);
  const [p2, setP2] = useState(list[1]?.id ?? list[0].id);
  const [stage, setStage] = useState<StageId>('ember');
  const get = (id: string) => list.find((m) => m.id === id)!;
  return (
    <>
      <div><h1>Fight</h1><p className="sub">Pick a mode and the monster you will send in.</p></div>
      <div className="row" role="tablist" aria-label="Mode">
        <button role="tab" aria-selected={mode === 'online'} className={`btn ${mode === 'online' ? '' : 'ghost'}`} onClick={() => setMode('online')}><span>Online</span></button>
        <button role="tab" aria-selected={mode === 'local'} className={`btn ${mode === 'local' ? '' : 'ghost'}`} onClick={() => setMode('local')}><span>Same keyboard</span></button>
      </div>
      <Picker list={list} value={p1} onPick={setP1} label={mode === 'local' ? 'Player 1 monster (WASD)' : 'Your monster'} />
      {mode === 'local' && <Picker list={list} value={p2} onPick={setP2} label="Player 2 monster (arrows)" />}
      <section className="slab" aria-label="Arena">
        <h3>Arena</h3>
        <p className="sub">{mode === 'online' ? 'The host picks the arena.' : 'Where the fight happens.'}</p>
        <div className="grid" style={{ marginTop: 14, gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 260px), 1fr))' }}>
          {STAGE_IDS.map((id) => (
            <button key={id} type="button" className="tile" aria-pressed={id === stage} onClick={() => setStage(id)}>
              <StageThumb id={id} className="portrait" />
              <b>{STAGES[id].name}</b>
              <span className="tile-meta">{STAGES[id].blurb}</span>
            </button>
          ))}
        </div>
      </section>
      {mode === 'local' ? (
        <section className="slab row" aria-label="Start">
          <button className="btn big" onClick={() => prepareFight({ kind: 'local', mons: [get(p1), get(p2)], stage })}><span>Start fight</span></button>
        </section>
      ) : <OnlineStart mon={get(p1)} stage={stage} />}
      <p className="note">Controls: move with WASD, Space to jump, Z light, X heavy, C dodge. Player 2 uses arrows and Num0 to Num3. Gamepads work too.</p>
    </>
  );
}

/* ---------- Collection ---------- */
const SORTS = { newest: (a: Monster, b: Monster) => b.born - a.born, wins: (a: Monster, b: Monster) => b.record.w - a.record.w, gen: (a: Monster, b: Monster) => b.gen - a.gen };
export function Collection() {
  const [sort, setSort] = useState<keyof typeof SORTS>('newest');
  const list = useMemo(() => [...monsters()].sort(SORTS[sort]), [sort]);
  return (
    <>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <div><h1>My monsters</h1><p className="sub">{list.length} in your stable. Genes decide how each one fights.</p></div>
        <label className="row">Sort by
          <select value={sort} onChange={(e) => setSort(e.target.value as keyof typeof SORTS)}>
            <option value="newest">Newest</option><option value="wins">Most wins</option><option value="gen">Generation</option>
          </select>
        </label>
      </div>
      <div className="grid">{list.map((m) => <MonsterCard key={m.id} m={m} href={`#/monster/${m.id}`} />)}</div>
      <p className="note">{DEMO_NOTE}</p>
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

export function Detail({ id }: { id: string }) {
  const m = monster(id);
  if (!m) return <div className="slab"><h2>Monster not found</h2><a className="btn" href="#/collection"><span>Back</span></a></div>;
  const parents = (m.parents ?? []).map(monster).filter(Boolean) as Monster[];
  const kids = children(m.id);
  return (
    <>
      <a className="navlink" href="#/collection">Back to collection</a>
      <div className="split">
        <div className="slab" style={{ display: 'grid', justifyItems: 'center', gap: 12 }}>
          <Portrait dna={m.dna} size={340} />
          <h1>{m.name}</h1>
          <div className="row"><span className="chip gold">{archetype(m.dna)}</span><span className="chip">Gen {m.gen}</span></div>
        </div>
        <div style={{ display: 'grid', gap: 20 }}>
          <section className="slab"><h2>Fight stats</h2><div style={{ marginTop: 14 }}><Stats dna={m.dna} /></div></section>
          <section className="slab">
            <h2>Career</h2>
            <dl className="kv" style={{ marginTop: 14 }}>
              <dt>Record</dt><dd>{m.record.w} wins, {m.record.l} losses</dd>
              <dt>Knockouts</dt><dd>{m.record.ko}</dd>
              <dt>Monster wallet</dt><dd>Opens when monsters go on-chain</dd>
              <dt>Hatched</dt><dd>{new Date(m.born).toLocaleDateString()}</dd>
            </dl>
          </section>
          <section className="slab">
            <h2>Genes</h2>
            <dl className="kv" style={{ marginTop: 14 }}>{geneRows(m.dna).map(([k, v]) => <Fragment key={k}><dt>{k}</dt><dd>{v}</dd></Fragment>)}</dl>
          </section>
          <section className="slab">
            <h2>Lineage</h2>
            <p className="sub">{parents.length ? 'Parents' : 'A wild first-generation monster.'}</p>
            <div className="row" style={{ marginTop: 10 }}>{parents.map((p) => <a key={p.id} className="chip" href={`#/monster/${p.id}`}>{p.name}</a>)}</div>
            {kids.length > 0 && <><p className="sub">Offspring</p><div className="row" style={{ marginTop: 10 }}>{kids.map((k) => <a key={k.id} className="chip" href={`#/monster/${k.id}`}>{k.name}</a>)}</div></>}
          </section>
          <div className="row">
            <a className="btn" href="#/play"><span>Fight</span></a>
            <a className="btn alt" href="#/breed"><span>Breed</span></a>
          </div>
        </div>
      </div>
    </>
  );
}

/* ---------- Breed ---------- */
export function Breed() {
  const [list, setList] = useState(monsters);
  const [sel, setSel] = useState<string[]>([]);
  const [born, setBorn] = useState<{ child: Monster; mutated: string | null } | null>(null);
  const toggle = (id: string) => setSel((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id].slice(-2)));
  const [a, b] = sel.map((id) => list.find((m) => m.id === id)!);
  const hatch = () => { const r = breedPair(a, b); setBorn(r); setList(monsters()); setSel([]); };
  return (
    <>
      <div><h1>Breed</h1><p className="sub">Pick two parents. The egg inherits a mix of their genes, and sometimes a mutation.</p></div>
      {born && (
        <section className="slab reveal" style={{ display: 'grid', justifyItems: 'center', gap: 10, textAlign: 'center' }} aria-live="polite">
          <h2>{born.child.name} hatched</h2>
          <Portrait dna={born.child.dna} size={260} />
          <p>Generation {born.child.gen}{born.mutated ? `, with a mutation in ${born.mutated}` : ''}.</p>
          <a className="btn" href={`#/monster/${born.child.id}`}><span>Meet {born.child.name}</span></a>
        </section>
      )}
      {a && b && (
        <section className="slab" aria-label="Inheritance preview">
          <h2>{a.name} and {b.name}</h2>
          <dl className="kv" style={{ marginTop: 12 }}>
            {STAT_KEYS.map((k) => <Fragment key={k}><dt>{k}</dt><dd>{Math.min(a.dna[k], b.dna[k])} to {Math.max(a.dna[k], b.dna[k])}</dd></Fragment>)}
            <dt>Horns</dt><dd>{GENE_NAMES.horn[a.dna.horn]} or {GENE_NAMES.horn[b.dna.horn]}</dd>
            <dt>Tail</dt><dd>{GENE_NAMES.tail[a.dna.tail]} or {GENE_NAMES.tail[b.dna.tail]}</dd>
          </dl>
          <div className="row" style={{ marginTop: 16 }}><button className="btn big" onClick={hatch}><span>Hatch egg</span></button></div>
        </section>
      )}
      <div className="grid">{list.map((m) => <MonsterCard key={m.id} m={m} selected={sel.includes(m.id)} onClick={() => toggle(m.id)} />)}</div>
      <p className="note">{DEMO_NOTE}</p>
    </>
  );
}

/* ---------- Account ---------- */
export function Account() {
  const { signedAccountId, signIn, signOut, getBalance, loading, network } = useNearWallet();
  const [bal, setBal] = useState<string>('');
  useEffect(() => {
    if (!signedAccountId) return setBal('');
    getBalance(signedAccountId).then((y: bigint) => setBal(Number(yoctoToNear(y)).toFixed(3))).catch(() => setBal('unavailable'));
  }, [signedAccountId, getBalance]);
  const log = history();
  const wins = log.filter((l) => l.won).length;
  return (
    <>
      <div><h1>Account</h1><p className="sub">Your NEAR account owns your monsters. Network: {network}.</p></div>
      <div className="split">
        <section className="slab" style={{ display: 'grid', gap: 14 }}>
          {loading ? <p>Checking wallet…</p> : signedAccountId ? (
            <>
              <h2 style={{ overflowWrap: 'anywhere' }}>{signedAccountId}</h2>
              <dl className="kv"><dt>Balance</dt><dd>{bal ? `${bal} NEAR` : 'loading…'}</dd><dt>Monsters</dt><dd>{monsters().length}</dd></dl>
              <button className="btn ghost" onClick={() => signOut()}><span>Disconnect</span></button>
            </>
          ) : (
            <>
              <h2>Connect a wallet</h2>
              <p className="sub">Sign in once. Fights never ask for a signature.</p>
              <button className="btn" onClick={() => signIn()}><span>Connect NEAR wallet</span></button>
            </>
          )}
        </section>
        <section className="slab">
          <h2>Recent fights</h2>
          <p className="sub">{log.length ? `${wins} wins from ${log.length} fights` : 'No fights yet.'}</p>
          <ul style={{ listStyle: 'none', padding: 0, margin: '12px 0 0', display: 'grid', gap: 8 }}>
            {log.slice(0, 10).map((l) => (
              <li key={l.at} className="row" style={{ justifyContent: 'space-between' }}>
                <span>{monster(l.mine)?.name ?? 'Unknown'} vs {l.vs}</span>
                <span className={`chip ${l.won ? 'gold' : ''}`}>{l.won ? 'Won' : 'Lost'}</span>
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
      <h2>Sound</h2>
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
