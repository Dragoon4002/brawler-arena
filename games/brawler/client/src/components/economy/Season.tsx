import { useEffect, useState } from 'react';
import { useMonsters } from '@/lib/nft.ts';
import { short } from '@/lib/format.ts';
import { useLoad } from '@/hooks/async.ts';
import { useMons } from '@/hooks/useMons.ts';
import { Ico, Portrait } from '@/components/ui.tsx';

function useNow() {
  const [t, setT] = useState(Date.now());
  useEffect(() => { const i = setInterval(() => setT(Date.now()), 1000); return () => clearInterval(i); }, []);
  return t;
}
const left = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000)), d = Math.floor(s / 86400), h = Math.floor(s / 3600) % 24, m = Math.floor(s / 60) % 60;
  return d ? `${d}d ${h}h ${m}m` : `${h}h ${m}m ${s % 60}s`;
};

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
