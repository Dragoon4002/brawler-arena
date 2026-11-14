import { useRef, useState } from 'react';
import { archetype, type Monster } from '@/lib/genes.ts';
import { usePlayable } from '@/hooks/useMons.ts';
import { RoomList } from '@/components/rooms/Lobby.tsx';
import { CreateRoom, JoinByCode } from '@/components/rooms/OnlineStart.tsx';
import { Ico, Portrait } from '@/components/ui.tsx';

function Picker({ groups, value, onPick, label }: { groups: [string, Monster[]][]; value: string; onPick: (id: string) => void; label: string }) {
  return (
    <section className="slab" aria-label={label}>
      <h3>{label}</h3>
      {groups.map(([title, list]) => list.length > 0 && (
        <div key={title}>
          <p className="sub" style={{ marginTop: 14 }}>{title}</p>
          <div className="grid" style={{ marginTop: 8, gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 150px), 1fr))' }}>
            {list.map((m) => (
              <button key={m.id} type="button" className="tile" aria-pressed={m.id === value} onClick={() => onPick(m.id)}>
                <Portrait dna={m.dna} size={130} />
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

const TABS = [['create', 'Create', 'icon-room-public'], ['join', 'Join', 'icon-lobby']] as const;
type Tab = (typeof TABS)[number][0];

export function Play({ initial = 'create' }: { initial?: Tab }) {
  const { free, local, all } = usePlayable();
  const groups: [string, Monster[]][] = [['On-chain monsters (locked in staked/bettable matches)', free], ['Browser monsters (casual only)', local]];
  const [p1, setP1] = useState('');
  const [tab, setTab] = useState<Tab>(initial);
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);
  const a = all.find((m) => m.id === p1) ?? all[0];
  const onKey = (e: React.KeyboardEvent) => { // tablist pattern: arrows/Home/End move focus and select
    const i = TABS.findIndex(([id]) => id === tab), n = TABS.length;
    const j = e.key === 'ArrowRight' ? (i + 1) % n : e.key === 'ArrowLeft' ? (i - 1 + n) % n : e.key === 'Home' ? 0 : e.key === 'End' ? n - 1 : -1;
    if (j < 0) return;
    e.preventDefault(); setTab(TABS[j][0]); tabs.current[j]?.focus();
  };
  return (
    <>
      <div><h1 className="row-ico"><Ico n="icon-play" className="ico h" />Fight</h1><p className="sub">Host a room or join one. You can swap monster and arena in the room before the fight.</p></div>
      <div className="tabs" role="tablist" aria-label="Play mode" onKeyDown={onKey}>
        {TABS.map(([id, label, icon], i) => (
          <button key={id} ref={(el) => { tabs.current[i] = el; }} type="button" role="tab" id={`tab-${id}`} aria-controls={`panel-${id}`}
            aria-selected={tab === id} tabIndex={tab === id ? 0 : -1} className="tab" onClick={() => setTab(id)}>
            <Ico n={icon} />{label}
          </button>
        ))}
      </div>
      <section className="slab tab-panel" role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`}>
        {!a ? <p className="note">No monsters available.</p> : tab === 'create' ? (
          <div className="play-create">
            <div className="play-mon">
              <Portrait dna={a.dna} size={170} />
              <b>{a.name}</b>
              <span className="tile-meta">{archetype(a.dna)} · pick below</span>
            </div>
            <CreateRoom mon={a} />
          </div>
        ) : (
          <div className="play-join">
            <h3 className="row-ico"><Ico n="icon-room-private" />Have a code?</h3>
            <JoinByCode mon={a} />
            <p className="note">Joining with <b>{a.name}</b>. Staked rooms ask your wallet to match the host's stake before you enter.</p>
            <RoomList mon={a} />
          </div>
        )}
      </section>
      <Picker groups={groups} value={a?.id ?? ''} onPick={setP1} label="Your monster" />
      <p className="note">Move WASD · Jump Space/W · J light · K heavy · L block (mouse: right light, left heavy) · C dodge. Arrows, Z/X and Q also work, and gamepads.</p>
    </>
  );
}
