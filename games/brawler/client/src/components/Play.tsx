import { useMemo, useState } from 'react';
import { archetype, type Monster } from '@/lib/genes.ts';
import { STAGES, STAGE_IDS, type StageId } from '@/lib/stages.ts';
import { useWallet } from '@/lib/near.ts';
import { useMonsters } from '@/lib/nft.ts';
import { monsters } from '@/lib/store.ts';
import { useLoad } from '@/hooks/async.ts';
import { prepareFight } from '@/components/Arena.tsx';
import { isFree } from '@/components/monsters/Badges.tsx';
import { OnlineStart } from '@/components/rooms/OnlineStart.tsx';
import { Ico, Portrait, STAGE_ICON, StageThumb } from '@/components/ui.tsx';

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
